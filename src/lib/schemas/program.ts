/*
 * Location: menu-standards-app/src/lib/schemas/program.ts
 *
 * The finished training program for one outlet. This is the contract:
 * every builder writes to it, every screen reads from it, and it is what
 * would carry over if Menu Standards ever joins another app.
 *
 * Rules held here rather than trusted to a prompt:
 * - every card names its sources, so nothing can appear without a trail,
 * - allergens are copied from the reader's result, never written by a
 *   builder,
 * - role play is capped at three exchanges,
 * - service notes must come from the service library,
 * - the checker's flags travel with the program, so nothing is shared
 *   before they are cleared.
 */

import { z } from "zod";

import {
  AiUsageSchema,
  AllergenSchema,
  IdSchema,
  IsoDateTimeSchema,
  optionalText,
  SCHEMA_VERSION,
  shortText,
  SlugSchema,
  SourceRefSchema,
  TrackSchema,
  VersionStampSchema,
} from "./common";

/** Marks anything a person changed after the build. */
export const EditStampSchema = z.object({
  editedBy: z.enum(["manager", "chef"]),
  editedAt: IsoDateTimeSchema,
});

const sources = z.array(SourceRefSchema).min(1).max(8);

/* The five formats */

/** One study card per menu item. */
export const CourseCardSchema = z.object({
  cardId: IdSchema,
  track: TrackSchema,
  itemId: IdSchema,
  title: shortText(120),
  whatItIs: shortText(400),
  keyIngredients: z.array(shortText(60)).max(12).default([]),
  /** Copied from the reader. Builders never write allergens. */
  allergens: z.array(AllergenSchema).max(20).default([]),
  howToDescribe: shortText(300),
  /** A by-the-glass pairing, when the menus support one. */
  pairingTermId: IdSchema.nullable().default(null),
  sources,
  edit: EditStampSchema.nullable().default(null),
});

/** One card per key term. */
export const FlashcardSchema = z.object({
  cardId: IdSchema,
  track: TrackSchema,
  termId: IdSchema,
  front: shortText(80),
  back: shortText(300),
  sources,
  edit: EditStampSchema.nullable().default(null),
});

/** Guest asks, server answers, scored pass or retry. Never branching. */
export const RolePlayScenarioSchema = z.object({
  scenarioId: IdSchema,
  track: TrackSchema,
  guestQuestion: shortText(300),
  modelAnswer: shortText(600),
  /** What a passing answer must contain. */
  rubric: z.array(shortText(120)).min(1).max(5),
  maxExchanges: z.literal(3),
  sources,
  edit: EditStampSchema.nullable().default(null),
});

/**
 * Most questions are built by the code from menu fields, which keeps
 * quality steady. Free text questions are the only generated ones.
 */
export const QuizQuestionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("multiple_choice"),
    questionId: IdSchema,
    prompt: shortText(300),
    options: z.array(shortText(160)).min(3).max(5),
    correctIndex: z.number().int().min(0).max(4),
    sources,
  }),
  z.object({
    kind: z.literal("free_text"),
    questionId: IdSchema,
    prompt: shortText(300),
    talkingPoints: z.array(shortText(160)).min(1).max(5),
    sources,
  }),
]);

export const QuizSchema = z.object({
  quizId: IdSchema,
  track: TrackSchema,
  sectionName: shortText(120),
  questions: z.array(QuizQuestionSchema).min(1).max(30),
  edit: EditStampSchema.nullable().default(null),
});

/** A gate, not a test. One per track. */
export const ExamSchema = z.object({
  examId: IdSchema,
  track: TrackSchema,
  passThreshold: z.number().int().min(50).max(100).default(80),
  questions: z.array(QuizQuestionSchema).min(5).max(60),
  edit: EditStampSchema.nullable().default(null),
});

/* Pre-shift */

/**
 * Notes are written and checked during the build. The manager's Generate
 * button draws from this approved pool, so no AI runs on a shared link.
 */
export const PreShiftNoteSchema = z.object({
  noteId: IdSchema,
  track: TrackSchema,
  kind: z.enum(["fun_fact", "important_note", "service_note"]),
  text: shortText(240),
  sources,
  edit: EditStampSchema.nullable().default(null),
});

export const PreShiftDaySchema = z.object({
  day: z.number().int().min(1).max(7),
  focus: shortText(120),
  noteIds: z.array(IdSchema).min(1).max(5),
});

export const PreShiftSchema = z.object({
  weeklyTheme: shortText(120),
  days: z.array(PreShiftDaySchema).min(1).max(7),
  monthlyTrack: z.array(shortText(120)).max(8).default([]),
  notePool: z.array(PreShiftNoteSchema).max(400).default([]),
});

/* Service notes */

/** Attached by matching the service library. Never written by an AI step. */
export const ServiceNoteSchema = z.object({
  noteId: IdSchema,
  entryId: IdSchema,
  itemId: IdSchema,
  track: TrackSchema,
  level: z.enum(["standard", "best_practice"]),
  text: shortText(300),
  sources,
});

/* The checker */

export const CheckFlagSchema = z.object({
  flagId: IdSchema,
  /** A blocker stops sharing. A review is worth a look. */
  severity: z.enum(["blocker", "review"]),
  area: z.enum(["course", "flashcards", "role_play", "quizzes", "exam", "pre_shift", "service_notes", "synopsis"]),
  targetId: IdSchema,
  flaggedText: shortText(400),
  reason: shortText(300),
  status: z.enum(["open", "cleared"]).default("open"),
  clearedBy: z.enum(["manager", "chef"]).nullable().default(null),
  clearedAt: IsoDateTimeSchema.nullable().default(null),
});

export const CheckReportSchema = z.object({
  ranAt: IsoDateTimeSchema,
  model: shortText(60),
  flags: z.array(CheckFlagSchema).max(400).default([]),
});

/* The program */

export const ProgramStatusSchema = z.enum(["building", "flags_open", "ready", "shared", "archived"]);

export const ProgramSchema = z.object({
  programId: IdSchema,
  schemaVersion: z.literal(SCHEMA_VERSION),
  groupSlug: SlugSchema,
  outletSlug: SlugSchema,
  /** The menus this program was built from. */
  menuIds: z.array(IdSchema).min(1).max(12),
  status: ProgramStatusSchema,
  /** Three sentences, the way a chef would describe the menu. */
  synopsis: shortText(800),
  tracks: z.array(TrackSchema).min(1).max(2),
  course: z.array(CourseCardSchema).max(400).default([]),
  flashcards: z.array(FlashcardSchema).max(600).default([]),
  rolePlay: z.array(RolePlayScenarioSchema).max(120).default([]),
  quizzes: z.array(QuizSchema).max(40).default([]),
  exams: z.array(ExamSchema).max(2).default([]),
  preShift: PreShiftSchema,
  serviceNotes: z.array(ServiceNoteSchema).max(200).default([]),
  checkReport: CheckReportSchema,
  versions: z.array(VersionStampSchema).min(1).max(200),
  usage: z.array(AiUsageSchema).max(200).default([]),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  /** Kept short, for the dashboard. */
  note: optionalText(200).default(""),
});

export type EditStamp = z.infer<typeof EditStampSchema>;
export type CourseCard = z.infer<typeof CourseCardSchema>;
export type Flashcard = z.infer<typeof FlashcardSchema>;
export type RolePlayScenario = z.infer<typeof RolePlayScenarioSchema>;
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
export type Quiz = z.infer<typeof QuizSchema>;
export type Exam = z.infer<typeof ExamSchema>;
export type PreShiftNote = z.infer<typeof PreShiftNoteSchema>;
export type PreShiftDay = z.infer<typeof PreShiftDaySchema>;
export type PreShift = z.infer<typeof PreShiftSchema>;
export type ServiceNote = z.infer<typeof ServiceNoteSchema>;
export type CheckFlag = z.infer<typeof CheckFlagSchema>;
export type CheckReport = z.infer<typeof CheckReportSchema>;
export type ProgramStatus = z.infer<typeof ProgramStatusSchema>;
export type Program = z.infer<typeof ProgramSchema>;

/** Flags still open, newest work first for the dashboard. */
export function openFlags(program: Program): CheckFlag[] {
  return program.checkReport.flags.filter((flag) => flag.status === "open");
}

/** True when nothing blocks sharing. Student links stay locked until then. */
export function isShareable(program: Program): boolean {
  return openFlags(program).every((flag) => flag.severity !== "blocker");
}

/** The current version number, used when saving an edit. */
export function currentVersion(program: Program): number {
  return program.versions.reduce((highest, stamp) => Math.max(highest, stamp.version), 0);
}

/** Total cost of every AI step in this program, in US dollars. */
export function totalCostUsd(program: Program): number {
  return program.usage.reduce((total, entry) => total + entry.costUsd, 0);
}

/** The note of the day, the same on every device, rotating by date. */
export function noteOfTheDay(program: Program, date: Date): PreShiftNote | null {
  const pool = program.preShift.notePool;
  if (pool.length === 0) {
    return null;
  }
  const daysSinceEpoch = Math.floor(date.getTime() / 86400000);
  return pool[daysSinceEpoch % pool.length] ?? null;
}