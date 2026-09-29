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
 */

import { z } from "zod";

import { IdSchema, shortText, TrackSchema } from "./common";

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
  entries: z.array(ServiceEntrySchema).min(1).max(200),
});

export type ServiceLevel = z.infer<typeof ServiceLevelSchema>;
export type ServiceEntry = z.infer<typeof ServiceEntrySchema>;
export type ServiceLibrary = z.infer<typeof ServiceLibrarySchema>;

/**
 * Entries whose trigger words appear in an item's name or description.
 * Whole words only, so "crab" never matches "crabapple".
 */
export function matchServiceEntries(
  library: ServiceLibrary,
  text: string,
  track: "food" | "beverage",
): ServiceEntry[] {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return library.entries.filter((entry) => {
    if (entry.track !== track) {
      return false;
    }
    return entry.triggers.some((trigger) => {
      const needle = ` ${trigger.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
      return haystack.includes(needle);
    });
  });
}