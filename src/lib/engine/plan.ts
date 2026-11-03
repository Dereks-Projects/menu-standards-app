/*
 * Location: menu-standards-app/src/lib/engine/plan.ts
 *
 * The planner: turns an outlet's read menus into its one-page plan, and
 * applies the manager's answers, adjustments, and approval to it.
 *
 * Code does almost all of the work, so the plan comes out the same every
 * time for the same menus:
 * - which menus are included: the newest read of each file, without the
 *   full wine list, unless the manager chooses,
 * - the four numbers and what gets built for each track, from the fixed
 *   rules below,
 * - the house terms to confirm, gathered across menus, one entry per term.
 * The AI writes one thing: the three-sentence synopsis (prompts/plan.md).
 * Every word it names must be printed on the menus; anything else earns
 * one corrected retry (see client.ts), then the plan stops.
 *
 * The engine never touches storage. The plan route reads the menus and
 * saves each version, the same split as the reader (decision 52).
 */

import { z } from "zod";

import { type AiContent, askForJson } from "@/lib/ai/client";
import { composePrompt } from "@/lib/ai/prompts";
import { SCHEMA_VERSION, type Track } from "@/lib/schemas/common";
import type { Menu, MenuType } from "@/lib/schemas/menu";
import {
  DEFAULT_PASS_THRESHOLD,
  MAX_ANSWER_LENGTH,
  MAX_LISTED_MENUS,
  MAX_PASS_THRESHOLD,
  MAX_PLAN_MENUS,
  MAX_SYNOPSIS_LENGTH,
  MIN_PASS_THRESHOLD,
  type Plan,
  type PlanHouseTerm,
  type PlanMenu,
  PlanSchema,
  type PlanTrack,
} from "@/lib/schemas/plan";

/* Build rules: what gets built, from what the menus hold */

/** The most course cards and flashcards one program holds (see ProgramSchema). */
const MAX_COURSE_CARDS = 400;
const MAX_FLASHCARDS = 600;

/** The most house terms one plan asks about. */
const MAX_HOUSE_TERMS = 200;

/** Role play: one scenario for every five items, at least two, at most twelve per track. */
const ROLE_PLAY_ITEMS_EACH = 5;
const ROLE_PLAY_MIN = 2;
const ROLE_PLAY_MAX = 12;

/** Quizzes: one per menu section, 3 to 10 questions each, at most 20 per track. */
const QUIZ_QUESTIONS_MIN = 3;
const QUIZ_QUESTIONS_MAX = 10;
const QUIZZES_MAX = 20;

/** Exam: about six questions for every ten items, 5 to 40 per track. */
const EXAM_SHARE = 0.6;
const EXAM_MIN = 5;
const EXAM_MAX = 40;

/** Pre-shift notes: one per item, 5 to 60 per track. */
const PRE_SHIFT_MIN = 5;
const PRE_SHIFT_MAX = 60;

/** Minutes one person spends on each piece, for the study time estimate. */
const MINUTES = {
  courseCard: 1,
  flashcard: 0.25,
  rolePlay: 2,
  quizQuestion: 0.5,
  examQuestion: 0.5,
} as const;

/** Each description sent to the planner is cut to this length. */
const MAX_DESCRIPTION_SENT = 300;

const TRACK_ORDER: readonly Track[] = ["food", "beverage"];

const MENU_TYPE_LABELS: Readonly<Record<MenuType, string>> = {
  food: "food menu",
  cocktail: "cocktail menu",
  by_the_glass: "wines by the glass",
  bar: "bar menu",
  wine_list: "full wine list",
  non_alcoholic: "non-alcoholic menu",
  specials: "specials",
  other: "other",
};

/** A request the planner refuses before spending anything, in words for the screen. */
export class PlanRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanRuleError";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* Matching the menus' own words, the same rule as the reader (read.ts) */

/** Lowercase, accents removed, punctuation to single spaces: "Crème Brûlée!" to "creme brulee". */
function forMatching(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True when the text appears in any of the places as whole words. A simple plural counts. */
function appearsIn(text: string, places: readonly string[]): boolean {
  const needle = forMatching(text);
  if (needle.length === 0) {
    return false;
  }
  const forms = [needle, `${needle}s`, `${needle}es`];
  if (needle.endsWith("s")) {
    forms.push(needle.slice(0, -1));
  }
  return places.some((place) => forms.some((form) => ` ${place} `.includes(` ${form} `)));
}

/* Choosing menus */

/** Newest first. */
function byNewest(menus: readonly Menu[]): Menu[] {
  return [...menus].sort((a, b) => b.readAt.localeCompare(a.readAt));
}

/**
 * The menus a new plan includes unless the manager chooses: the newest
 * read of each file, so reading a menu twice never counts it twice. At most
 * MAX_PLAN_MENUS, newest first.
 *
 * A full wine list is left out until the manager includes it (product rule:
 * wines by the glass by default, the full list by choice). If a wine list
 * is the only menu read, nothing is chosen, and the screen asks.
 */
export function defaultMenuSelection(menus: readonly Menu[]): string[] {
  const seen = new Set<string>();
  const chosen: string[] = [];
  for (const menu of byNewest(menus)) {
    const key = `${menu.menuType}|${menu.sourceFile.fileName.toLowerCase()}`;
    if (menu.menuType === "wine_list" || seen.has(key)) {
      continue;
    }
    seen.add(key);
    chosen.push(menu.menuId);
  }
  return chosen.slice(0, MAX_PLAN_MENUS);
}

/* The figures */

export type PlanFigures = {
  readonly tracks: PlanTrack[];
  readonly totals: Plan["totals"];
  readonly houseTerms: PlanHouseTerm[];
};

type TrackTally = {
  items: number;
  terms: Set<string>;
  /** Items in each section, keyed by menu and section. */
  sections: Map<string, number>;
};

function studyMinutes(track: Omit<PlanTrack, "studyMinutes">): number {
  const minutes =
    track.courseCards * MINUTES.courseCard +
    track.flashcards * MINUTES.flashcard +
    track.rolePlay * MINUTES.rolePlay +
    track.quizQuestions * MINUTES.quizQuestion +
    track.examQuestions * MINUTES.examQuestion;
  return Math.max(5, Math.round(minutes / 5) * 5);
}

function trackPlan(track: Track, tally: TrackTally): PlanTrack {
  const sectionSizes = [...tally.sections.values()].sort((a, b) => b - a).slice(0, QUIZZES_MAX);
  const base = {
    track,
    items: tally.items,
    terms: tally.terms.size,
    courseCards: tally.items,
    flashcards: tally.terms.size,
    rolePlay: clamp(Math.ceil(tally.items / ROLE_PLAY_ITEMS_EACH), Math.min(tally.items, ROLE_PLAY_MIN), ROLE_PLAY_MAX),
    quizzes: sectionSizes.length,
    quizQuestions: sectionSizes.reduce((total, size) => total + clamp(size, QUIZ_QUESTIONS_MIN, QUIZ_QUESTIONS_MAX), 0),
    examQuestions: clamp(Math.ceil(tally.items * EXAM_SHARE), EXAM_MIN, EXAM_MAX),
    preShiftNotes: clamp(tally.items, PRE_SHIFT_MIN, PRE_SHIFT_MAX),
  };
  return { ...base, studyMinutes: studyMinutes(base) };
}

/**
 * The four numbers, what gets built for each track, and the house terms to
 * confirm, all worked out from the included menus. Throws PlanRuleError
 * when the menus hold nothing to build, or more than one program can hold.
 */
export function planFigures(menus: readonly Menu[]): PlanFigures {
  const tallies = new Map<Track, TrackTally>();
  const allTerms = new Set<string>();
  const houseTerms = new Map<string, PlanHouseTerm>();

  for (const menu of menus) {
    for (const section of menu.sections) {
      for (const item of section.items) {
        const tally = tallies.get(item.track) ?? { items: 0, terms: new Set<string>(), sections: new Map() };
        tally.items += 1;
        const sectionKey = `${menu.menuId}|${section.sectionId}`;
        tally.sections.set(sectionKey, (tally.sections.get(sectionKey) ?? 0) + 1);
        tallies.set(item.track, tally);
      }
    }
    for (const term of menu.terms) {
      const key = forMatching(term.text);
      if (key.length === 0) {
        continue;
      }
      allTerms.add(key);
      const tally = tallies.get(term.track) ?? { items: 0, terms: new Set<string>(), sections: new Map() };
      tally.terms.add(key);
      tallies.set(term.track, tally);
    }
    for (const entry of menu.houseTermsToConfirm) {
      const key = forMatching(entry.text);
      if (entry.status !== "pending" || key.length === 0 || houseTerms.has(key)) {
        continue;
      }
      houseTerms.set(key, {
        termKey: key.slice(0, 120),
        text: entry.text,
        question: entry.question,
        menuId: menu.menuId,
        termId: entry.termId,
        status: "pending",
        answer: "",
      });
    }
  }

  const tracks = TRACK_ORDER.flatMap((track) => {
    const tally = tallies.get(track);
    return tally !== undefined && tally.items > 0 ? [trackPlan(track, tally)] : [];
  });
  if (tracks.length === 0) {
    throw new PlanRuleError("The chosen menus hold no items to build from.");
  }

  const items = tracks.reduce((total, track) => total + track.items, 0);
  if (items > MAX_COURSE_CARDS) {
    throw new PlanRuleError(
      `The chosen menus hold ${items} items, and one program holds at most ${MAX_COURSE_CARDS}. Leave out the full wine list or another large menu.`,
    );
  }
  const flashcards = tracks.reduce((total, track) => total + track.flashcards, 0);
  if (flashcards > MAX_FLASHCARDS) {
    throw new PlanRuleError(
      `The chosen menus hold ${flashcards} key terms, and one program holds at most ${MAX_FLASHCARDS}. Leave out a large menu.`,
    );
  }
  if (houseTerms.size > MAX_HOUSE_TERMS) {
    throw new PlanRuleError(
      `The chosen menus raise ${houseTerms.size} house terms to confirm, more than one plan can ask about (${MAX_HOUSE_TERMS}). Leave out a menu.`,
    );
  }

  return {
    tracks,
    houseTerms: [...houseTerms.values()],
    totals: {
      items,
      terms: allTerms.size,
      houseTerms: houseTerms.size,
      studyMinutes: tracks.reduce((total, track) => total + track.studyMinutes, 0),
    },
  };
}

/* The synopsis */

/** The answer shape sent to OpenAI: every field required, no limits. */
export const PlannerAnswerSchema = z.object({
  synopsis: z.string(),
  mentions: z.array(z.string()),
});

type PlannerAnswer = z.infer<typeof PlannerAnswerSchema>;

const MAX_MENTIONS = 12;

/** Dashes used to join phrases: hyphen-like dashes, and a hyphen with spaces around it. */
const DASH_PATTERN = /[\u2012-\u2015\u2212]|\s-\s/;

/** Allergen and diet claims, which belong to the menus and the chef, never the synopsis. */
const ALLERGEN_PATTERN = /allergen|gluten[\s-]?free|dairy[\s-]?free|nut[\s-]?free|\bfree of\b|\bsafe for\b/i;

/** Web addresses, email addresses, and phone numbers, which never belong in a synopsis the AI writes. */
const ADDRESS_PATTERN = /https?:\/\/|\bwww\.|[\w.+-]+@[\w-]+\.|\b[\w-]+\.(?:com|net|org|io|ai|co|us)\b/i;
const PHONE_PATTERN = /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/;

/** The most problems of one kind sent back for a corrected attempt. */
const MAX_PROBLEMS_EACH = 5;

/**
 * The capitalized words after the first word of each sentence: the names a
 * synopsis uses. A possessive ending is dropped, so "Lido's" is "Lido".
 */
function capitalizedWords(synopsis: string): string[] {
  const names = new Set<string>();
  for (const sentence of synopsis.split(/(?<=[.!?])\s+/)) {
    for (const word of sentence.split(/\s+/).slice(1)) {
      const bare = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/['\u2019]s$/u, "");
      if (/^\p{Lu}/u.test(bare)) {
        names.add(bare);
      }
    }
  }
  return [...names];
}

/** Sentences, counted by their closing marks. */
function sentenceCount(text: string): number {
  return (text.match(/[.!?](?=\s|$)/g) ?? []).length;
}

/** Problems with synopsis text, whoever wrote it. An empty list means it is fine. */
export function synopsisProblems(synopsis: string): string[] {
  const problems: string[] = [];
  if (synopsis.length === 0) {
    problems.push("The synopsis is empty.");
  }
  if (synopsis.length > MAX_SYNOPSIS_LENGTH) {
    problems.push(`The synopsis is ${synopsis.length} characters; keep it to ${MAX_SYNOPSIS_LENGTH}.`);
  }
  if (DASH_PATTERN.test(synopsis)) {
    problems.push("The synopsis joins phrases with a dash. Use a comma or a new sentence instead.");
  }
  if (ALLERGEN_PATTERN.test(synopsis)) {
    problems.push("The synopsis mentions allergens or diets. Leave them out.");
  }
  return problems;
}

/** Collapses spacing, so the stored text is tidy whoever wrote it. */
function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Every word the menus print, in matching form: the outlet's name, sections, items, terms, and house terms. */
export function menuWords(outletName: string, menus: readonly Menu[]): string[] {
  const words = [forMatching(outletName)];
  for (const menu of menus) {
    for (const section of menu.sections) {
      words.push(forMatching(section.name));
      for (const item of section.items) {
        words.push(forMatching(item.name), forMatching(item.description));
      }
    }
    for (const term of menu.terms) {
      words.push(forMatching(term.text));
    }
    for (const entry of menu.houseTermsToConfirm) {
      words.push(forMatching(entry.text));
    }
  }
  return words.filter((word) => word.length > 0);
}

/**
 * Applies the rules the answer shape cannot carry: three sentences, no
 * dashes, no allergen talk, no web addresses, email addresses, or phone
 * numbers, every mention printed both in the synopsis and on the menus, and
 * every capitalized word inside a sentence printed on the menus. The last
 * rule catches a name the planner invented, or one planted in a menu's
 * text, even when it is left off the mentions. Problems go back to the AI
 * for one corrected attempt.
 */
export function checkPlannerAnswer(
  answer: PlannerAnswer,
  words: readonly string[],
): { ok: true; value: string } | { ok: false; problems: string[] } {
  const synopsis = tidy(answer.synopsis);
  const problems = synopsisProblems(synopsis);

  // The prompt asks for three. Two to four are accepted, since a name such
  // as "St. Germain" can add a period that is not a sentence.
  const sentences = sentenceCount(synopsis);
  if (synopsis.length > 0 && (sentences < 2 || sentences > 4)) {
    problems.push(`Write exactly three sentences; this answer has ${sentences}.`);
  }

  const mentions = answer.mentions.map(tidy).filter((mention) => mention.length > 0);
  if (mentions.length === 0) {
    problems.push("List at least one mention.");
  }
  if (mentions.length > MAX_MENTIONS) {
    problems.push(`List at most ${MAX_MENTIONS} mentions.`);
  }
  const synopsisWords = [forMatching(synopsis)];
  for (const mention of mentions.slice(0, MAX_MENTIONS)) {
    if (!appearsIn(mention, words)) {
      problems.push(`"${mention}" is not printed on the menus. Name only what the menus print.`);
    } else if (!appearsIn(mention, synopsisWords)) {
      problems.push(`"${mention}" is listed as a mention but does not appear in the synopsis.`);
    }
  }

  if (ADDRESS_PATTERN.test(synopsis) || PHONE_PATTERN.test(synopsis)) {
    problems.push("The synopsis contains a web address, an email address, or a phone number. Leave it out.");
  }
  const unprinted = capitalizedWords(synopsis).filter((name) => !appearsIn(name, words));
  for (const name of unprinted.slice(0, MAX_PROBLEMS_EACH)) {
    problems.push(
      `"${name}" is capitalized as a name but is not printed on the menus. Capitalize only the first word of each sentence and names the menus print.`,
    );
  }

  return problems.length === 0 ? { ok: true, value: synopsis } : { ok: false, problems };
}

/** The menus as the planner sees them: names, descriptions, and tracks only. No prices or allergens. */
function plannerContent(outletName: string, menus: readonly Menu[]): AiContent[] {
  const data = {
    restaurant: outletName,
    menus: menus.map((menu) => ({
      type: MENU_TYPE_LABELS[menu.menuType],
      sections: menu.sections.map((section) => ({
        name: section.name,
        items: section.items.map((item) => ({
          name: item.name,
          description: item.description.slice(0, MAX_DESCRIPTION_SENT),
          track: item.track,
        })),
      })),
    })),
  };
  return [{ kind: "text", text: `The restaurant's menus, as data:\n${JSON.stringify(data)}` }];
}

/* Creating a plan */

export type CreatePlanInput = {
  readonly groupSlug: string;
  readonly outletSlug: string;
  /** The outlet's name as it should appear in the synopsis (content, not branding). */
  readonly outletName: string;
  /** Every menu read for this outlet that the plan may list, at most 24. */
  readonly menus: readonly Menu[];
  readonly includedMenuIds: readonly string[];
  /** The number this version is saved as. */
  readonly version: number;
  /** The outlet's latest plan, if any, so earlier answers carry forward. */
  readonly previous: Plan | null;
  readonly now?: Date;
};

function planMenus(menus: readonly Menu[], included: ReadonlySet<string>): PlanMenu[] {
  return byNewest(menus).map((menu) => ({
    menuId: menu.menuId,
    menuType: menu.menuType,
    fileName: menu.sourceFile.fileName,
    readAt: menu.readAt,
    items: menu.sections.reduce((total, section) => total + section.items.length, 0),
    included: included.has(menu.menuId),
  }));
}

function checkCreateInput(input: CreatePlanInput): Set<string> {
  if (input.menus.length === 0) {
    throw new PlanRuleError("No menus have been read for this outlet yet.");
  }
  if (input.menus.length > MAX_LISTED_MENUS) {
    throw new PlanRuleError(`A plan can list at most ${MAX_LISTED_MENUS} menus.`);
  }
  for (const menu of input.menus) {
    if (menu.groupSlug !== input.groupSlug || menu.outletSlug !== input.outletSlug) {
      throw new PlanRuleError("A menu belongs to another outlet.");
    }
  }
  const included = new Set(input.includedMenuIds);
  if (included.size !== input.includedMenuIds.length) {
    throw new PlanRuleError("A menu was chosen twice.");
  }
  if (included.size === 0 || included.size > MAX_PLAN_MENUS) {
    throw new PlanRuleError(`Choose 1 to ${MAX_PLAN_MENUS} menus.`);
  }
  const known = new Set(input.menus.map((menu) => menu.menuId));
  if ([...included].some((menuId) => !known.has(menuId))) {
    throw new PlanRuleError("A chosen menu was not found for this outlet.");
  }
  return included;
}

/**
 * Creates a draft plan from the chosen menus: the figures in code, the
 * synopsis from the planner. Answers from the outlet's previous plan carry
 * forward to the same terms. Throws PlanRuleError before spending anything
 * when the request is unusable, and AiStepError (see client.ts) when the
 * synopsis fails; that error carries the cost of every attempt.
 */
export async function createPlan(input: CreatePlanInput): Promise<Plan> {
  const included = checkCreateInput(input);
  const chosen = byNewest(input.menus.filter((menu) => included.has(menu.menuId)));
  const figures = planFigures(chosen);

  const earlier = new Map((input.previous?.houseTerms ?? []).map((term) => [term.termKey, term]));
  const houseTerms = figures.houseTerms.map((term) => {
    const before = earlier.get(term.termKey);
    return before === undefined || before.status === "pending"
      ? term
      : { ...term, status: before.status, answer: before.answer };
  });

  const words = menuWords(input.outletName, chosen);
  const result = await askForJson({
    step: "planner",
    instructions: await composePrompt(["plan"]),
    content: plannerContent(input.outletName, chosen),
    answerShape: PlannerAnswerSchema,
    answerName: "plan_synopsis",
    check: (answer) => checkPlannerAnswer(answer, words),
  });

  const now = (input.now ?? new Date()).toISOString();
  return PlanSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    groupSlug: input.groupSlug,
    outletSlug: input.outletSlug,
    version: input.version,
    status: "draft",
    change: "created",
    menus: planMenus(input.menus, included),
    synopsis: result.value,
    houseTerms,
    tracks: figures.tracks,
    totals: { ...figures.totals, houseTerms: houseTerms.length },
    examPassThreshold: input.previous?.examPassThreshold ?? DEFAULT_PASS_THRESHOLD,
    usage: [...result.usage],
    createdAt: now,
    savedAt: now,
    approvedAt: null,
  });
}

/* Changing a plan */

/** What the plan screen sends: the synopsis as edited, the pass mark, and the answers. */
export const PlanChangesSchema = z.strictObject({
  synopsis: z.string().max(2000),
  examPassThreshold: z.number().int().min(MIN_PASS_THRESHOLD).max(MAX_PASS_THRESHOLD),
  answers: z
    .array(
      z.strictObject({
        termKey: z.string().min(1).max(120),
        answer: z.string().max(2000),
        leftOut: z.boolean(),
      }),
    )
    .max(200),
});

export type PlanChanges = z.infer<typeof PlanChangesSchema>;

function applyChanges(plan: Plan, changes: PlanChanges): Pick<Plan, "synopsis" | "examPassThreshold" | "houseTerms"> {
  if (plan.status !== "draft") {
    throw new PlanRuleError("This plan is approved and locked. Start a new plan to change it.");
  }

  const synopsis = tidy(changes.synopsis);
  const problems = synopsisProblems(synopsis);
  if (problems.length > 0) {
    throw new PlanRuleError(problems[0] ?? "The synopsis cannot be saved.");
  }

  const answers = new Map<string, PlanChanges["answers"][number]>();
  for (const entry of changes.answers) {
    if (answers.has(entry.termKey)) {
      throw new PlanRuleError("A house term was answered twice.");
    }
    answers.set(entry.termKey, entry);
  }
  const known = new Set(plan.houseTerms.map((term) => term.termKey));
  if ([...answers.keys()].some((termKey) => !known.has(termKey))) {
    throw new PlanRuleError("An answer refers to a house term that is not on this plan.");
  }

  const houseTerms = plan.houseTerms.map((term): PlanHouseTerm => {
    const entry = answers.get(term.termKey);
    if (entry === undefined) {
      return term;
    }
    const answer = tidy(entry.answer);
    if (answer.length > MAX_ANSWER_LENGTH) {
      throw new PlanRuleError(`The answer for ${term.text} is too long; keep it to ${MAX_ANSWER_LENGTH} characters.`);
    }
    if (entry.leftOut) {
      return { ...term, status: "left_out", answer: "" };
    }
    return answer.length > 0 ? { ...term, status: "answered", answer } : { ...term, status: "pending", answer: "" };
  });

  return { synopsis, examPassThreshold: changes.examPassThreshold, houseTerms };
}

/** Saves the manager's changes as a new draft version. */
export function revisePlan(plan: Plan, changes: PlanChanges, version: number, now: Date = new Date()): Plan {
  return PlanSchema.parse({
    ...plan,
    ...applyChanges(plan, changes),
    version,
    status: "draft",
    change: "saved",
    savedAt: now.toISOString(),
    approvedAt: null,
  });
}

/**
 * Saves the manager's changes and approves the plan, as a new version.
 * Every house term must be answered or left out first.
 */
export function approvePlan(plan: Plan, changes: PlanChanges, version: number, now: Date = new Date()): Plan {
  const applied = applyChanges(plan, changes);
  const waiting = applied.houseTerms.filter((term) => term.status === "pending").length;
  if (waiting > 0) {
    throw new PlanRuleError(
      `Answer or leave out every house term before approving: ${waiting} ${waiting === 1 ? "is" : "are"} still waiting.`,
    );
  }
  const stamp = now.toISOString();
  return PlanSchema.parse({
    ...plan,
    ...applied,
    version,
    status: "approved",
    change: "approved",
    savedAt: stamp,
    approvedAt: stamp,
  });
}