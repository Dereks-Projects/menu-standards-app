/*
 * Location: menu-standards-app/src/lib/schemas/plan.ts
 *
 * The one-page plan for one outlet: what the reader found, the synopsis,
 * the house terms the manager must confirm, and what gets built, by track.
 * Nothing is built until a plan is approved (product rule), and the
 * approved plan is what the builders work from in Phase 6.
 *
 * Every save is a new version, stored beside the outlet's menus
 * (src/lib/storage/blob.ts). Versions are never overwritten, so the plan
 * a manager approved can always be shown again exactly as it was.
 *
 * This file holds no secrets and is safe to use in browser code: the plan
 * screen checks every reply from the plan route against PlanSchema.
 *
 * Rules held here rather than trusted to a screen or a prompt:
 * - a plan includes 1 to 12 menus, the most one program is built from,
 * - every house term is pending, answered, or left out, and an answered
 *   term carries its answer,
 * - an approved plan has no pending house terms and records when it was
 *   approved; a draft records neither.
 */

import { z } from "zod";

import {
  AiUsageSchema,
  IdSchema,
  IsoDateTimeSchema,
  optionalText,
  SCHEMA_VERSION,
  shortText,
  SlugSchema,
  TrackSchema,
} from "./common";
import { MenuTypeSchema } from "./menu";

/** The most menus one program is built from (see ProgramSchema). */
export const MAX_PLAN_MENUS = 12;

/** The most menus a plan lists, included or not. */
export const MAX_LISTED_MENUS = 24;

/** The longest synopsis, and the longest answer to a house term, in characters. */
export const MAX_SYNOPSIS_LENGTH = 800;
export const MAX_ANSWER_LENGTH = 400;

/** The exam's pass mark, in percent: 80 by default (product rule), 50 to 100 if changed. */
export const DEFAULT_PASS_THRESHOLD = 80;
export const MIN_PASS_THRESHOLD = 50;
export const MAX_PASS_THRESHOLD = 100;

const count = z.number().int().nonnegative();

/** One menu the plan considered, and whether it is included. */
export const PlanMenuSchema = z.object({
  menuId: IdSchema,
  menuType: MenuTypeSchema,
  fileName: shortText(200),
  readAt: IsoDateTimeSchema,
  items: count,
  included: z.boolean(),
});

export const PlanTermStatusSchema = z.enum(["pending", "answered", "left_out"]);

/** A house term the manager confirms before the build. */
export const PlanHouseTermSchema = z
  .object({
    /** The term in matching form, "chef s pasta": one entry per term across every menu. */
    termKey: shortText(120),
    /** As printed on the menu where it was first found. */
    text: shortText(80),
    question: shortText(200),
    menuId: IdSchema,
    termId: IdSchema,
    status: PlanTermStatusSchema,
    /** The manager's answer, in their words. Empty unless answered. */
    answer: optionalText(MAX_ANSWER_LENGTH),
  })
  .refine((term) => (term.status === "answered") === (term.answer.length > 0), {
    message: "An answered term carries an answer, and only an answered term does.",
  });

/** What gets built for one track. These counts are the build's targets. */
export const PlanTrackSchema = z.object({
  track: TrackSchema,
  items: count,
  terms: count,
  courseCards: count,
  flashcards: count,
  rolePlay: count,
  quizzes: count,
  quizQuestions: count,
  examQuestions: count,
  preShiftNotes: count,
  /** Estimated minutes for one person to work through this track. */
  studyMinutes: count,
});

/** The four numbers at the top of the plan. */
export const PlanTotalsSchema = z.object({
  items: count,
  terms: count,
  houseTerms: count,
  studyMinutes: count,
});

export const PlanStatusSchema = z.enum(["draft", "approved"]);

/** What a version recorded: a new plan, saved changes, or the approval. */
export const PlanChangeSchema = z.enum(["created", "saved", "approved"]);

export const PlanSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    groupSlug: SlugSchema,
    outletSlug: SlugSchema,
    /** Counts up across every plan for this outlet: 1, 2, 3, and so on. */
    version: z.number().int().min(1).max(10000),
    status: PlanStatusSchema,
    change: PlanChangeSchema,
    menus: z.array(PlanMenuSchema).min(1).max(MAX_LISTED_MENUS),
    /** Three sentences, the way a chef would describe the menu. */
    synopsis: shortText(MAX_SYNOPSIS_LENGTH),
    houseTerms: z.array(PlanHouseTermSchema).max(200),
    tracks: z.array(PlanTrackSchema).min(1).max(2),
    totals: PlanTotalsSchema,
    /** The exam's pass mark, in percent. 80 unless the manager changes it. */
    examPassThreshold: z.number().int().min(MIN_PASS_THRESHOLD).max(MAX_PASS_THRESHOLD),
    /** The cost of writing the synopsis. Carried into the program's total. */
    usage: z.array(AiUsageSchema).max(10),
    /** When this plan was first created; kept by every later version of it. */
    createdAt: IsoDateTimeSchema,
    /** When this version was saved. */
    savedAt: IsoDateTimeSchema,
    approvedAt: IsoDateTimeSchema.nullable(),
  })
  .superRefine((plan, context) => {
    const included = plan.menus.filter((menu) => menu.included).length;
    if (included < 1 || included > MAX_PLAN_MENUS) {
      context.addIssue({
        code: "custom",
        path: ["menus"],
        message: `A plan includes 1 to ${MAX_PLAN_MENUS} menus.`,
      });
    }
    const isApproved = plan.status === "approved";
    if (isApproved !== (plan.approvedAt !== null) || isApproved !== (plan.change === "approved")) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Only an approved plan records an approval.",
      });
    }
    if (isApproved && plan.houseTerms.some((term) => term.status === "pending")) {
      context.addIssue({
        code: "custom",
        path: ["houseTerms"],
        message: "An approved plan has no house terms waiting.",
      });
    }
  });

export type PlanMenu = z.infer<typeof PlanMenuSchema>;
export type PlanTermStatus = z.infer<typeof PlanTermStatusSchema>;
export type PlanHouseTerm = z.infer<typeof PlanHouseTermSchema>;
export type PlanTrack = z.infer<typeof PlanTrackSchema>;
export type PlanTotals = z.infer<typeof PlanTotalsSchema>;
export type PlanStatus = z.infer<typeof PlanStatusSchema>;
export type Plan = z.infer<typeof PlanSchema>;

/** House terms still waiting on the manager. */
export function pendingPlanTerms(plan: Plan): PlanHouseTerm[] {
  return plan.houseTerms.filter((term) => term.status === "pending");
}

/** The menus the program is built from. */
export function includedMenus(plan: Plan): PlanMenu[] {
  return plan.menus.filter((menu) => menu.included);
}