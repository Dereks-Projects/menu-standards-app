/*
 * Location: menu-standards-app/src/lib/auth/access.ts
 *
 * The open list: pages and requests anyone can reach without the password.
 * src/proxy.ts locks everything else. The header also reads this list, so
 * the Lock button appears only on locked pages.
 *
 * This file holds no secrets and is safe to use in browser code.
 * When the role play scoring route is built (Phase 7), it joins this list
 * and checks the student link code itself.
 */

export const UNLOCK_PATH = "/unlock";
export const UNLOCK_API_PATH = "/api/unlock";
export const LOCK_API_PATH = "/api/lock";

/** Where to go after unlocking when no page was requested. This becomes
 * the restaurants page once it exists (Phase 8). */
export const DEFAULT_AFTER_UNLOCK_PATH = "/";

const OPEN_EXACT_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/how-it-works",
  UNLOCK_PATH,
  UNLOCK_API_PATH,
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
]);

const OPEN_PATH_PREFIXES: readonly string[] = ["/legal/", "/share/", "/learn/"];

export function isOpenPath(pathname: string): boolean {
  if (OPEN_EXACT_PATHS.has(pathname)) {
    return true;
  }
  return OPEN_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

const MAX_NEXT_PATH_LENGTH = 512;

/**
 * Returns a safe page to send someone to after unlocking. Only addresses
 * inside this site are accepted, which blocks links that try to bounce a
 * visitor to another website.
 */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_NEXT_PATH_LENGTH) {
    return DEFAULT_AFTER_UNLOCK_PATH;
  }
  if (!value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_AFTER_UNLOCK_PATH;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isControlCharacter = code < 0x20 || code === 0x7f;
    if (isControlCharacter || value[index] === "\\") {
      return DEFAULT_AFTER_UNLOCK_PATH;
    }
  }
  if (value === UNLOCK_PATH || value.startsWith(`${UNLOCK_PATH}?`)) {
    return DEFAULT_AFTER_UNLOCK_PATH;
  }
  return value;
}