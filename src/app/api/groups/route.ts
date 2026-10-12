/*
 * Location: menu-standards-app/src/app/api/groups/route.ts
 *
 * Saves a new group and its outlets to the index. The new group form
 * sends its answers here.
 *
 * Checks, in order, before anything is saved:
 * 1. This browser holds a valid pass. The password gate already checked;
 *    this is the second lock (decision 18a).
 * 2. The request came from a page on this site. Browsers name the sending
 *    page's site in the Origin header, and a page on another site cannot
 *    change it, so another site cannot make this browser save a group.
 * 3. The request is JSON and at most 32,000 characters.
 * 4. It follows the rules in src/lib/tenants/create-group.ts.
 * 5. The group address is not already in use. This runs inside the index's
 *    safe update, so two saves at the same moment cannot both claim it.
 *
 * Answers: 201 with the saved group and outlets; 400 or 409 with a plain
 * message for the form; 401 locked; 403 another site; 413 too large;
 * 415 not JSON; 500 anything else.
 */

import { NextResponse } from "next/server";

import { isUnlocked, lockedResponse } from "@/lib/auth/guard";
import { updateIndex } from "@/lib/storage/index-store";
import {
  addGroupToIndex,
  checkNewGroupRequest,
  GroupAddressTakenError,
  newGroupRecords,
} from "@/lib/tenants/create-group";

const NO_STORE = { "cache-control": "no-store" } as const;

/** Thirty outlets with long names and descriptions come to about 12,000. */
const MAX_BODY_CHARACTERS = 32_000;

function refuse(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/**
 * True when the browser says the request came from this site. Compares the
 * Origin header with the address the request arrived at, the same check
 * Next.js applies to its own form actions.
 */
function isFromThisSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin === null || host === null) {
    return false;
  }
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function isJson(request: Request): boolean {
  const type = request.headers.get("content-type") ?? "";
  return type.split(";")[0]?.trim().toLowerCase() === "application/json";
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isUnlocked())) {
    return lockedResponse();
  }
  if (!isFromThisSite(request)) {
    return refuse(403, "This request did not come from this site.");
  }
  if (!isJson(request)) {
    return refuse(415, "Send the form as JSON.");
  }

  const text = await request.text();
  if (text.length > MAX_BODY_CHARACTERS) {
    return refuse(413, "The request is too large.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse(400, "The request could not be read.");
  }

  const check = checkNewGroupRequest(raw);
  if (!check.ok) {
    return refuse(400, check.problem);
  }

  // Built once, outside the update, so a retried save keeps its identifiers.
  const records = newGroupRecords(check.request);

  try {
    await updateIndex((index) => addGroupToIndex(index, records));
  } catch (error) {
    if (error instanceof GroupAddressTakenError) {
      return refuse(409, `The address /${error.slug} is already in use. Choose another.`);
    }
    console.error("Saving a new group failed.", error);
    return refuse(500, "Saving failed. Try again.");
  }

  return NextResponse.json(
    { group: records.group, outlets: records.outlets },
    { status: 201, headers: NO_STORE },
  );
}