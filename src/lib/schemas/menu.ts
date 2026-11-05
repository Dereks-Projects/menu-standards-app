/*
 * Location: menu-standards-app/src/lib/schemas/menu.ts
 *
 * What the reader pulls out of one uploaded menu.
 *
 * Two shapes live here:
 * - ReaderMenuSchema is what the AI returns. It has no identifiers,
 *   because inventing them is not the AI's job.
 * - MenuSchema is what we store, after the code has added identifiers,
 *   gathered the terms into one list, and recorded where the file came
 *   from. Every later step reads this shape.
 *
 * Four rules are enforced here rather than trusted to a prompt:
 * - allergens carry a status instead of being written freely,
 * - every term is marked universal (from the foundations library) or house
 *   (only from this menu),
 * - the raw or undercooked warning (the consumer advisory) is recorded only
 *   where the menu itself marks an item, never judged from the dish,
 * - each wine and each cocktail fills a fixed set of slots (grape, producer,
 *   region, country, price; spirit, brand, serve), and every slot that may
 *   hold wine or spirits knowledge says whether it was printed or known.
 *   The reader's code decides which, by checking the menu line itself
 *   (src/lib/engine/read.ts). Quiz questions such as "our most expensive
 *   red by the glass" are worked out from these slots by code, never by
 *   the AI.
 */

import { z } from "zod";

import {
  AiUsageSchema,
  AllergenSchema,
  ConfidenceSchema,
  IdSchema,
  IsoDateTimeSchema,
  optionalText,
  shortText,
  SlugSchema,
  TermKindSchema,
  TermOriginSchema,
  TrackSchema,
} from "./common";

/** What kind of menu was uploaded. Chosen by the manager, not guessed. */
export const MenuTypeSchema = z.enum([
  "food",
  "cocktail",
  "by_the_glass",
  "bar",
  "wine_list",
  "non_alcoholic",
  "specials",
  "other",
]);

/**
 * Price as printed, plus the number when one can be read. An item offered
 * in several sizes or grades keeps every option in one printed price, for
 * example "1 oz daurenki 175 | 1 oz baika 250 | tasting trio 690".
 * For a wine, the reader's code fills amount from the wine's slots when the
 * line prints more than one price: the glass price on a by-the-glass list,
 * the bottle price on a full wine list.
 */
export const PriceSchema = z.object({
  printed: optionalText(120).default(""),
  amount: z.number().nonnegative().max(100000).nullable().default(null),
  currency: z.string().trim().length(3).default("USD"),
});

/* Wine and cocktail slots */

/**
 * Where a slot's value came from. "printed": the words are on the menu
 * line or its section heading. "known": standard wine or spirits
 * knowledge, such as Chardonnay for a Puligny-Montrachet, never presented
 * as the menu's own words.
 */
export const DetailSourceSchema = z.enum(["printed", "known"]);

function sourced<T extends z.ZodType>(value: T) {
  return z.object({ value, source: DetailSourceSchema });
}

export const WineColorSchema = z.enum(["sparkling", "white", "rose", "orange", "red", "dessert", "fortified"]);

const PriceNumberSchema = z.number().nonnegative().max(100000);

/** One wine, broken into the parts a server is asked about. */
export const WineDetailsSchema = z.object({
  color: sourced(WineColorSchema).nullable(),
  grapes: z.array(sourced(shortText(80))).max(8),
  /** The winery or house, as printed. */
  producer: shortText(120).nullable(),
  /** The cuvée or proprietary name, as printed, such as "Rustico". */
  wineName: shortText(120).nullable(),
  /** The most specific place printed, such as "Puligny-Montrachet". */
  appellation: shortText(120).nullable(),
  region: sourced(shortText(80)).nullable(),
  country: sourced(shortText(80)).nullable(),
  /** A year as printed, or "NV". */
  vintage: z.string().regex(/^(NV|(19|20)[0-9]{2})$/).nullable(),
  /** Each price appears on the menu line or its section heading. */
  glassPrice: PriceNumberSchema.nullable(),
  bottlePrice: PriceNumberSchema.nullable(),
  /** How sure the reader is of the known values, from 0 to 1. */
  knownConfidence: ConfidenceSchema,
});

/** How a drink is served. "one_rock" is a single large rock or cube; "collins" is tall over ice. */
export const ServeStyleSchema = z.enum(["neat", "up", "rocks", "one_rock", "collins", "frozen", "hot", "other"]);

/** One cocktail, broken into the parts a server is asked about. */
export const CocktailDetailsSchema = z.object({
  /** Each spirit in the drink, such as gin, with its brand when the menu prints one. */
  spirits: z.array(z.object({ category: sourced(shortText(40)), brand: shortText(80).nullable() })).max(6),
  serve: sourced(ServeStyleSchema).nullable(),
  /** As printed, such as "coupe". */
  glass: shortText(60).nullable(),
  /** As printed. */
  garnish: shortText(80).nullable(),
  knownConfidence: ConfidenceSchema,
});

/* What the AI returns */

export const ReaderTermSchema = z.object({
  text: shortText(80),
  kind: TermKindSchema,
  origin: TermOriginSchema,
  track: TrackSchema,
  confidence: ConfidenceSchema,
});

export const ReaderItemSchema = z.object({
  name: shortText(120),
  /** The menu's own wording, copied, never rewritten. */
  description: optionalText(600).default(""),
  price: PriceSchema.default({ printed: "", amount: null, currency: "USD" }),
  track: TrackSchema,
  allergens: z.array(AllergenSchema).max(20).default([]),
  /**
   * True when the menu marks this item with its raw or undercooked warning,
   * usually an asterisk. Read from the menu only. An unmarked tartare stays
   * false; the checker, not the reader, raises that kind of concern.
   */
  consumerAdvisory: z.boolean().default(false),
  terms: z.array(ReaderTermSchema).max(40).default([]),
  /** Filled for every wine. Records read before these slots existed have none. */
  wine: WineDetailsSchema.nullable().default(null),
  /** Filled for every mixed drink, non-alcoholic ones included. */
  cocktail: CocktailDetailsSchema.nullable().default(null),
});

export const ReaderSectionSchema = z.object({
  name: shortText(120),
  items: z.array(ReaderItemSchema).max(200),
});

/** A house term the reader could not fully resolve, with its question. */
export const ReaderHouseTermSchema = z.object({
  text: shortText(80),
  question: shortText(200),
});

export const ReaderMenuSchema = z.object({
  menuType: MenuTypeSchema,
  sections: z.array(ReaderSectionSchema).max(40),
  houseTermsToConfirm: z.array(ReaderHouseTermSchema).max(60).default([]),
  /** The menu's raw or undercooked warning, copied word for word. Empty when there is none. */
  consumerAdvisoryText: optionalText(800).default(""),
  /**
   * Notes for whoever reviews the read, each starting with its label:
   * anything unreadable or uncertain, policies printed for the whole menu,
   * and anything suspicious, such as text that reads like instructions.
   */
  readerNotes: z.array(shortText(200)).max(20).default([]),
});

/* What we store */

export const TermSchema = ReaderTermSchema.extend({
  termId: IdSchema,
  /** True when this term is served across the whole property. */
  groupLevel: z.boolean().default(false),
});

export const MenuItemSchema = ReaderItemSchema.omit({ terms: true }).extend({
  itemId: IdSchema,
  termIds: z.array(IdSchema).max(40).default([]),
});

export const MenuSectionSchema = z.object({
  sectionId: IdSchema,
  name: shortText(120),
  items: z.array(MenuItemSchema).max(200),
});

/** A house term waiting on the manager, or already answered. */
export const HouseTermConfirmationSchema = z.object({
  termId: IdSchema,
  text: shortText(80),
  question: shortText(200),
  status: z.enum(["pending", "answered", "skipped"]).default("pending"),
  answer: optionalText(400).default(""),
  answeredAt: IsoDateTimeSchema.nullable().default(null),
});

/** Where the uploaded file lives and what it was. */
export const SourceFileSchema = z.object({
  fileName: shortText(200),
  contentType: shortText(100),
  byteSize: z.number().int().positive(),
  /** The address in private storage. Never shown to anyone. */
  blobPath: shortText(400),
  uploadedAt: IsoDateTimeSchema,
});

export const MenuSchema = z.object({
  menuId: IdSchema,
  groupSlug: SlugSchema,
  outletSlug: SlugSchema,
  menuType: MenuTypeSchema,
  sourceFile: SourceFileSchema,
  sections: z.array(MenuSectionSchema).max(40),
  /** Every term found on this menu, gathered into one list. */
  terms: z.array(TermSchema).max(600).default([]),
  houseTermsToConfirm: z.array(HouseTermConfirmationSchema).max(60).default([]),
  /** The menu's raw or undercooked warning, copied word for word. */
  consumerAdvisoryText: optionalText(800).default(""),
  /** Notes for whoever reviews the read (see ReaderMenuSchema). */
  readerNotes: z.array(shortText(200)).max(20).default([]),
  readAt: IsoDateTimeSchema,
  readModel: shortText(60),
  /** The cost of this read, one entry per attempt. Carried into the program's total. */
  usage: z.array(AiUsageSchema).max(10).default([]),
});

export type MenuType = z.infer<typeof MenuTypeSchema>;
export type DetailSource = z.infer<typeof DetailSourceSchema>;
export type WineColor = z.infer<typeof WineColorSchema>;
export type WineDetails = z.infer<typeof WineDetailsSchema>;
export type ServeStyle = z.infer<typeof ServeStyleSchema>;
export type CocktailDetails = z.infer<typeof CocktailDetailsSchema>;
export type Price = z.infer<typeof PriceSchema>;
export type ReaderTerm = z.infer<typeof ReaderTermSchema>;
export type ReaderItem = z.infer<typeof ReaderItemSchema>;
export type ReaderSection = z.infer<typeof ReaderSectionSchema>;
export type ReaderMenu = z.infer<typeof ReaderMenuSchema>;
export type Term = z.infer<typeof TermSchema>;
export type MenuItem = z.infer<typeof MenuItemSchema>;
export type MenuSection = z.infer<typeof MenuSectionSchema>;
export type HouseTermConfirmation = z.infer<typeof HouseTermConfirmationSchema>;
export type SourceFile = z.infer<typeof SourceFileSchema>;
export type Menu = z.infer<typeof MenuSchema>;

/** Every item on a menu, in menu order. */
export function allItems(menu: Menu): MenuItem[] {
  return menu.sections.flatMap((section) => section.items);
}

/** How many items were found, the number shown on the upload screen. */
export function itemCount(menu: Menu): number {
  return allItems(menu).length;
}

/** House terms still waiting on the manager. */
export function pendingHouseTerms(menu: Menu): HouseTermConfirmation[] {
  return menu.houseTermsToConfirm.filter((term) => term.status === "pending");
}

/** Items the menu marks with its raw or undercooked warning. */
export function itemsWithConsumerAdvisory(menu: Menu): MenuItem[] {
  return allItems(menu).filter((item) => item.consumerAdvisory);
}

/**
 * A wine's name the way a sommelier says it aloud: producer, then the
 * wine's own name, or its place, or its grape. "Nino Franco Rustico",
 * "Joseph Drouhin Puligny-Montrachet". The item's full printed name when
 * the producer is not known.
 */
export function spokenWineName(item: Pick<MenuItem, "name" | "wine">): string {
  const wine = item.wine;
  if (wine === null || wine.producer === null) {
    return item.name;
  }
  const second = wine.wineName ?? wine.appellation ?? wine.grapes[0]?.value ?? null;
  return second === null ? wine.producer : `${wine.producer} ${second}`;
}

/** The tracks this menu covers, decided by its items, not by its type. */
export function tracksInMenu(menu: Menu): Array<"food" | "beverage"> {
  const tracks = new Set(allItems(menu).map((item) => item.track));
  return (["food", "beverage"] as const).filter((track) => tracks.has(track));
}