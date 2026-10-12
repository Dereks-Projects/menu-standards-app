/*
 * Location: menu-standards-app/src/lib/tenants/create-group.ts
 *
 * Creating a group and its outlets: the rules a new group must follow and
 * the records it adds to the index. The save route
 * (src/app/api/groups/route.ts) calls this. The rules live here, not in
 * the route, so they stay the same when the index moves to a database in
 * Phase 10.
 *
 * Rules:
 * - Every address follows the naming rules and avoids reserved names
 *   (src/lib/slugs/reserved.ts). Addresses never change once saved.
 * - A single restaurant is a group of one. Its one outlet is created here,
 *   sharing the group's name and address (see src/lib/schemas/tenant.ts).
 * - A hotel or restaurant group lists 1 to 30 outlets. Each outlet's
 *   address differs from the group's and from every other outlet's.
 * - A group address already in the index is refused, even when that group
 *   is archived, so an address handed out once never points elsewhere.
 *
 * Server only.
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { type Group, GroupKindSchema, type Outlet } from "@/lib/schemas/tenant";
import { checkSlug } from "@/lib/slugs/reserved";
import type { StoreIndex } from "@/lib/storage/index-store";

/** The most outlets one new group can list. */
export const MAX_NEW_OUTLETS = 30;

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 200;

/* The request */

function nameField() {
  return z
    .string()
    .trim()
    .min(1, "This is required.")
    .max(MAX_NAME_LENGTH, `Use at most ${MAX_NAME_LENGTH} characters.`);
}

const NewOutletSchema = z.strictObject({
  name: nameField(),
  /** Checked in full below, so the reason given is the naming rule's own. */
  slug: z.string(),
  description: z
    .string()
    .trim()
    .max(MAX_DESCRIPTION_LENGTH, `Use at most ${MAX_DESCRIPTION_LENGTH} characters.`)
    .default(""),
});

/** What the new group form sends. Unknown fields are refused. */
export const NewGroupRequestSchema = z
  .strictObject({
    name: nameField(),
    slug: z.string(),
    kind: GroupKindSchema,
    outlets: z.array(NewOutletSchema).max(MAX_NEW_OUTLETS, `List at most ${MAX_NEW_OUTLETS} outlets.`),
  })
  .superRefine((request, context) => {
    const groupCheck = checkSlug(request.slug);
    if (!groupCheck.ok) {
      context.addIssue({ code: "custom", path: ["slug"], message: groupCheck.reason });
    }

    if (request.kind === "single") {
      if (request.outlets.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["outlets"],
          message: "A single restaurant lists no outlets. Its one outlet is created from the group.",
        });
      }
      return;
    }

    if (request.outlets.length === 0) {
      context.addIssue({ code: "custom", path: ["outlets"], message: "Add at least one outlet." });
    }

    const seen = new Set<string>();
    request.outlets.forEach((outlet, index) => {
      const path = ["outlets", index, "slug"];
      const outletCheck = checkSlug(outlet.slug);
      if (!outletCheck.ok) {
        context.addIssue({ code: "custom", path, message: outletCheck.reason });
      } else if (outlet.slug === request.slug) {
        context.addIssue({ code: "custom", path, message: "Use an address different from the group's." });
      } else if (seen.has(outlet.slug)) {
        context.addIssue({ code: "custom", path, message: "Another outlet in this group already uses it." });
      }
      seen.add(outlet.slug);
    });
  });

export type NewGroupRequest = z.infer<typeof NewGroupRequestSchema>;

/** "Group address", "Outlet 2 name", and so on, matching the form's labels. */
function fieldLabel(path: readonly PropertyKey[]): string {
  const [field, position, part] = path;
  if (field === "outlets" && typeof position === "number") {
    const partLabels: Readonly<Record<string, string>> = { name: " name", slug: " address", description: " description" };
    return `Outlet ${position + 1}${typeof part === "string" ? (partLabels[part] ?? "") : ""}`;
  }
  switch (field) {
    case "name":
      return "Group name";
    case "slug":
      return "Group address";
    case "kind":
      return "Type";
    case "outlets":
      return "Outlets";
    default:
      return "Request";
  }
}

export type RequestCheck =
  | { readonly ok: true; readonly request: NewGroupRequest }
  | { readonly ok: false; readonly problem: string };

/** Checks a request and returns it, or the first problem in plain words. */
export function checkNewGroupRequest(raw: unknown): RequestCheck {
  const parsed = NewGroupRequestSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, request: parsed.data };
  }
  const issue = parsed.error.issues[0];
  if (issue === undefined || issue.path.length === 0) {
    return { ok: false, problem: "The request is not in the expected shape." };
  }
  return { ok: false, problem: `${fieldLabel(issue.path)}: ${issue.message}` };
}

/* The records */

/** A group address that is already in the index. */
export class GroupAddressTakenError extends Error {
  readonly slug: string;

  constructor(slug: string) {
    super(`The address /${slug} is already in use.`);
    this.name = "GroupAddressTakenError";
    this.slug = slug;
  }
}

export type NewGroupRecords = {
  readonly group: Group;
  readonly outlets: readonly Outlet[];
};

/**
 * Builds the group and outlet records. Called once per save, before the
 * index update, so a save that has to retry keeps the same identifiers.
 */
export function newGroupRecords(request: NewGroupRequest, now: Date = new Date()): NewGroupRecords {
  const createdAt = now.toISOString();

  const group: Group = {
    groupId: `group-${randomUUID()}`,
    slug: request.slug,
    name: request.name,
    kind: request.kind,
    createdAt,
    archivedAt: null,
  };

  const outletInputs =
    request.kind === "single" ? [{ name: request.name, slug: request.slug, description: "" }] : request.outlets;

  const outlets: Outlet[] = outletInputs.map((input) => ({
    outletId: `outlet-${randomUUID()}`,
    groupSlug: request.slug,
    slug: input.slug,
    name: input.name,
    description: input.description,
    createdAt,
    archivedAt: null,
    currentProgramId: null,
  }));

  return { group, outlets };
}

/**
 * Adds the records to a copy of the index, for use inside updateIndex.
 * It may run more than once, so it only computes. The index's own rules
 * are checked again by updateIndex before anything is saved.
 */
export function addGroupToIndex(index: StoreIndex, records: NewGroupRecords): StoreIndex {
  if (index.groups.some((group) => group.slug === records.group.slug)) {
    throw new GroupAddressTakenError(records.group.slug);
  }
  return {
    ...index,
    groups: [...index.groups, records.group],
    outlets: [...index.outlets, ...records.outlets],
  };
}