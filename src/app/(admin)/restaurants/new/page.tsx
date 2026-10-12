/*
 * Location: menu-standards-app/src/app/(admin)/restaurants/new/page.tsx
 *
 * The new group page, at /restaurants/new. A restaurant, hotel, or
 * restaurant group and its outlets are recorded here before any menu is
 * uploaded, because every upload belongs to an outlet.
 *
 * Locked. The password gate (src/proxy.ts) checks first, and this page
 * checks the pass again itself (decision 18a). The gate is a door and a
 * cost control, not user accounts.
 *
 * The (admin) folder groups the locked admin pages. Parentheses around a
 * folder name keep it out of the address, so this page is /restaurants/new.
 */

import type { Metadata } from "next";

import { requireUnlocked } from "@/lib/auth/guard";

import { NewGroupForm } from "./NewGroupForm";

import styles from "./NewGroup.module.css";

export const metadata: Metadata = {
  title: "New group",
};

const PAGE_PATH = "/restaurants/new";

export default async function NewGroupPage() {
  await requireUnlocked(PAGE_PATH);

  return (
    <section className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>New group</h1>
        <p className={styles.lead}>Record a restaurant, hotel, or restaurant group and its outlets.</p>
        <NewGroupForm />
      </div>
    </section>
  );
}