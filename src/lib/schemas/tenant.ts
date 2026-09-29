/*
 * Location: menu-standards-app/src/lib/schemas/tenant.ts
 *
 * Groups and outlets: the restaurants themselves.
 *
 * A group is the top level and an outlet sits beneath it, so every address
 * is /{groupSlug}/{outletSlug}. A single restaurant is a group of one,
 * where both slugs match and the group page is the outlet page. These are
 * records, not accounts. No people are stored here.
 */

import { z } from "zod";

import { IdSchema, IsoDateTimeSchema, optionalText, shortText, SlugSchema } from "./common";

/** Used only for wording on the group page. */
export const GroupKindSchema = z.enum(["single", "hotel", "restaurant_group"]);

export const GroupSchema = z.object({
  groupId: IdSchema,
  slug: SlugSchema,
  /** The property name as it appears in program content. */
  name: shortText(120),
  kind: GroupKindSchema,
  createdAt: IsoDateTimeSchema,
  archivedAt: IsoDateTimeSchema.nullable().default(null),
});

export const OutletSchema = z.object({
  outletId: IdSchema,
  groupSlug: SlugSchema,
  slug: SlugSchema,
  name: shortText(120),
  /** For example "Rooftop bar" or "Main dining room". */
  description: optionalText(200).default(""),
  createdAt: IsoDateTimeSchema,
  archivedAt: IsoDateTimeSchema.nullable().default(null),
  /** The program in use here, once one is built. */
  currentProgramId: IdSchema.nullable().default(null),
});

export type GroupKind = z.infer<typeof GroupKindSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type Outlet = z.infer<typeof OutletSchema>;

/** The address of a group, for example /surfclub. */
export function groupPath(groupSlug: string): string {
  return `/${groupSlug}`;
}

/** The address of an outlet, for example /surfclub/lido. */
export function outletPath(groupSlug: string, outletSlug: string): string {
  return `/${groupSlug}/${outletSlug}`;
}

/** True when the group holds a single outlet sharing its name. */
export function isSingleOutletGroup(group: Group, outlet: Outlet): boolean {
  return group.slug === outlet.slug;
}