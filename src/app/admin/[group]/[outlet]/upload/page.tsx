/*
 * Location: menu-standards-app/src/app/admin/[group]/[outlet]/upload/page.tsx
 *
 * The upload screen for one outlet, at /admin/{group}/{outlet}/upload. Menus
 * are added here, and each one is read as soon as it arrives. The fields
 * live in src/components/upload/.
 *
 * Locked. The password gate (src/proxy.ts) checks first, and this page
 * checks the pass again itself (decision 18a). The gate is a door and a
 * cost control, not user accounts.
 *
 * An address that does not match an existing, active outlet shows the
 * not-found page, so the screen never accepts files for an outlet that is
 * not in the index. The upload and read routes check the outlet again.
 *
 * The square brackets in the folder names stand for the group's and the
 * outlet's addresses, which Next.js reads from the browser's address bar.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OtherMenuField } from "@/components/upload/OtherMenuField";
import { UploadField } from "@/components/upload/UploadField";
import { requireUnlocked } from "@/lib/auth/guard";
import { SlugSchema } from "@/lib/schemas/common";
import { findGroup, findOutlet, readIndex } from "@/lib/storage/index-store";

import styles from "@/components/upload/Upload.module.css";

export const metadata: Metadata = {
  title: "Upload menus",
};

type UploadPageProps = {
  params: Promise<{ group: string; outlet: string }>;
};

export default async function UploadPage({ params }: UploadPageProps) {
  const { group: groupSlug, outlet: outletSlug } = await params;
  const isValidAddress = SlugSchema.safeParse(groupSlug).success && SlugSchema.safeParse(outletSlug).success;

  // The pass is checked before anything about the address is revealed.
  await requireUnlocked(isValidAddress ? `/admin/${groupSlug}/${outletSlug}/upload` : undefined);
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

  return (
    <section className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Upload menus</h1>
        <p className={styles.place}>{place}</p>
        <p className={styles.lead}>
          Each file is read as soon as it is added, which takes 1 to 4 minutes per menu. Keep this page open
          until every file shows its item count.
        </p>
        <p className={styles.formats}>PDF, JPEG, PNG, or WebP, up to 20 MB each.</p>

        <div className={styles.fields}>
          <UploadField
            groupSlug={groupSlug}
            outletSlug={outletSlug}
            menuType="food"
            label="Food menus"
            hint="Dinner, lunch, brunch, or dessert. Add each menu as its own file."
          />
          <UploadField
            groupSlug={groupSlug}
            outletSlug={outletSlug}
            menuType="cocktail"
            label="Cocktail menu"
            hint="Signature cocktails and classics."
          />
          <UploadField
            groupSlug={groupSlug}
            outletSlug={outletSlug}
            menuType="by_the_glass"
            label="Wines by the glass"
            hint="The by-the-glass list. A full wine list goes under Other menus."
          />
          <OtherMenuField groupSlug={groupSlug} outletSlug={outletSlug} />
        </div>
      </div>
    </section>
  );
}