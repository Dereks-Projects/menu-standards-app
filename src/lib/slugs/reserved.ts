/*
 * Location: menu-standards-app/src/lib/slugs/reserved.ts
 *
 * Naming rules for groups and outlets, and the list of names the app
 * keeps for itself.
 *
 * A slug is the readable part of an address: /surfclub/lido. Rules are
 * lowercase letters, numbers, and single hyphens, 2 to 40 characters.
 * A name is never changed after it is issued, because links already handed
 * out must keep working. Names the app uses, or will use, are blocked so a
 * restaurant can never sit on top of a real page.
 */

const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // App sections, now and planned
  "about",
  "account",
  "admin",
  "api",
  "app",
  "assets",
  "billing",
  "checker",
  "contact",
  "content",
  "course",
  "dashboard",
  "demo",
  "docs",
  "edit",
  "exam",
  "flashcards",
  "fonts",
  "foundations",
  "group",
  "help",
  "how-it-works",
  "images",
  "img",
  "learn",
  "legal",
  "lock",
  "login",
  "logout",
  "new",
  "outlet",
  "plan",
  "preshift",
  "pre-shift",
  "preview",
  "pricing",
  "print",
  "privacy",
  "program",
  "public",
  "quiz",
  "quizzes",
  "reports",
  "restaurants",
  "role-play",
  "roleplay",
  "settings",
  "share",
  "signin",
  "signup",
  "static",
  "status",
  "support",
  "terms",
  "unlock",
  "upload",
  // Files and services that answer at the top level
  "assetlinks",
  "blob",
  "favicon",
  "health",
  "manifest",
  "next",
  "robots",
  "sitemap",
  "storage",
  "vercel",
  "well-known",
  "www",
  // Words that cause trouble when they arrive as text
  "false",
  "null",
  "true",
  "undefined",
]);

export const MIN_SLUG_LENGTH = 2;
export const MAX_SLUG_LENGTH = 40;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

export type SlugCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Checks a name the manager or you typed, and says why it fails. */
export function checkSlug(slug: string): SlugCheck {
  if (slug.length < MIN_SLUG_LENGTH) {
    return { ok: false, reason: `Use at least ${MIN_SLUG_LENGTH} characters.` };
  }
  if (slug.length > MAX_SLUG_LENGTH) {
    return { ok: false, reason: `Use at most ${MAX_SLUG_LENGTH} characters.` };
  }
  if (!SLUG_PATTERN.test(slug)) {
    return { ok: false, reason: "Use lowercase letters, numbers, and single hyphens." };
  }
  if (isReservedSlug(slug)) {
    return { ok: false, reason: "That name is reserved by the app. Choose another." };
  }
  return { ok: true };
}

/**
 * Turns a restaurant name into a suggested slug: "Château Lido" becomes
 * "chateau-lido". Accents are simplified and anything else becomes a
 * hyphen. The result still has to pass checkSlug.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

/** Every reserved name, for tests and for the admin screens. */
export function reservedSlugs(): string[] {
  return [...RESERVED_SLUGS].sort();
}