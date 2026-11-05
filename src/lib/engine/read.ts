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
 * - Wine and cocktail slots (see menu.ts) are checked against the menu
 *   line. A slot that must be printed, such as the producer, the vintage,
 *   or a price, is dropped and counted when the line does not print it. A
 *   slot that may hold wine or spirits knowledge, such as a grape or a
 *   country, is marked printed or known by the code, never by the AI.
 * - Every wine on a by-the-glass list or wine list, and every drink on a
 *   cocktail menu, must fill its slots, with a wine's color, country, and
 *   price. On the first attempt a miss sends the answer back with the
 *   wines it missed. On the corrected attempt a miss is kept, named in a
 *   "Check:" reader note on the upload screen, so one stubborn line never
 *   loses a whole read.
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
  type CocktailDetails,
  type DetailSource,
  type HouseTermConfirmation,
  type Menu,
  type MenuItem,
  MenuSchema,
  type MenuSection,
  type MenuType,
  type ReaderMenu,
  ReaderMenuSchema,
  type ServeStyle,
  ServeStyleSchema,
  type Term,
  type WineColor,
  WineColorSchema,
  type WineDetails,
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

const AnswerWineSchema = z.object({
  color: WineColorSchema.nullable(),
  grapes: z.array(z.string()),
  producer: z.string().nullable(),
  wineName: z.string().nullable(),
  appellation: z.string().nullable(),
  region: z.string().nullable(),
  country: z.string().nullable(),
  vintage: z.string().nullable(),
  glassPrice: z.number().nullable(),
  bottlePrice: z.number().nullable(),
  knownConfidence: z.number(),
});

const AnswerCocktailSchema = z.object({
  spirits: z.array(z.object({ category: z.string(), brand: z.string().nullable() })),
  serve: ServeStyleSchema.nullable(),
  servePrinted: z.boolean(),
  glass: z.string().nullable(),
  garnish: z.string().nullable(),
  knownConfidence: z.number(),
});

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
          wine: AnswerWineSchema.nullable(),
          cocktail: AnswerCocktailSchema.nullable(),
        }),
      ),
    }),
  ),
  houseTermsToConfirm: z.array(z.object({ text: z.string(), question: z.string() })),
  consumerAdvisoryText: z.string(),
  readerNotes: z.array(z.string()),
});

type ReaderAnswer = z.infer<typeof ReaderAnswerSchema>;
type AnswerItem = ReaderAnswer["sections"][number]["items"][number];
type AnswerWine = z.infer<typeof AnswerWineSchema>;
type AnswerCocktail = z.infer<typeof AnswerCocktailSchema>;

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
  /** Wine and cocktail slots that had to be printed but were not. */
  readonly droppedDetails: number;
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
function itemWords(sectionName: string, item: AnswerItem): string[] {
  return [sectionName, item.name, item.description, item.price.printed].map(forMatching);
}

/* Wine and cocktail slots */

/** Menu types where every wine must fill its slots. */
const WINE_MENUS: ReadonlySet<MenuType> = new Set(["by_the_glass", "wine_list"]);

/** The most names listed in one problem or note. */
const MAX_NAMES_LISTED = 6;

/** Words that print a wine's color, in matching form. Plurals such as "reds" match too. */
const COLOR_WORDS: Readonly<Record<WineColor, readonly string[]>> = {
  sparkling: ["sparkling", "bubbles", "spumante", "espumoso", "mousseux", "sekt"],
  white: ["white", "blanc", "bianco", "blanco", "weiss"],
  rose: ["rose", "rosado", "rosato"],
  orange: ["orange", "skin contact"],
  red: ["red", "rouge", "rosso", "tinto"],
  dessert: ["dessert", "sweet", "late harvest"],
  fortified: ["fortified"],
};

/** Words that print how a drink is served, matched against the line in matching form. */
const SERVE_WORDS: Readonly<Record<ServeStyle, RegExp | null>> = {
  neat: /\bneat\b/,
  up: /\b(up|straight up)\b/,
  rocks: /\b(rocks|on ice|over ice)\b/,
  one_rock: /\b(large|big|single|one|king) (rock|cube|ice cube)\b/,
  collins: /\b(collins|highball|tall)\b/,
  frozen: /\b(frozen|blended)\b/,
  hot: /\b(hot|warm)\b/,
  other: null,
};

/** Spacing collapsed; an empty value becomes null. */
function tidyText(value: string | null): string | null {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  return text.length === 0 ? null : text;
}

/** Every number printed in the texts, as numbers: "15 | 60" gives 15 and 60, "$1,200" gives 1200. */
function printedNumbers(...texts: readonly string[]): Set<number> {
  const numbers = new Set<number>();
  for (const text of texts) {
    for (const match of text.replace(/(\d),(?=\d{3}\b)/g, "$1").matchAll(/\d+(?:\.\d+)?/g)) {
      numbers.add(Number(match[0]));
    }
  }
  return numbers;
}

/** Counts every slot value dropped because the line does not print it. */
type DropCounter = { dropped: number };

/** A value that must be printed: kept when the line prints it, otherwise dropped and counted. */
function printedOnly(value: string | null, words: readonly string[], counter: DropCounter): string | null {
  const text = tidyText(value);
  if (text === null) {
    return null;
  }
  if (appearsIn(text, words)) {
    return text;
  }
  counter.dropped += 1;
  return null;
}

/** A value that may be known: marked printed when the line prints it, known otherwise. */
function withSource(value: string | null, words: readonly string[]): { value: string; source: DetailSource } | null {
  const text = tidyText(value);
  return text === null ? null : { value: text, source: appearsIn(text, words) ? "printed" : "known" };
}

function clampConfidence(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** A price kept only when it is printed on the line or its section heading. */
function printedPrice(value: number | null, prices: ReadonlySet<number>, counter: DropCounter): number | null {
  if (value === null) {
    return null;
  }
  if (prices.has(value)) {
    return value;
  }
  counter.dropped += 1;
  return null;
}

function checkWine(answer: AnswerWine, words: readonly string[], prices: ReadonlySet<number>, counter: DropCounter): WineDetails {
  const vintageText = tidyText(answer.vintage)?.toUpperCase() ?? null;
  const vintage =
    vintageText !== null && /^(NV|(19|20)[0-9]{2})$/.test(vintageText) && appearsIn(vintageText, words)
      ? vintageText
      : null;
  if (vintageText !== null && vintage === null) {
    counter.dropped += 1;
  }

  const seenGrapes = new Set<string>();
  const grapes = answer.grapes.flatMap((grape) => {
    const sourced = withSource(grape, words);
    if (sourced === null || seenGrapes.has(forMatching(sourced.value))) {
      return [];
    }
    seenGrapes.add(forMatching(sourced.value));
    return [sourced];
  });

  return {
    color:
      answer.color === null
        ? null
        : {
            value: answer.color,
            source: COLOR_WORDS[answer.color].some((word) => appearsIn(word, words)) ? "printed" : "known",
          },
    grapes,
    producer: printedOnly(answer.producer, words, counter),
    wineName: printedOnly(answer.wineName, words, counter),
    appellation: printedOnly(answer.appellation, words, counter),
    region: withSource(answer.region, words),
    country: withSource(answer.country, words),
    vintage,
    glassPrice: printedPrice(answer.glassPrice, prices, counter),
    bottlePrice: printedPrice(answer.bottlePrice, prices, counter),
    knownConfidence: clampConfidence(answer.knownConfidence),
  };
}

function checkCocktail(answer: AnswerCocktail, words: readonly string[], counter: DropCounter): CocktailDetails {
  const line = ` ${words.join(" ")} `;
  const seen = new Set<string>();
  const spirits = answer.spirits.flatMap((spirit) => {
    const category = withSource(tidyText(spirit.category)?.toLowerCase() ?? null, words);
    if (category === null) {
      return [];
    }
    const brand = printedOnly(spirit.brand, words, counter);
    const key = `${forMatching(category.value)}|${brand === null ? "" : forMatching(brand)}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{ category, brand }];
  });

  let serve: CocktailDetails["serve"] = null;
  if (answer.serve !== null) {
    const pattern = SERVE_WORDS[answer.serve];
    const printed = answer.servePrinted && (pattern === null || pattern.test(line));
    serve = { value: answer.serve, source: printed ? "printed" : "known" };
  }

  return {
    spirits,
    serve,
    glass: printedOnly(answer.glass, words, counter),
    garnish: printedOnly(answer.garnish, words, counter),
    knownConfidence: clampConfidence(answer.knownConfidence),
  };
}

/** "Problem: A; B; C; and 4 more." */
function namedList(label: string, names: readonly string[]): string {
  const shown = names.slice(0, MAX_NAMES_LISTED).map((name) => (name.length > 40 ? `${name.slice(0, 37)}...` : name));
  const more = names.length > MAX_NAMES_LISTED ? `; and ${names.length - MAX_NAMES_LISTED} more` : "";
  return `${label}: ${shown.join("; ")}${more}.`;
}

/* Checking the answer */

type CheckedReading = {
  readonly reading: ReaderMenu;
  readonly droppedTerms: number;
  readonly droppedQuestions: number;
  readonly droppedDetails: number;
};

export type CheckOptions = {
  /**
   * True on the first attempt: a wine or drink that misses its slots sends
   * the answer back. False on the corrected attempt: misses are kept and
   * named in "Check:" reader notes.
   */
  readonly strict: boolean;
};

/**
 * Applies the rules the answer shape cannot carry, then checks every length
 * and count. Problems go back to the AI for one corrected attempt.
 */
export function checkReaderAnswer(
  answer: ReaderAnswer,
  menuType: MenuType,
  options: CheckOptions = { strict: true },
): { ok: true; value: CheckedReading } | { ok: false; problems: string[] } {
  let droppedTerms = 0;
  const details: DropCounter = { dropped: 0 };
  const everyItemsWords: string[] = [];
  const missingWine: string[] = [];
  const missingBasics: string[] = [];
  const missingPrice: string[] = [];
  const missingCocktail: string[] = [];
  const isWineMenu = WINE_MENUS.has(menuType);

  const sections = answer.sections.map((section) => ({
    name: section.name,
    items: section.items.map((item) => {
      const words = itemWords(section.name, item);
      everyItemsWords.push(...words);
      const prices = printedNumbers(item.price.printed, section.name);
      const isBeverage = item.track === "beverage";

      const wine = isBeverage && item.wine !== null ? checkWine(item.wine, words, prices, details) : null;
      const cocktail = isBeverage && item.cocktail !== null ? checkCocktail(item.cocktail, words, details) : null;

      if (isBeverage && isWineMenu) {
        if (wine === null) {
          missingWine.push(item.name);
        } else {
          if (wine.color === null || wine.country === null) {
            missingBasics.push(item.name);
          }
          const price = menuType === "wine_list" ? wine.bottlePrice : wine.glassPrice;
          if (price === null && prices.size > 0) {
            missingPrice.push(item.name);
          }
        }
      }
      if (isBeverage && menuType === "cocktail" && cocktail === null) {
        missingCocktail.push(item.name);
      }

      // The number used to compare prices: the glass price on a
      // by-the-glass list, the bottle price on a wine list, and otherwise
      // the one printed price. A number the line does not print is dropped,
      // and a line printing exactly one price always carries it, so "our
      // most expensive cocktail" never misses a drink.
      const listPrice =
        wine === null ? null : menuType === "wine_list" ? wine.bottlePrice : (wine.glassPrice ?? wine.bottlePrice);
      const ownPrices = printedNumbers(item.price.printed);
      const onlyPrice = ownPrices.size === 1 && !item.price.printed.trim().startsWith("+") ? [...ownPrices][0] : undefined;
      const amount = listPrice ?? printedPrice(item.price.amount, prices, details) ?? onlyPrice ?? null;

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
          amount,
          currency: item.price.currency.trim().toUpperCase(),
        },
        track: item.track,
        allergens,
        consumerAdvisory: item.consumerAdvisory,
        terms,
        wine,
        cocktail,
      };
    }),
  }));

  const misses = [
    { names: missingWine, problem: "Fill the wine slots for every wine", note: "Check: no wine details for" },
    {
      names: missingBasics,
      problem: "Give the color and country for every wine, known from the wine when the line does not print them",
      note: "Check: no color or country for",
    },
    {
      names: missingPrice,
      problem:
        menuType === "wine_list"
          ? "Record the bottle price as a number, exactly as printed, for every wine"
          : "Record the glass price as a number, exactly as printed, for every wine",
      note: "Check: no price number for",
    },
    { names: missingCocktail, problem: "Fill the cocktail slots for every drink", note: "Check: no drink details for" },
  ].filter((miss) => miss.names.length > 0);
  if (options.strict && misses.length > 0) {
    return { ok: false, problems: misses.map((miss) => namedList(miss.problem, miss.names)) };
  }
  const checkNotes = misses.map((miss) => namedList(miss.note, miss.names).slice(0, 200));

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
    readerNotes: [...checkNotes, ...answer.readerNotes].slice(0, 20),
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

  return { ok: true, value: { reading: parsed.data, droppedTerms, droppedQuestions, droppedDetails: details.dropped } };
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

  // Strict on the first attempt only (see checkReaderAnswer).
  let attempt = 0;
  const result = await askForJson({
    step: "reader",
    instructions,
    content,
    answerShape: ReaderAnswerSchema,
    answerName: "menu_reading",
    check: (answer) => {
      attempt += 1;
      return checkReaderAnswer(answer, input.menuType, { strict: attempt === 1 });
    },
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
    droppedDetails: result.value.droppedDetails,
  };
}