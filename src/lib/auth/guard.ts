/*
 * Location: menu-standards-app/src/lib/auth/guard.ts
 *
 * The second lock. src/proxy.ts is the front door, but pages and requests
 * that touch client data check the pass again themselves, so a single
 * mistake in one file cannot expose anything. Next.js gives this same
 * guidance after a 2025 flaw that let attackers skip middleware checks.
 *
 * Server only. Pages call requireUnlocked at the top; route handlers call
 * isUnlocked and return lockedResponse when it is false.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { UNLOCK_PATH } from "./access";
import { isValidPass, PASS_COOKIE_NAME } from "./pass";

/** True when this browser holds a valid, unexpired pass. */
export async function isUnlocked(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidPass(cookieStore.get(PASS_COOKIE_NAME)?.value);
}

/**
 * Use at the top of any page that shows client data. A locked visitor is
 * sent to the password page and never sees the rest of the page render.
 */
export async function requireUnlocked(nextPath?: string): Promise<void> {
  if (await isUnlocked()) {
    return;
  }
  const target = nextPath ? `${UNLOCK_PATH}?next=${encodeURIComponent(nextPath)}` : UNLOCK_PATH;
  redirect(target);
}

/** The refusal a locked request receives. Plain, with no detail in it. */
export function lockedResponse(): NextResponse {
  return NextResponse.json(
    { error: "Locked" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}