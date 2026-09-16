/*
 * Location: menu-standards-app/src/app/api/lock/route.ts
 *
 * Ends the pass on this device, then returns to the home page.
 * Used by the Lock button in the header menu. Accepts only form posts sent
 * from this site, so another website cannot lock you out.
 */

import { NextResponse, type NextRequest } from "next/server";

import { PASS_COOKIE_NAME, passCookieOptions } from "@/lib/auth/pass";

function isSameOriginRequest(request: NextRequest): boolean {
  return request.headers.get("origin") === request.nextUrl.origin;
}

export function POST(request: NextRequest): NextResponse {
  if (!isSameOriginRequest(request)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(PASS_COOKIE_NAME, "", { ...passCookieOptions(), maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
