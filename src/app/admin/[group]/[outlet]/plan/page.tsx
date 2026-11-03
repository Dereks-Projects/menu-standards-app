/*
 * Location: menu-standards-app/src/app/admin/[group]/[outlet]/plan/page.tsx
 *
 * The plan screen for one outlet, at /admin/{group}/{outlet}/plan. The plan
 * is made from the menus read on the upload screen, adjusted, and approved
 * here. Nothing is built until a plan is approved (product rule). The
 * screen itself lives in src/components/plan/.
 *
 * Locked. The password gate (src/proxy.ts) checks first, and this page
 * checks the pass again itself (decision 18a). The gate is a door and a
 * cost control, not user accounts.
 *
 * This page reads, through src/lib/storage/plan-store.ts; the plan route
 * (src/app/api/plan/route.ts) makes and saves every version. The page shows the outlet's latest version, or the
 * menus to make the first plan from. An outlet with no menus read yet is
 * pointed to its upload screen. If storage cannot be read, the page says
 * so instead of failing.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { type MenuChoice, PlanView } from "@/components/plan/PlanView";
import { requireUnlocked } from "@/lib/auth/guard";
import { defaultMenuSelection } from "@/lib/engine/plan";
import { SlugSchema } from "@/lib/schemas/common";
import type { Menu } from "@/lib/schemas/menu";
import type { Plan } from "@/lib/schemas/plan";
import { findGroup, findOutlet, readIndex } from "@/lib/storage/index-store";
import { readLatestPlan, readOutletMenus } from "@/lib/storage/plan-store";

import styles from "@/components/plan/Plan.module.css";

export const metadata: Metadata = {
  title: "Plan",
};

type PlanPageProps = {
  params: Promise<{ group: string; outlet: string }>;
};

/** Only what the screen shows about each menu, newest first. Prices, allergens, and items stay on the server. */
function menuChoices(menus: readonly Menu[]): MenuChoice[] {
  return menus.map((menu) => ({
    menuId: menu.menuId,
    menuType: menu.menuType,
    fileName: menu.sourceFile.fileName,
    readAt: menu.readAt,
    items: menu.sections.reduce((total, section) => total + section.items.length, 0),
  }));
}

/** A short message in place of the plan, for an outlet with nothing to plan or a failed load. */
function PlanMessage({ place, text, children }: { place: string; text: string; children?: ReactNode }) {
  return (
    <section className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Plan</h1>
        <p className={styles.place}>{place}</p>
        <p className={styles.lead}>{text}</p>
        {children}
      </div>
    </section>
  );
}

export default async function PlanPage({ params }: PlanPageProps) {
  const { group: groupSlug, outlet: outletSlug } = await params;
  const isValidAddress = SlugSchema.safeParse(groupSlug).success && SlugSchema.safeParse(outletSlug).success;

  // The pass is checked before anything about the address is revealed.
  await requireUnlocked(isValidAddress ? `/admin/${groupSlug}/${outletSlug}/plan` : undefined);
  if (!isValidAddress) {
    notFound();
  }

  const index = await readIndex();
  const group = findGroup(index, groupSlug);
  const outlet = findOutlet(index, groupSlug, outletSlug);
  if (group === null || outlet === null || group.archivedAt !== null || outlet.archivedAt !== null) {
    notFound();
  }

  const place = group.kind === "single" ? outlet.name : `${outlet.name}, ${group.name}`;
  const uploadPath = `/admin/${groupSlug}/${outletSlug}/upload`;

  let menus: Menu[];
  let plan: Plan | null;
  try {
    [menus, { plan }] = await Promise.all([readOutletMenus(groupSlug, outletSlug), readLatestPlan(groupSlug, outletSlug)]);
  } catch (error) {
    console.error("Loading the plan screen failed.", error);
    return <PlanMessage place={place} text="The plan could not be loaded right now. Refresh the page to try again." />;
  }

  if (menus.length === 0 && plan === null) {
    return (
      <PlanMessage place={place} text="No menus have been read for this outlet yet. Upload its menus first.">
        <div className={styles.actions}>
          <Link href={uploadPath} className={styles.primaryButton}>
            Upload menus
          </Link>
        </div>
      </PlanMessage>
    );
  }

  return (
    <PlanView
      groupSlug={groupSlug}
      outletSlug={outletSlug}
      place={place}
      uploadPath={uploadPath}
      menus={menuChoices(menus)}
      defaultMenuIds={defaultMenuSelection(menus)}
      initialPlan={plan}
    />
  );
}