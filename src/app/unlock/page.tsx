/*
 * Location: menu-standards-app/src/app/unlock/page.tsx
 *
 * The password page. Anyone can open it; the password is checked by
 * src/app/api/unlock/route.ts. A device that is already unlocked goes
 * straight to the page it asked for.
 *
 * The form is a plain HTML form, so it works even before the page's
 * JavaScript loads. A hidden username field helps password managers
 * save and fill the password.
 */

import { CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { safeNextPath, UNLOCK_API_PATH } from "@/lib/auth/access";
import { isValidPass, PASS_COOKIE_NAME } from "@/lib/auth/pass";

import styles from "./Unlock.module.css";

export const metadata: Metadata = {
  title: "Unlock",
};

const ERROR_MESSAGES: ReadonlyMap<string, string> = new Map([
  ["wrong", "Incorrect password. Try again."],
  ["setup", "Setup needed. The password gate is not configured on this server."],
  ["invalid", "Something went wrong. Try again."],
]);

type UnlockPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function UnlockPage({ searchParams }: UnlockPageProps) {
  const params = await searchParams;
  const nextPath = safeNextPath(firstValue(params.next));

  const cookieStore = await cookies();
  if (await isValidPass(cookieStore.get(PASS_COOKIE_NAME)?.value)) {
    redirect(nextPath);
  }

  const errorCode = firstValue(params.error);
  const errorMessage = errorCode ? ERROR_MESSAGES.get(errorCode) : undefined;

  return (
    <section className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Unlock Menu Standards</h1>
        <p className={styles.lead}>Enter the admin password to continue.</p>

        {errorMessage && (
          <p id="unlock-error" role="alert" className={styles.error}>
            <CircleAlert aria-hidden="true" size={18} className={styles.errorIcon} />
            <span>{errorMessage}</span>
          </p>
        )}

        <form method="post" action={UNLOCK_API_PATH} className={styles.form}>
          <input type="hidden" name="next" value={nextPath} />
          <input type="text" name="username" defaultValue="admin" autoComplete="username" readOnly hidden />

          <label htmlFor="password" className={styles.label}>
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={1024}
            autoFocus
            aria-describedby={errorMessage ? "unlock-error" : undefined}
            className={styles.input}
          />

          <button type="submit" className={styles.button}>
            Unlock
          </button>
        </form>

        <p className={styles.note}>
          This device stays unlocked for 7 days, or until you choose Lock in the menu.
        </p>
      </div>
    </section>
  );
}