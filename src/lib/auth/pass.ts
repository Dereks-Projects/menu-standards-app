/*
 * Location: menu-standards-app/src/lib/auth/pass.ts
 *
 * The signed pass that keeps one device unlocked for 7 days.
 *
 * This is an access and cost control for a single administrator, not a
 * user account system. The pass holds only an expiry time and a signature.
 * The signature covers the expiry and the current password fingerprint, so:
 * - a pass cannot be edited or forged without GATE_SECRET,
 * - changing the password ends every pass on every device,
 * - changing GATE_SECRET also ends every pass.
 *
 * Uses the Web Crypto API, which both src/proxy.ts and route handlers can
 * use. If the gate settings are missing, every pass is treated as invalid,
 * so the site stays locked rather than open.
 */

const PASS_VERSION = "v1";
const MIN_SECRET_LENGTH = 32;
const MAX_PASS_LENGTH = 128;

export const PASS_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const isProduction = process.env.NODE_ENV === "production";

/**
 * The __Host- prefix makes browsers reject the cookie unless it is secure,
 * site-wide, and tied to this exact domain. Local development runs without
 * https, so it uses a plain name.
 */
export const PASS_COOKIE_NAME = isProduction ? "__Host-ms_pass" : "ms_pass";

export class GateConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GateConfigurationError";
  }
}

type GateSettings = {
  readonly secret: string;
  readonly passwordHash: string;
};

/** Reads the gate settings, or throws GateConfigurationError. */
export function readGateSettings(): GateSettings {
  const secret = process.env.GATE_SECRET ?? "";
  const passwordHash = process.env.ADMIN_PASSWORD_HASH ?? "";

  if (secret.length < MIN_SECRET_LENGTH) {
    throw new GateConfigurationError("GATE_SECRET is missing or shorter than 32 characters.");
  }
  if (passwordHash.length === 0) {
    throw new GateConfigurationError("ADMIN_PASSWORD_HASH is missing.");
  }
  return { secret, passwordHash };
}

const encoder = new TextEncoder();

function importSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function signedContent(version: string, expiresAt: string, passwordHash: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`${version}.${expiresAt}.${passwordHash}`);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) {
    return null;
  }
  const padded = text
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Creates a new pass that expires in 7 days. Throws if the gate is not configured. */
export async function createPass(nowMs: number = Date.now()): Promise<string> {
  const { secret, passwordHash } = readGateSettings();
  const expiresAt = String(Math.floor(nowMs / 1000) + PASS_MAX_AGE_SECONDS);
  const key = await importSigningKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, signedContent(PASS_VERSION, expiresAt, passwordHash));
  return `${PASS_VERSION}.${expiresAt}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Returns true only for an unexpired pass signed with the current settings. */
export async function isValidPass(pass: string | undefined, nowMs: number = Date.now()): Promise<boolean> {
  if (!pass || pass.length > MAX_PASS_LENGTH) {
    return false;
  }

  const parts = pass.split(".");
  if (parts.length !== 3) {
    return false;
  }
  const [version, expiresAt, signatureText] = parts;
  if (version !== PASS_VERSION || !/^\d{1,12}$/.test(expiresAt)) {
    return false;
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  const expiresAtSeconds = Number(expiresAt);
  if (expiresAtSeconds <= nowSeconds || expiresAtSeconds > nowSeconds + PASS_MAX_AGE_SECONDS) {
    return false;
  }

  const signature = fromBase64Url(signatureText);
  if (signature === null) {
    return false;
  }

  let settings: GateSettings;
  try {
    settings = readGateSettings();
  } catch {
    return false;
  }

  const key = await importSigningKey(settings.secret);
  return crypto.subtle.verify("HMAC", key, signature, signedContent(version, expiresAt, settings.passwordHash));
}

/** Cookie settings for the pass. JavaScript on the page can never read it. */
export function passCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: PASS_MAX_AGE_SECONDS,
  };
}