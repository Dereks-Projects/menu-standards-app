/*
 * Location: menu-standards-app/src/app/api/unlock/route.ts
 *
 * Receives the password form from the /unlock page.
 * - Accepts only form posts sent from this site.
 * - Checks the password slowly and adds a short pause after a wrong
 *   answer, so guessing is slow. A Vercel Firewall rule adds a hard limit
 *   on attempts.
 * - On success, sets the 7-day pass and opens the page that was requested.
 * - On failure, returns to /unlock with a message.
 * The password is never logged or stored.
 */

import { NextResponse, type NextRequest } from "next/server";

import { DEFAULT_AFTER_UNLOCK_PATH, safeNextPath, UNLOCK_PATH } from "@/lib/auth/access";
import { createPass, GateConfigurationError, PASS_COOKIE_NAME, passCookieOptions } from "@/lib/auth/pass";
import { verifyAdminPassword } from "@/lib/auth/password";

export const runtime = "nodejs";

const WRONG_ANSWER_PAUSE_MS = 750;
const MAX_FORM_BYTES = 4096;

type UnlockError = "wrong" | "setup" | "invalid";

function isSameOriginRequest(request: NextRequest): boolean {
  return request.headers.get("origin") === request.nextUrl.origin;
}

function backToUnlockPage(request: NextRequest, error: UnlockError, nextPath: string): NextResponse {
  const url = new URL(UNLOCK_PATH, request.url);
  url.searchParams.set("error", error);
  if (nextPath !== DEFAULT_AFTER_UNLOCK_PATH) {
    url.searchParams.set("next", nextPath);
  }
  return NextResponse.redirect(url, 303);
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_FORM_BYTES) {
    return backToUnlockPage(request, "invalid", DEFAULT_AFTER_UNLOCK_PATH);
  }

  let password = "";
  let nextPath = DEFAULT_AFTER_UNLOCK_PATH;
  try {
    const form = await request.formData();
    const passwordField = form.get("password");
    password = typeof passwordField === "string" ? passwordField : "";
    nextPath = safeNextPath(form.get("next"));
  } catch {
    return backToUnlockPage(request, "invalid", nextPath);
  }

  try {
    const isCorrect = await verifyAdminPassword(password);
    if (!isCorrect) {
      await pause(WRONG_ANSWER_PAUSE_MS);
      return backToUnlockPage(request, "wrong", nextPath);
    }

    const pass = await createPass();
    const response = NextResponse.redirect(new URL(nextPath, request.url), 303);
    response.cookies.set(PASS_COOKIE_NAME, pass, passCookieOptions());
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof GateConfigurationError) {
      console.error(`Password gate setup problem: ${error.message}`);
      return backToUnlockPage(request, "setup", nextPath);
    }
    throw error;
  }
}