/*
 * Location: menu-standards-app/src/app/api/plan/route.ts
 *
 * Creates, saves, and approves an outlet's plan. The plan screen sends one
 * of three actions:
 * - create: a new draft plan from the chosen menus. This is the only
 *   action that spends anything: the planner writes the synopsis.
 * - save: the manager's answers and adjustments, as a new draft version.
 * - approve: the same, then the approval, as a new approved version.
 *
 * Checks, in order, before anything is saved or spent:
 * 1. This browser holds a valid pass (the second lock, decision 18a).
 * 2. The request came from a page on this site.
 * 3. The request is JSON, at most 160,000 characters (room for 200 house
 *    terms with full answers), in the expected shape.
 * 4. The outlet exists in the index and is not archived.
 * 5. The plan on screen is still the latest version, so a page left open
 *    never overwrites newer work. For save and approve it must also be a
 *    draft: approved plans are locked, and a change means a new plan. Two
 *    saves at the same moment cannot both win: storage refuses to write a
 *    version number that already exists.
 *
 * Every version is a new file and never overwrites an earlier one.
 *
 * Answers: 200 with the saved plan; 400 with a plain message for the
 * screen; 401 locked; 403 another site; 409 the plan changed meanwhile;
 * 413 too large; 415 not JSON; 422 or 502 when the planner fails.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { AiStepError, type AiFailureKind } from "@/lib/ai/client";
import { isUnlocked, lockedResponse } from "@/lib/auth/guard";
import {
  approvePlan,
  createPlan,
  defaultMenuSelection,
  PlanChangesSchema,
  PlanRuleError,
  revisePlan,
} from "@/lib/engine/plan";
import { IdSchema, SlugSchema } from "@/lib/schemas/common";
import type { Menu } from "@/lib/schemas/menu";
import { MAX_PLAN_MENUS, type Plan } from "@/lib/schemas/plan";
import { isWriteConflict, latestPlanVersion } from "@/lib/storage/blob";
import { findGroup, findOutlet, readIndex, type StoreIndex } from "@/lib/storage/index-store";
import { readLatestPlan, readOutletMenus, savePlanVersion } from "@/lib/storage/plan-store";

/** Writing a synopsis for a large outlet can take a minute or two. */
export const maxDuration = 300;

const NO_STORE = { "cache-control": "no-store" } as const;

const MAX_BODY_CHARACTERS = 160_000;

const RequestSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("create"),
    groupSlug: SlugSchema,
    outletSlug: SlugSchema,
    /** The latest version the screen shows, or null when the outlet has no plan yet. */
    version: z.number().int().min(1).nullable(),
    /** Leave out to use the default (defaultMenuSelection in the engine). */
    menuIds: z.array(IdSchema).min(1).max(MAX_PLAN_MENUS).optional(),
  }),
  z.strictObject({
    action: z.literal("save"),
    groupSlug: SlugSchema,
    outletSlug: SlugSchema,
    version: z.number().int().min(1),
    changes: PlanChangesSchema,
  }),
  z.strictObject({
    action: z.literal("approve"),
    groupSlug: SlugSchema,
    outletSlug: SlugSchema,
    version: z.number().int().min(1),
    changes: PlanChangesSchema,
  }),
]);

/** What the person at the screen is told when the planner fails, without internal detail. */
const FAILURE_MESSAGES: Readonly<Record<AiFailureKind, { status: number; message: string }>> = {
  not_configured: { status: 500, message: "Planning is not set up on this site yet." },
  request_failed: { status: 502, message: "The planner could not be reached. Try again." },
  refused: { status: 422, message: "The planner declined these menus. Check that they are menus." },
  incomplete: { status: 422, message: "These menus are too long to plan in one pass. Leave one out and try again." },
  invalid_answer: { status: 502, message: "The planner could not write a clean synopsis. Try again." },
};

function refuse(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

/** True when the browser says the request came from this site (as in the groups route). */
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

/**
 * True when another version was saved after this request read the latest
 * one. Storage refuses to write a version that already exists, and that
 * refusal is the usual reason a save fails.
 */
async function savedMeanwhile(plan: Plan, latestVersion: number | null): Promise<boolean> {
  try {
    return (await latestPlanVersion(plan.groupSlug, plan.outletSlug)) !== latestVersion;
  } catch {
    return false;
  }
}

const STALE_MESSAGE = "This plan changed since the page was opened. Reload the page to see the latest version.";

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isUnlocked())) {
    return lockedResponse();
  }
  if (!isFromThisSite(request)) {
    return refuse(403, "This request did not come from this site.");
  }
  if (!isJson(request)) {
    return refuse(415, "Send the plan as JSON.");
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
  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    return refuse(400, "The request is not in the expected shape.");
  }
  const body = parsed.data;

  let index: StoreIndex;
  try {
    index = await readIndex();
  } catch (error) {
    console.error("Loading the index failed.", error);
    return refuse(500, "The plan could not be loaded. Try again.");
  }
  const group = findGroup(index, body.groupSlug);
  const outlet = findOutlet(index, body.groupSlug, body.outletSlug);
  if (group === null || outlet === null || group.archivedAt !== null || outlet.archivedAt !== null) {
    return refuse(400, "That outlet does not exist.");
  }

  let latestVersion: number | null;
  let latest: Plan | null;
  let menus: Menu[];
  try {
    ({ version: latestVersion, plan: latest } = await readLatestPlan(body.groupSlug, body.outletSlug));
    menus = body.action === "create" ? await readOutletMenus(body.groupSlug, body.outletSlug) : [];
  } catch (error) {
    console.error("Loading a plan or its menus failed.", error);
    return refuse(500, "The plan could not be loaded. Try again.");
  }
  if (latestVersion !== body.version) {
    return refuse(409, STALE_MESSAGE);
  }
  const nextVersion = (latestVersion ?? 0) + 1;

  let plan: Plan;
  try {
    if (body.action === "create") {
      plan = await createPlan({
        groupSlug: body.groupSlug,
        outletSlug: body.outletSlug,
        outletName: group.kind === "single" ? group.name : `${outlet.name}, ${group.name}`,
        menus,
        includedMenuIds: body.menuIds ?? defaultMenuSelection(menus),
        version: nextVersion,
        previous: latest,
      });
    } else {
      if (latest === null) {
        return refuse(409, STALE_MESSAGE);
      }
      plan =
        body.action === "save"
          ? revisePlan(latest, body.changes, nextVersion)
          : approvePlan(latest, body.changes, nextVersion);
    }
  } catch (error) {
    if (error instanceof PlanRuleError) {
      return refuse(400, error.message);
    }
    if (error instanceof AiStepError) {
      const costUsd = error.usage.reduce((total, entry) => total + entry.costUsd, 0);
      console.error("Planning failed.", { kind: error.kind, attempts: error.usage.length, costUsd });
      const failure = FAILURE_MESSAGES[error.kind];
      return refuse(failure.status, failure.message);
    }
    console.error("Planning failed unexpectedly.", error);
    return refuse(500, "Planning failed. Try again.");
  }

  try {
    await savePlanVersion(plan);
  } catch (error) {
    if (isWriteConflict(error) || (await savedMeanwhile(plan, latestVersion))) {
      return refuse(409, STALE_MESSAGE);
    }
    console.error("Saving a plan failed.", error);
    return refuse(500, "The plan could not be saved. Try again.");
  }

  return NextResponse.json({ plan }, { headers: NO_STORE });
}