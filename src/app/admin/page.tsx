/*
 * Location: menu-standards-app/src/app/admin/page.tsx
 *
 * The command screen, at /admin: every group and outlet, where each one
 * stands, and the way into each outlet's work. It starts in Phase 4 with
 * groups, outlets, menus read, and program status, and gains a column or
 * panel as each later phase adds a stage (plan, build, checker flags,
 * links, cost). Phase 8 completes it.
 *
 * Locked. The password gate (src/proxy.ts) checks first, and this page
 * checks the pass again itself (decision 18a). The gate is a door and a
 * cost control, not user accounts.
 *
 * Where the numbers come from:
 * - Groups and outlets: the index (src/lib/storage/index-store.ts).
 * - Menus read: the reader's saved records in storage, counted on every
 *   visit (src/lib/storage/blob.ts). If counting fails, the page still
 *   shows every group and says the counts are unavailable.
 * - Program: whether the outlet has a program yet. Programs arrive in
 *   Phase 6, so every outlet shows "Not built yet" for now.
 *
 * Archived groups and outlets are left out. Groups are listed by name.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { requireUnlocked } from "@/lib/auth/guard";
import { type Group, type GroupKind, groupPath, type Outlet, outletPath } from "@/lib/schemas/tenant";
import { countMenuRecords, outletCountKey } from "@/lib/storage/blob";
import { readIndex } from "@/lib/storage/index-store";

import styles from "./Admin.module.css";

export const metadata: Metadata = {
  title: "Admin",
};

const PAGE_PATH = "/admin";
const NEW_GROUP_PATH = "/admin/new";

const KIND_LABELS: Readonly<Record<GroupKind, string>> = {
  single: "Single restaurant",
  hotel: "Hotel",
  restaurant_group: "Restaurant group",
};

/** "/admin/seagate", as the browser shows a group's address. */
function adminGroupPath(groupSlug: string): string {
  return `${PAGE_PATH}${groupPath(groupSlug)}`;
}

/** "/admin/seagate/pool-bar", as the browser shows an outlet's address. */
function adminOutletPath(groupSlug: string, outletSlug: string): string {
  return `${PAGE_PATH}${outletPath(groupSlug, outletSlug)}`;
}

/** "1 group", "3 outlets". */
function count(amount: number, word: string): string {
  return `${amount} ${word}${amount === 1 ? "" : "s"}`;
}

type GroupEntry = {
  readonly group: Group;
  readonly outlets: readonly Outlet[];
};

/** Active groups by name, each with its active outlets in the order they were added. */
function activeGroups(groups: readonly Group[], outlets: readonly Outlet[]): GroupEntry[] {
  const outletsByGroup = new Map<string, Outlet[]>();
  for (const outlet of outlets) {
    if (outlet.archivedAt !== null) {
      continue;
    }
    const groupOutlets = outletsByGroup.get(outlet.groupSlug) ?? [];
    groupOutlets.push(outlet);
    outletsByGroup.set(outlet.groupSlug, groupOutlets);
  }
  return groups
    .filter((group) => group.archivedAt === null)
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }))
    .map((group) => ({ group, outlets: outletsByGroup.get(group.slug) ?? [] }));
}

/** Menus read per outlet, or null when storage could not be counted. */
async function loadMenuCounts(): Promise<ReadonlyMap<string, number> | null> {
  try {
    return await countMenuRecords();
  } catch (error) {
    console.error("Counting menu records failed.", error);
    return null;
  }
}

export default async function AdminPage() {
  await requireUnlocked(PAGE_PATH);

  const [index, menuCounts] = await Promise.all([readIndex(), loadMenuCounts()]);

  const entries = activeGroups(index.groups, index.outlets);
  const outletTotal = entries.reduce((total, entry) => total + entry.outlets.length, 0);
  const menuTotal =
    menuCounts === null
      ? null
      : entries.reduce(
          (total, entry) =>
            total +
            entry.outlets.reduce(
              (sum, outlet) => sum + (menuCounts.get(outletCountKey(entry.group.slug, outlet.slug)) ?? 0),
              0,
            ),
          0,
        );

  return (
    <section className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <div>
            <h1 className={styles.title}>Admin</h1>
            <p className={styles.lead}>Every group and outlet, and where each one stands.</p>
          </div>
          <Link href={NEW_GROUP_PATH} className={styles.primaryButton}>
            New group
          </Link>
        </div>

        {entries.length > 0 && (
          <p className={styles.summary}>
            {count(entries.length, "group")}, {count(outletTotal, "outlet")}
            {menuTotal !== null && <>, {count(menuTotal, "menu")} read</>}
          </p>
        )}

        {menuCounts === null && (
          <p className={styles.notice} role="status">
            Menu counts could not be loaded right now. Refresh the page to try again.
          </p>
        )}

        {entries.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No groups yet</p>
            <p className={styles.emptyText}>Record your first restaurant, hotel, or restaurant group to begin.</p>
          </div>
        ) : (
          <ul className={styles.groups}>
            {entries.map(({ group, outlets }) => {
              const isSingle = group.kind === "single";
              return (
                <li key={group.groupId} className={styles.group}>
                  <div className={styles.groupHeader}>
                    <div className={styles.groupName}>
                      <h2 className={styles.groupTitle}>
                        {group.name}
                      </h2>
                      <code className={styles.address}>{adminGroupPath(group.slug)}</code>
                    </div>
                    <span className={styles.kind}>{KIND_LABELS[group.kind]}</span>
                  </div>

                  {outlets.length === 0 ? (
                    <p className={styles.noOutlets}>This group has no active outlets.</p>
                  ) : (
                    <ul className={styles.outlets}>
                      {outlets.map((outlet) => {
                        const menusRead = menuCounts?.get(outletCountKey(group.slug, outlet.slug)) ?? 0;
                        const name = isSingle ? group.name : outlet.name;
                        return (
                          <li
                            key={outlet.outletId}
                            className={isSingle ? `${styles.outlet} ${styles.outletSingle}` : styles.outlet}
                          >
                            {!isSingle && (
                              <div className={styles.outletName}>
                                <span className={styles.outletTitle}>{outlet.name}</span>
                                <code className={styles.address}>{adminOutletPath(group.slug, outlet.slug)}</code>
                                {outlet.description !== "" && (
                                  <span className={styles.description}>{outlet.description}</span>
                                )}
                              </div>
                            )}
                            <dl className={styles.status}>
                              <div className={styles.statusItem}>
                                <dt>Menus read</dt>
                                <dd>{menuCounts === null ? "Unavailable" : menusRead}</dd>
                              </div>
                              <div className={styles.statusItem}>
                                <dt>Program</dt>
                                <dd>{outlet.currentProgramId === null ? "Not built yet" : "Built"}</dd>
                              </div>
                            </dl>
                            <Link
                              href={`${adminOutletPath(group.slug, outlet.slug)}/upload`}
                              className={styles.uploadLink}
                              aria-label={`Upload menus for ${name}`}
                            >
                              Upload menus
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}