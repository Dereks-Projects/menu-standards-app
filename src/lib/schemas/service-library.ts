/*
 * Location: menu-standards-app/src/lib/schemas/service-library.ts
 *
 * The shape of the service library: the short, non-negotiable steps that
 * belong with particular dishes and drinks, such as the seafood fork
 * placed before a tower arrives, or the proper accompaniments with foie
 * gras.
 *
 * The library is written by Derek and lives as Markdown in the content
 * folder. The build only matches entries to menu items; no AI step ever
 * writes one. This is not service training, which is Restaurant Standards.
 *
 * Matching rules, which are part of the contract:
 * - A beverage entry attaches only to items tagged beverage, and a food
 *   entry only to items tagged food.
 * - Text triggers are matched whole word, ignoring case, against the
 *   item's name and description as printed.
 * - The words "bottle" and "magnum" never appear on a list of wines, so
 *   they are treated as menu triggers instead of text: an entry carrying
 *   either one attaches to every item on a wine list menu, and to no item
 *   on a by-the-glass menu.
 * - The entry btg-pour-tableside attaches to every item on a by-the-glass
 *   menu, whatever the text says, and to nothing on any other menu.
 */

import { z } from "zod";

import type { MenuType } from "./menu";
import { IdSchema, shortText, type Track, TrackSchema } from "./common";

/** Standard is non-negotiable. Best practice is shown where it applies. */
export const ServiceLevelSchema = z.enum(["standard", "best_practice"]);

export const ServiceEntrySchema = z.object({
  entryId: IdSchema,
  /** For example "Raw bar and shellfish". */
  category: shortText(80),
  title: shortText(120),
  track: TrackSchema,
  level: ServiceLevelSchema,
  /** The step itself, in one or two sentences. */
  note: shortText(300),
  /**
   * Words on a menu that bring this entry in, for example "oyster",
   * "seafood tower", "plateau". Matched in lowercase.
   */
  triggers: z.array(shortText(60)).min(1).max(30),
});

export const ServiceLibrarySchema = z.object({
  version: z.number().int().positive(),
  entries: z.array(ServiceEntrySchema).min(1).max(40),
});

export type ServiceLevel = z.infer<typeof ServiceLevelSchema>;
export type ServiceEntry = z.infer<typeof ServiceEntrySchema>;
export type ServiceLibrary = z.infer<typeof ServiceLibrarySchema>;

/** Triggers that mean "every item on a wine list menu". */
export const MENU_TRIGGERS: readonly string[] = ["bottle", "magnum"];

/** Attaches to every item on a by-the-glass menu, whatever the text says. */
export const BY_THE_GLASS_ENTRY_ID = "btg-pour-tableside";

/** What the matcher needs to know about one menu item. */
export type ServiceMatchTarget = {
  /** The item's name and description as printed, joined together. */
  readonly text: string;
  readonly track: Track;
  readonly menuType: MenuType;
};

/** Reduces text to single spaced words, so matching can be whole word. */
function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function containsWholeWord(haystack: string, trigger: string): boolean {
  const needle = normalize(trigger);
  return needle.trim().length > 0 && haystack.includes(needle);
}

/** Every entry that belongs with this item. */
export function matchServiceEntries(
  library: ServiceLibrary,
  target: ServiceMatchTarget,
): ServiceEntry[] {
  const haystack = normalize(target.text);
  const isWineList = target.menuType === "wine_list";
  const isByTheGlass = target.menuType === "by_the_glass";

  return library.entries.filter((entry) => {
    if (entry.track !== target.track) {
      return false;
    }

    if (entry.entryId === BY_THE_GLASS_ENTRY_ID) {
      return isByTheGlass;
    }

    return entry.triggers.some((trigger) => {
      if (MENU_TRIGGERS.includes(trigger.toLowerCase())) {
        return isWineList;
      }
      return containsWholeWord(haystack, trigger);
    });
  });
}