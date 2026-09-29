/*
 * Location: menu-standards-app/src/lib/schemas/links.ts
 *
 * The secret links you hand out. Each one is read only.
 *
 * The code itself is never stored. Only a fingerprint is kept, so a
 * leaked storage file cannot open anyone's program. Client links do not
 * expire; demo links expire after 30 days. Any link can be canceled and
 * reissued, for example when a manager leaves.
 */

import { z } from "zod";

import { IdSchema, IsoDateTimeSchema, optionalText, SlugSchema } from "./common";

/** Who the link is for. */
export const LinkAudienceSchema = z.enum(["manager", "director", "student"]);

/** A client link lasts; a demo link expires. */
export const LinkKindSchema = z.enum(["client", "demo"]);

export const DEMO_LINK_DAYS = 30;

/** Length of the random part of a link, in characters. */
export const LINK_CODE_LENGTH = 32;

const LinkCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/, "A link code is 32 to 64 safe characters.");

/** The stored fingerprint of a code: 64 hexadecimal characters. */
const CodeFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/, "A fingerprint is 64 hexadecimal characters.");

export const LinkSchema = z.object({
  linkId: IdSchema,
  audience: LinkAudienceSchema,
  kind: LinkKindSchema,
  groupSlug: SlugSchema,
  /** Empty for a director link, which covers the whole group. */
  outletSlug: SlugSchema.nullable().default(null),
  programId: IdSchema.nullable().default(null),
  codeFingerprint: CodeFingerprintSchema,
  /** For your own dashboard, for example "Lido, GM". */
  label: optionalText(120).default(""),
  createdAt: IsoDateTimeSchema,
  /** Empty means it never expires. */
  expiresAt: IsoDateTimeSchema.nullable().default(null),
  revokedAt: IsoDateTimeSchema.nullable().default(null),
  lastUsedAt: IsoDateTimeSchema.nullable().default(null),
  useCount: z.number().int().nonnegative().default(0),
});

export const LinkStatusSchema = z.enum(["active", "expired", "revoked"]);

export type LinkAudience = z.infer<typeof LinkAudienceSchema>;
export type LinkKind = z.infer<typeof LinkKindSchema>;
export type Link = z.infer<typeof LinkSchema>;
export type LinkStatus = z.infer<typeof LinkStatusSchema>;

/** Checks the shape of a code taken from an address. */
export function isWellFormedCode(code: string): boolean {
  return LinkCodeSchema.safeParse(code).success;
}

export function linkStatus(link: Link, now: Date = new Date()): LinkStatus {
  if (link.revokedAt !== null) {
    return "revoked";
  }
  if (link.expiresAt !== null && new Date(link.expiresAt).getTime() <= now.getTime()) {
    return "expired";
  }
  return "active";
}

/** The address a link opens. Students learn, everyone else reads. */
export function linkPath(audience: LinkAudience, code: string): string {
  return audience === "student" ? `/learn/${code}` : `/share/${code}`;
}

/** Days left on a demo link, for the dashboard. Null when it never expires. */
export function daysRemaining(link: Link, now: Date = new Date()): number | null {
  if (link.expiresAt === null) {
    return null;
  }
  const milliseconds = new Date(link.expiresAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(milliseconds / 86400000));
}