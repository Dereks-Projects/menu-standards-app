/*
 * Location: menu-standards-app/src/lib/storage/plan-store.ts
 *
 * Reads and saves plans, and reads the menus a plan is made from, for one
 * outlet. The plan screen and the plan route both use these, so they always
 * see the same menus and the same latest version. The command screen reads
 * each outlet's latest plan here for its status.
 *
 * Every record is checked against its schema as it is read
 * (src/lib/storage/blob.ts), so bad data stops here instead of reaching a
 * screen. Every plan version is saved as a new file and never overwrites an
 * earlier one: saving a version number that already exists fails.
 *
 * Server only. Browser code never imports this file.
 */

import { type Menu, MenuSchema } from "@/lib/schemas/menu";
import { MAX_LISTED_MENUS, type Plan, PlanSchema } from "@/lib/schemas/plan";

import { latestPlanVersion, listMenuRecords, planVersionPathname, readJson, writeJson } from "./blob";

/** The outlet's newest reader records, at most MAX_LISTED_MENUS, newest first. */
export async function readOutletMenus(groupSlug: string, outletSlug: string): Promise<Menu[]> {
  const records = (await listMenuRecords(groupSlug, outletSlug)).slice(0, MAX_LISTED_MENUS);
  const stored = await Promise.all(records.map((record) => readJson(record.pathname, MenuSchema)));
  return stored
    .flatMap((entry) => (entry === null ? [] : [entry.data]))
    .sort((a, b) => b.readAt.localeCompare(a.readAt));
}

export type LatestPlan = {
  /** The newest version number saved, or null when the outlet has no plan. */
  readonly version: number | null;
  readonly plan: Plan | null;
};

/** One plan version, or null when it does not exist. */
export async function readPlanVersion(groupSlug: string, outletSlug: string, version: number): Promise<Plan | null> {
  const stored = await readJson(planVersionPathname(groupSlug, outletSlug, version), PlanSchema);
  return stored?.data ?? null;
}

/** The outlet's newest plan version. */
export async function readLatestPlan(groupSlug: string, outletSlug: string): Promise<LatestPlan> {
  const version = await latestPlanVersion(groupSlug, outletSlug);
  if (version === null) {
    return { version: null, plan: null };
  }
  return { version, plan: await readPlanVersion(groupSlug, outletSlug, version) };
}

/** Saves a plan as its own version. Fails when that version already exists. */
export async function savePlanVersion(plan: Plan): Promise<void> {
  await writeJson(planVersionPathname(plan.groupSlug, plan.outletSlug, plan.version), PlanSchema.parse(plan), {
    kind: "create",
  });
}