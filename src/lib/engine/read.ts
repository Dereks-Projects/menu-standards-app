/*
 * Location: menu-standards-app/src/lib/engine/read.ts
 *
 * The reader: turns one uploaded menu file into a stored menu record.
 *
 * The engine never touches storage. It receives the file itself and returns
 * the record; the read route fetches the file and saves the result. That
 * keeps the engine portable, and lets the test command run it on menus in
 * the private folder.
 *
 * The AI reads the file and answers in a fixed shape (ReaderAnswerSchema,
 * below). The code then applies every rule a shape cannot carry
 * (decision 42):
 * - Allergens are recorded only as read from the menu ("on_menu"). The
 *   shape gives the AI no way to flag, confirm, or guess one.
 * - Every term and every house-term question must appear in the menu's own
 *   words. Anything else is dropped and counted, never stored.
 * - Lengths and counts are checked against ReaderMenuSchema. A failure earns
 *   one corrected retry (see client.ts), then the read stops.
 * - Identifiers are assigned here, never by the AI, so later steps can rely
 *   on them.
 * - Terms from every item are gathered into one list, and each house term
 *   the AI asked about becomes a question waiting for the manager.
 */

import { randomBytes } from "node:crypto";

import { z } from "zod";

import { type AiContent, askForJson } from "@/lib/ai/client";
import type { ModelId, ReasoningEffort } from "@/lib/ai/models";
import { composePrompt, type PromptName } from "@/lib/ai/prompts";
import {
  AllergenNameSchema,
  IdSchema,
  IsoDateTimeSchema,
  SlugSchema,
  TermKindSchema,
  TermOriginSchema,
  TrackSchema,
} from "@/lib/schemas/common";
import {
  type HouseTermConfirmation,
  type Menu,
  type MenuItem,
  MenuSchema,
  type MenuSection,
  type MenuType,
  type ReaderMenu,
  ReaderMenuSchema,
  type Term,
} from "@/lib/schemas/menu";

/** The most distinct terms one menu record can hold (see MenuSchema). */
const MAX_TERMS_PER_MENU = 600;

/** Room for a "-2" style ending within the 64-character identifier limit. */
const MAX_ID_BASE_LENGTH = 56;

const PROMPT_FOR_TYPE: Readonly<Record<MenuType, PromptName>> = {
  food: "read-food",
  cocktail: "read-cocktail",
  by_the_glass: "read-btg",
  bar: "read-bar",
  wine_list: "read-wine-list",
  non_alcoholic: "read-non-alcoholic",
  specials: "read-specials",
  other: "read-other",
};

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

/* The answer shape sent to OpenAI: every field required, no limits. */

export const ReaderAnswerSchema = z.object({
  sections: z.array(
    z.object({
      name: z.string(),
      items: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
          price: z.object({
            printed: z.string(),
            amount: z.number().nullable(),
            currency: z.string(),
          }),
          track: TrackSchema,
          allergens: z.array(z.object({ allergen: AllergenNameSchema, note: z.string() })),
          consumerAdvisory: z.boolean(),
          terms: z.array(
            z.object({
              text: z.string(),
              kind: TermKindSchema,
              origin: TermOriginSchema,
              track: TrackSchema,
              confidence: z.number(),
            }),
          ),
        }),
      ),
    }),
  ),
  houseTermsToConfirm: z.array(z.object({ text: z.string(), question: z.string() })),
  consumerAdvisoryText: z.string(),
  readerNotes: z.array(z.string()),
});

type ReaderAnswer = z.infer<typeof ReaderAnswerSchema>;

/* Inputs and results */

export type MenuFileType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

export type MenuFile = {
  /** The name shown to people, for example "Dinner Menu.pdf". */
  readonly fileName: string;
  readonly contentType: MenuFileType;
  readonly bytes: Uint8Array;
  /** Where the file is kept. Recorded, never shown. */
  readonly blobPath: string;
  /** When the file was uploaded, in ISO form. */
  readonly uploadedAt: string;
};

export type ReadMenuInput = {
  readonly menuId: string;
  readonly groupSlug: string;
  readonly outletSlug: string;
  readonly menuType: MenuType;
  readonly file: MenuFile;
  /** Overrides, for comparing models at Milestone 1. */
  readonly model?: ModelId;
  readonly effort?: ReasoningEffort;
};

export type ReadMenuResult = {
  readonly menu: Menu;
  readonly attempts: number;
  /** Terms the AI listed that do not appear in the menu's words. */
  readonly droppedTerms: number;
  /** House-term questions about words that do not appear in the menu. */
  readonly droppedQuestions: number;
};

/** A request the reader refuses before spending anything. */
export class ReadInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadInputError";
  }
}

/** A new menu identifier, for example "by-the-glass-3fa9c2d1". */
export function newMenuId(menuType: MenuType): string {
  return `${menuType.replace(/_/g, "-")}-${randomBytes(4).toString("hex")}`;
}

/* Matching the menu's own words */

/** Lowercase, accents removed, punctuation to single spaces: "Crème Brûlée!" to "creme brulee". */
function forMatching(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * True when the text appears in any of the places as whole words, so "(V)"
 * matches "Shaved Ice (V)" but not "available". A simple plural counts, so
 * "oyster" matches "oysters". Places must already be passed through
 * forMatching.
 */
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

/** The menu's own words around one item: its section, name, description, and price. */
function itemWords(sectionName: string, item: ReaderAnswer["sections"][number]["items"][number]): string[] {
  return [sectionName, item.name, item.description, item.price.printed].map(forMatching);
}

/* Checking the answer */

type CheckedReading = {
  readonly reading: ReaderMenu;
  readonly droppedTerms: number;
  readonly droppedQuestions: number;
};

/**
 * Applies the rules the answer shape cannot carry, then checks every length
 * and count. Problems go back to the AI for one corrected attempt.
 */
export function checkReaderAnswer(
  answer: ReaderAnswer,
  menuType: MenuType,
): { ok: true; value: CheckedReading } | { ok: false; problems: string[] } {
  let droppedTerms = 0;
  const everyItemsWords: string[] = [];

  const sections = answer.sections.map((section) => ({
    name: section.name,
    items: section.items.map((item) => {
      const words = itemWords(section.name, item);
      everyItemsWords.push(...words);

      const terms = item.terms.filter((term) => {
        const printed = appearsIn(term.text, words);
        if (!printed) {
          droppedTerms += 1;
        }
        return printed;
      });

      const seenAllergens = new Set<string>();
      const allergens = item.allergens
        .filter((entry) => {
          const repeat = seenAllergens.has(entry.allergen);
          seenAllergens.add(entry.allergen);
          return !repeat;
        })
        .map((entry) => ({ allergen: entry.allergen, status: "on_menu" as const, note: entry.note }));

      return {
        name: item.name,
        description: item.description,
        price: {
          printed: item.price.printed,
          amount: item.price.amount,
          currency: item.price.currency.trim().toUpperCase(),
        },
        track: item.track,
        allergens,
        consumerAdvisory: item.consumerAdvisory,
        terms,
      };
    }),
  }));

  const seenQuestions = new Set<string>();
  let droppedQuestions = 0;
  const houseTermsToConfirm = answer.houseTermsToConfirm.filter((entry) => {
    const key = forMatching(entry.text);
    if (seenQuestions.has(key)) {
      return false;
    }
    seenQuestions.add(key);
    const printed = appearsIn(entry.text, everyItemsWords);
    if (!printed) {
      droppedQuestions += 1;
    }
    return printed;
  });

  const parsed = ReaderMenuSchema.safeParse({
    menuType,
    sections,
    houseTermsToConfirm,
    consumerAdvisoryText: answer.consumerAdvisoryText,
    readerNotes: answer.readerNotes,
  });
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => `${issue.path.map(String).join(".") || "answer"}: ${issue.message}`),
    };
  }

  const distinctTerms = new Set<string>();
  for (const section of parsed.data.sections) {
    for (const item of section.items) {
      for (const term of item.terms) {
        distinctTerms.add(forMatching(term.text));
      }
    }
  }
  for (const entry of parsed.data.houseTermsToConfirm) {
    distinctTerms.add(forMatching(entry.text));
  }
  if (distinctTerms.size > MAX_TERMS_PER_MENU) {
    return {
      ok: false,
      problems: [
        `The answer lists ${distinctTerms.size} distinct terms. Keep to the most important, at most ${MAX_TERMS_PER_MENU} across the menu.`,
      ],
    };
  }

  return { ok: true, value: { reading: parsed.data, droppedTerms, droppedQuestions } };
}

/* Building the stored record */

function idBase(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ID_BASE_LENGTH)
    .replace(/-+$/g, "");
}

/** Readable, unique identifiers: "steak-tartare", then "steak-tartare-2". */
function identifierMaker(): (text: string, fallback: string) => string {
  const used = new Set<string>();
  return (text, fallback) => {
    const base = idBase(text) || fallback;
    let id = base;
    for (let count = 2; used.has(id); count += 1) {
      id = `${base}-${count}`;
    }
    used.add(id);
    return id;
  };
}

type BuildContext = {
  readonly input: ReadMenuInput;
  readonly readAt: string;
  readonly model: ModelId;
  readonly usage: Menu["usage"];
};

export function buildMenuRecord(reading: ReaderMenu, context: BuildContext): Menu {
  const sectionId = identifierMaker();
  const itemId = identifierMaker();
  const termId = identifierMaker();

  const termsByKey = new Map<string, Term>();
  const itemWordsById = new Map<string, string[]>();
  const itemsInOrder: MenuItem[] = [];

  const sections: MenuSection[] = reading.sections.map((section) => ({
    sectionId: sectionId(section.name, "section"),
    name: section.name,
    items: section.items.map((item) => {
      const { terms, ...rest } = item;
      const id = itemId(item.name, "item");
      const termIds: string[] = [];
      for (const term of terms) {
        const key = forMatching(term.text);
        let stored = termsByKey.get(key);
        if (stored === undefined) {
          stored = { ...term, termId: termId(term.text, "term"), groupLevel: false };
          termsByKey.set(key, stored);
        } else {
          stored.confidence = Math.min(stored.confidence, term.confidence);
        }
        if (!termIds.includes(stored.termId)) {
          termIds.push(stored.termId);
        }
      }
      const built: MenuItem = { ...rest, itemId: id, termIds };
      itemWordsById.set(id, [section.name, item.name, item.description, item.price.printed].map(forMatching));
      itemsInOrder.push(built);
      return built;
    }),
  }));

  const houseTermsToConfirm: HouseTermConfirmation[] = [];
  for (const entry of reading.houseTermsToConfirm) {
    const key = forMatching(entry.text);
    let term = termsByKey.get(key);
    if (term === undefined) {
      // A house term the AI asked about without listing it, such as a mark
      // like "(V)". It becomes a term on every item that prints it.
      const mentioning = itemsInOrder.filter((item) => appearsIn(entry.text, itemWordsById.get(item.itemId) ?? []));
      const first = mentioning[0];
      if (first === undefined) {
        continue;
      }
      term = {
        text: entry.text,
        kind: "other",
        origin: "house",
        track: first.track,
        confidence: 1,
        termId: termId(entry.text, "term"),
        groupLevel: false,
      };
      termsByKey.set(key, term);
      for (const item of mentioning) {
        if (item.termIds.length < 40 && !item.termIds.includes(term.termId)) {
          item.termIds.push(term.termId);
        }
      }
    }
    houseTermsToConfirm.push({
      termId: term.termId,
      text: entry.text,
      question: entry.question,
      status: "pending",
      answer: "",
      answeredAt: null,
    });
  }

  const { input } = context;
  return MenuSchema.parse({
    menuId: input.menuId,
    groupSlug: input.groupSlug,
    outletSlug: input.outletSlug,
    menuType: input.menuType,
    sourceFile: {
      fileName: input.file.fileName,
      contentType: input.file.contentType,
      byteSize: input.file.bytes.byteLength,
      blobPath: input.file.blobPath,
      uploadedAt: input.file.uploadedAt,
    },
    sections,
    terms: [...termsByKey.values()],
    houseTermsToConfirm,
    consumerAdvisoryText: reading.consumerAdvisoryText,
    readerNotes: reading.readerNotes,
    readAt: context.readAt,
    readModel: context.model,
    usage: context.usage,
  });
}

/* Reading */

function checkInput(input: ReadMenuInput): void {
  if (!IdSchema.safeParse(input.menuId).success) {
    throw new ReadInputError("Not a valid menu identifier.");
  }
  if (!SlugSchema.safeParse(input.groupSlug).success || !SlugSchema.safeParse(input.outletSlug).success) {
    throw new ReadInputError("Not a valid group or outlet.");
  }
  const name = input.file.fileName.trim();
  if (name.length === 0 || name.length > 200) {
    throw new ReadInputError("The file name must be 1 to 200 characters.");
  }
  if (input.file.bytes.byteLength === 0) {
    throw new ReadInputError("The file is empty.");
  }
  if (!IsoDateTimeSchema.safeParse(input.file.uploadedAt).success) {
    throw new ReadInputError("The upload time is not a valid date.");
  }
}

function fileContent(file: MenuFile): AiContent {
  if (file.contentType === "application/pdf") {
    return { kind: "pdf", fileName: file.fileName, bytes: file.bytes };
  }
  return { kind: "image", contentType: file.contentType, bytes: file.bytes };
}

/**
 * Reads one menu file and returns its record, ready to save. Throws
 * ReadInputError before spending anything when the request is unusable, and
 * AiStepError (see client.ts) when the AI step fails; that error carries the
 * cost of every attempt.
 */
export async function readMenu(input: ReadMenuInput): Promise<ReadMenuResult> {
  checkInput(input);

  const instructions = await composePrompt(["read-base", PROMPT_FOR_TYPE[input.menuType]]);
  const content: AiContent[] = [
    fileContent(input.file),
    { kind: "text", text: `Menu type chosen by the manager: ${MENU_TYPE_LABELS[input.menuType]}.` },
  ];

  const result = await askForJson({
    step: "reader",
    instructions,
    content,
    answerShape: ReaderAnswerSchema,
    answerName: "menu_reading",
    check: (answer) => checkReaderAnswer(answer, input.menuType),
    model: input.model,
    effort: input.effort,
  });

  const menu = buildMenuRecord(result.value.reading, {
    input,
    readAt: new Date().toISOString(),
    model: result.model,
    usage: [...result.usage],
  });

  return {
    menu,
    attempts: result.attempts,
    droppedTerms: result.value.droppedTerms,
    droppedQuestions: result.value.droppedQuestions,
  };
}