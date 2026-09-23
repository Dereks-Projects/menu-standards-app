/*
 * Location: menu-standards-app/src/proxy.ts
 *
 * The password gate. This file runs before every page and every request.
 *
 * Rules:
 * - Pages on the open list in src/lib/auth/access.ts pass through.
 * - Anything else needs a valid 7-day pass.
 * - A locked page sends the visitor to /unlock, remembering where they
 *   were headed so they land there after unlocking.
 * - A locked request from the app's own code gets a plain refusal instead
 *   of a redirect, because a redirect would confuse it.
 * - If the gate settings are missing, every pass counts as invalid, so the
 *   site stays locked rather than open.
 *
 * This gate is the front door, not the only lock. Pages and requests that
 * handle client data check the pass again themselves, so a single mistake
 * here cannot expose anything.
 */

import { NextResponse, type NextRequest } from "next/server";

import { isOpenPath, UNLOCK_PATH } from "@/lib/auth/access";
import { isValidPass, PASS_COOKIE_NAME } from "@/lib/auth/pass";

export const config = {
  matcher: [
    /*
     * Every address except Next.js internals and plain files such as
     * images and fonts, which hold nothing private.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|otf|txt|xml|webmanifest)$).*)",
  ],
};

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  if (isOpenPath(pathname)) {
    return NextResponse.next();
  }

  const pass = request.cookies.get(PASS_COOKIE_NAME)?.value;
  if (await isValidPass(pass)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Locked" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const unlockUrl = new URL(UNLOCK_PATH, request.url);
  unlockUrl.searchParams.set("next", `${pathname}${search}`);

  const response = NextResponse.redirect(unlockUrl, 303);
  response.headers.set("cache-control", "no-store");
  return response;
}