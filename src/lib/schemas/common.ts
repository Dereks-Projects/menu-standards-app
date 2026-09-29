/*
 * Location: menu-standards-app/src/lib/schemas/common.ts
 *
 * The small pieces every other schema is built from: identifiers, tracks,
 * allergens, source references, version stamps, and AI usage records.
 *
 * Each schema does two jobs at once. At run time it checks data, including
 * every answer an AI step returns. Before the code runs, TypeScript reads
 * the same definition to check our own code.
 */

import { z } from "zod";

/** Raised whenever stored files no longer match these definitions. */
export const SCHEMA_VERSION = 1;

/* Text helpers */

/** Trimmed text that must not be empty. */
export function shortText(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

/** Trimmed text that may be empty. */
export function optionalText(maxLength: number) {
  return z.string().trim().max(maxLength);
}

/* Identifiers */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MESSAGE = "Use lowercase letters, numbers, and single hyphens.";

/**
 * Addresses in the browser bar: /{groupSlug}/{outletSlug}. Never renamed
 * once issued, because links already handed out must keep working.
 */
export const SlugSchema = z.string().regex(SLUG_PATTERN, SLUG_MESSAGE).min(2).max(40);

/**
 * Identifiers inside a program, built by the code from the text they name,
 * for example "sancerre" or "steak-tartare-2". Readable identifiers keep
 * the checker's flags and the source trail easy to follow.
 */
export const IdSchema = z.string().regex(SLUG_PATTERN, SLUG_MESSAGE).min(1).max(64);

/** A date and time in ISO form, for example 2026-09-24T18:30:00Z. */
export const IsoDateTimeSchema = z.iso.datetime();

/* Shared vocabulary */

/** Food or beverage. Tagged on each item and term, never on the upload. */
export const TrackSchema = z.enum(["food", "beverage"]);

/**
 * Universal terms come from the foundations library. House terms come only
 * from the upload and are what the manager confirms.
 */
export const TermOriginSchema = z.enum(["universal", "house"]);

export const TermKindSchema = z.enum([
  "dish",
  "ingredient",
  "technique",
  "allergen",
  "grape",
  "region",
  "producer",
  "style",
  "spirit",
  "modifier",
  "cocktail",
  "other",
]);

/** How sure the reader is, from 0 to 1. */
export const ConfidenceSchema = z.number().min(0).max(1);

/* Allergens */

export const AllergenNameSchema = z.enum([
  "milk",
  "eggs",
  "fish",
  "shellfish",
  "molluscs",
  "tree_nuts",
  "peanuts",
  "wheat",
  "gluten",
  "soy",
  "sesame",
  "mustard",
  "celery",
  "lupin",
  "sulfites",
  "other",
]);

/**
 * Allergen information is never generated. It is read from the menu,
 * confirmed by the chef, or marked as needing confirmation.
 */
export const AllergenStatusSchema = z.enum(["on_menu", "chef_confirmed", "confirm_with_chef"]);

export const AllergenSchema = z.object({
  allergen: AllergenNameSchema,
  status: AllergenStatusSchema,
  /** The menu's own wording, or the chef's note. */
  note: optionalText(200).default(""),
});

/* Traceability */

/** What a piece of built content came from. */
export const SourceKindSchema = z.enum(["menu_item", "menu_term", "service_entry", "foundation_term"]);

/**
 * Every built card carries at least one of these. Before the checker runs,
 * the code confirms each identifier points at something that exists.
 */
export const SourceRefSchema = z.object({
  kind: SourceKindSchema,
  id: IdSchema,
  /** The menu this came from, when it came from a menu. */
  menuId: IdSchema.nullable().default(null),
});

/* History and cost */

/** Who changed a program, and when. */
export const VersionStampSchema = z.object({
  version: z.number().int().positive(),
  createdAt: IsoDateTimeSchema,
  author: z.enum(["engine", "manager", "chef"]),
  note: optionalText(200).default(""),
});

export const AiStepSchema = z.enum(["reader", "planner", "builder", "checker", "role_play"]);

/** One AI request, recorded so the dashboard can show cost per build. */
export const AiUsageSchema = z.object({
  step: AiStepSchema,
  model: shortText(60),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});

export type Slug = z.infer<typeof SlugSchema>;
export type Id = z.infer<typeof IdSchema>;
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type TermOrigin = z.infer<typeof TermOriginSchema>;
export type TermKind = z.infer<typeof TermKindSchema>;
export type AllergenName = z.infer<typeof AllergenNameSchema>;
export type AllergenStatus = z.infer<typeof AllergenStatusSchema>;
export type Allergen = z.infer<typeof AllergenSchema>;
export type SourceKind = z.infer<typeof SourceKindSchema>;
export type SourceRef = z.infer<typeof SourceRefSchema>;
export type VersionStamp = z.infer<typeof VersionStampSchema>;
export type AiStep = z.infer<typeof AiStepSchema>;
export type AiUsage = z.infer<typeof AiUsageSchema>;