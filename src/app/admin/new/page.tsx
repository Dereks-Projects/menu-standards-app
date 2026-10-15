/*
 * Location: menu-standards-app/src/app/admin/new/page.tsx
 *
 * The new group page, at /admin/new. A group and its outlets are recorded
 * here before any menu is uploaded, because every upload belongs to an
 * outlet.
 *
 * Locked. The password gate (src/proxy.ts) checks first, and this page
 * checks the pass again itself (decision 18a). The gate is a door and a
 * cost control, not user accounts.
 *
 * Every admin page lives under /admin. "new" is a reserved name, so no
 * group can ever take the address /admin/new.
 */

import type { Metadata } from "next";

import { requireUnlocked } from "@/lib/auth/guard";

import { NewGroupForm } from "./NewGroupForm";

import styles from "./NewGroup.module.css";

export const metadata: Metadata = {
  title: "New group",
};

const PAGE_PATH = "/admin/new";

export default async function NewGroupPage() {
  await requireUnlocked(PAGE_PATH);

  return (
    <section className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>New group</h1>
        <p className={styles.lead}>
          A group is the business you work with: a single restaurant, a hotel, or a restaurant company. Its outlets
          are the restaurants and bars inside it, and each outlet gets its own menus and program.
        </p>
        <NewGroupForm />
      </div>
    </section>
  );
}