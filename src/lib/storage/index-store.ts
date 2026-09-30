/*
 * Location: menu-standards-app/src/lib/storage/index-store.ts
 *
 * The index: one small file in private storage listing every group,
 * outlet, program, and secret link. Pages read it to learn what exists.
 * It stands in for a database until Phase 10, when these records move to
 * Postgres and this file is retired. The records already use the schemas
 * the database will use, so that move is a copy, not a rewrite.
 *
 * Safe updates. Every change follows the same four steps:
 * 1. Read the latest copy straight from storage, skipping any cache.
 * 2. Apply the change to a copy.
 * 3. Check the whole index against its shape and its rules (below).
 * 4. Save it only if the stored copy is still the one read in step 1.
 *    Storage enforces this with the file's version tag.
 * If another change landed in between, the steps start over, up to three
 * times. Two saves racing each other can never lose either change.
 *
 * Rules, checked on every read and every save:
 * - Group slugs, outlet slugs within a group, and all identifiers are unique.
 * - No slug is a reserved name.
 * - Every outlet belongs to a group that exists.
 * - Every program and link points at a group, outlet, and program that exist.
 * - No two links share a code fingerprint.
 *
 * Server only.
 */

import { z } from "zod";

import { IdSchema, IsoDateTimeSchema, SCHEMA_VERSION, SlugSchema } from "@/lib/schemas/common";
import { LinkSchema } from "@/lib/schemas/links";
import { ProgramStatusSchema } from "@/lib/schemas/program";
import { type Group, GroupSchema, type Outlet, OutletSchema } from "@/lib/schemas/tenant";
import { isReservedSlug } from "@/lib/slugs/reserved";

import { INDEX_PATHNAME, isWriteConflict, readJson, writeJson } from "./blob";

const MAX_UPDATE_ATTEMPTS = 3;

/** How a program appears in the index. The program itself lives in its own file. */
export const ProgramEntrySchema = z.object({
  programId: IdSchema,
  groupSlug: SlugSchema,
  outletSlug: SlugSchema,
  status: ProgramStatusSchema,
  currentVersion: z.number().int().positive(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const IndexSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  updatedAt: IsoDateTimeSchema,
  groups: z.array(GroupSchema).max(500).default([]),
  outlets: z.array(OutletSchema).max(2000).default([]),
  programs: z.array(ProgramEntrySchema).max(5000).default([]),
  links: z.array(LinkSchema).max(10000).default([]),
});

export type ProgramEntry = z.infer<typeof ProgramEntrySchema>;
export type StoreIndex = z.infer<typeof IndexSchema>;

function outletKey(groupSlug: string, outletSlug: string): string {
  return `${groupSlug}/${outletSlug}`;
}

/** Records a value and reports whether it was already seen. */
function isRepeat(seen: Set<string>, value: string): boolean {
  if (seen.has(value)) {
    return true;
  }
  seen.add(value);
  return false;
}

/** Every rule the index breaks, in plain words. An empty list means sound. */
export function indexProblems(index: StoreIndex): string[] {
  const problems: string[] = [];

  const groupSlugs = new Set<string>();
  const groupIds = new Set<string>();
  for (const group of index.groups) {
    if (isRepeat(groupSlugs, group.slug)) {
      problems.push(`Group slug "${group.slug}" is used more than once.`);
    }
    if (isRepeat(groupIds, group.groupId)) {
      problems.push(`Group identifier "${group.groupId}" is used more than once.`);
    }
    if (isReservedSlug(group.slug)) {
      problems.push(`Group slug "${group.slug}" is a reserved name.`);
    }
  }

  const outletKeys = new Set<string>();
  const outletIds = new Set<string>();
  for (const outlet of index.outlets) {
    const key = outletKey(outlet.groupSlug, outlet.slug);
    if (!groupSlugs.has(outlet.groupSlug)) {
      problems.push(`Outlet "${key}" belongs to a group that does not exist.`);
    }
    if (isRepeat(outletKeys, key)) {
      problems.push(`Outlet "${key}" is listed more than once.`);
    }
    if (isRepeat(outletIds, outlet.outletId)) {
      problems.push(`Outlet identifier "${outlet.outletId}" is used more than once.`);
    }
    if (isReservedSlug(outlet.slug)) {
      problems.push(`Outlet slug "${outlet.slug}" is a reserved name.`);
    }
  }

  const programsById = new Map<string, ProgramEntry>();
  for (const program of index.programs) {
    if (programsById.has(program.programId)) {
      problems.push(`Program "${program.programId}" is listed more than once.`);
    }
    programsById.set(program.programId, program);
    if (!outletKeys.has(outletKey(program.groupSlug, program.outletSlug))) {
      problems.push(`Program "${program.programId}" belongs to an outlet that does not exist.`);
    }
  }

  for (const outlet of index.outlets) {
    if (outlet.currentProgramId === null) {
      continue;
    }
    const program = programsById.get(outlet.currentProgramId);
    if (program === undefined || program.groupSlug !== outlet.groupSlug || program.outletSlug !== outlet.slug) {
      problems.push(`Outlet "${outletKey(outlet.groupSlug, outlet.slug)}" points at a program it does not own.`);
    }
  }

  const linkIds = new Set<string>();
  const fingerprints = new Set<string>();
  for (const link of index.links) {
    if (isRepeat(linkIds, link.linkId)) {
      problems.push(`Link "${link.linkId}" is listed more than once.`);
    }
    if (isRepeat(fingerprints, link.codeFingerprint)) {
      problems.push(`Link "${link.linkId}" shares its code fingerprint with another link.`);
    }
    if (!groupSlugs.has(link.groupSlug)) {
      problems.push(`Link "${link.linkId}" belongs to a group that does not exist.`);
    }
    if (link.outletSlug !== null && !outletKeys.has(outletKey(link.groupSlug, link.outletSlug))) {
      problems.push(`Link "${link.linkId}" points at an outlet that does not exist.`);
    }
    if (link.programId !== null && !programsById.has(link.programId)) {
      problems.push(`Link "${link.linkId}" points at a program that does not exist.`);
    }
  }

  return problems;
}

function assertSound(index: StoreIndex): void {
  const problems = indexProblems(index);
  if (problems.length > 0) {
    throw new Error(`The index breaks its rules: ${problems.slice(0, 5).join(" ")}`);
  }
}

function emptyIndex(): StoreIndex {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    groups: [],
    outlets: [],
    programs: [],
    links: [],
  };
}

type LoadedIndex = {
  readonly index: StoreIndex;
  /** Null when no index has been saved yet. */
  readonly etag: string | null;
};

async function loadIndex(): Promise<LoadedIndex> {
  const stored = await readJson(INDEX_PATHNAME, IndexSchema);
  if (stored === null) {
    return { index: emptyIndex(), etag: null };
  }
  assertSound(stored.data);
  return { index: stored.data, etag: stored.etag };
}

/** The latest index. Empty until the first group is saved. */
export async function readIndex(): Promise<StoreIndex> {
  const { index } = await loadIndex();
  return index;
}

/**
 * True when a failed save lost a race rather than failed outright: either
 * the stored copy changed since it was read, or, on the very first save,
 * another first save got there first.
 */
async function lostRace(error: unknown, etag: string | null): Promise<boolean> {
  if (isWriteConflict(error)) {
    return true;
  }
  if (etag !== null) {
    return false;
  }
  try {
    return (await readJson(INDEX_PATHNAME, IndexSchema)) !== null;
  } catch {
    return false;
  }
}

/**
 * Applies a change to the index and saves it safely (see the steps at the
 * top of this file). The change receives a copy it may modify and must
 * return the new index. It may run more than once, so it must not do
 * anything besides compute the new index. Returns the index as saved.
 */
export async function updateIndex(change: (current: StoreIndex) => StoreIndex): Promise<StoreIndex> {
  for (let attempt = 1; attempt <= MAX_UPDATE_ATTEMPTS; attempt += 1) {
    const { index, etag } = await loadIndex();
    const changed = change(structuredClone(index));
    const next = IndexSchema.parse({ ...changed, updatedAt: new Date().toISOString() });
    assertSound(next);

    try {
      await writeJson(INDEX_PATHNAME, next, etag === null ? { kind: "create" } : { kind: "replace", etag });
      return next;
    } catch (error) {
      if (await lostRace(error, etag)) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("The index kept changing during this update. Try again.");
}

/* Lookups */

export function findGroup(index: StoreIndex, groupSlug: string): Group | null {
  return index.groups.find((group) => group.slug === groupSlug) ?? null;
}

export function findOutlet(index: StoreIndex, groupSlug: string, outletSlug: string): Outlet | null {
  return index.outlets.find((outlet) => outlet.groupSlug === groupSlug && outlet.slug === outletSlug) ?? null;
}