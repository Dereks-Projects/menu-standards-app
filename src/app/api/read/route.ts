/*
 * Location: menu-standards-app/src/app/api/read/route.ts
 *
 * Reads one uploaded menu. The browser sends the stored file's address and
 * the menu type the manager chose. This route fetches the file from private
 * storage, runs the reader (src/lib/engine/read.ts), and saves the result
 * beside the upload.
 *
 * Checks, in order, before anything is spent:
 * 1. This browser holds a valid pass (the second lock, decision 18a).
 * 2. The request has the expected shape.
 * 3. The address follows the storage layout in src/lib/storage/blob.ts.
 * 4. The outlet exists in the index and is not archived.
 * 5. The file exists, is not empty, and is the type its address promises.
 *
 * Reading a long menu can take a few minutes, so this route may run for up
 * to 800 seconds, the most Vercel's Pro plan allows.
 *
 * Every read is saved as a new record and never overwrites an earlier one.
 * The cost of a successful read is saved with it. A failed read has no
 * record, so its cost is written to the server log instead.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { AiStepError, type AiFailureKind } from "@/lib/ai/client";
import { isUnlocked, lockedResponse } from "@/lib/auth/guard";
import { newMenuId, ReadInputError, readMenu } from "@/lib/engine/read";
import { itemCount, itemsWithConsumerAdvisory, MenuTypeSchema, pendingHouseTerms } from "@/lib/schemas/menu";
import { menuRecordPathname, parseMenuUploadPathname, readFile, writeJson } from "@/lib/storage/blob";
import { findGroup, findOutlet, readIndex } from "@/lib/storage/index-store";

export const maxDuration = 800;

const NO_STORE = { "cache-control": "no-store" } as const;

const ReadRequestSchema = z.object({
  blobPath: z.string().max(400),
  menuType: MenuTypeSchema,
  /** The name the manager's file had, shown on screens. Optional. */
  fileName: z.string().trim().min(1).max(200).optional(),
});

/** What the person at the screen is told, without internal detail. */
const FAILURE_MESSAGES: Readonly<Record<AiFailureKind, { status: number; message: string }>> = {
  not_configured: { status: 500, message: "Reading is not set up on this site yet." },
  request_failed: { status: 502, message: "The reader could not be reached. Try again." },
  refused: { status: 422, message: "The reader declined this file. Check that it is a menu." },
  incomplete: { status: 422, message: "This menu is too long to read in one pass. Try splitting it." },
  invalid_answer: { status: 502, message: "The reader could not produce a clean result. Try again." },
};

function refuse(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isUnlocked())) {
    return lockedResponse();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, "The request could not be read.");
  }
  const parsed = ReadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return refuse(400, "The request is missing the file or the menu type.");
  }
  const { blobPath, menuType } = parsed.data;

  const location = parseMenuUploadPathname(blobPath);
  if (location === null) {
    return refuse(400, "That file address is not one this site created.");
  }

  const index = await readIndex();
  const group = findGroup(index, location.groupSlug);
  const outlet = findOutlet(index, location.groupSlug, location.outletSlug);
  if (group === null || outlet === null || group.archivedAt !== null || outlet.archivedAt !== null) {
    return refuse(400, "That outlet does not exist.");
  }

  const stored = await readFile(blobPath);
  if (stored === null) {
    return refuse(404, "That file was not found.");
  }
  if (stored.byteSize === 0) {
    return refuse(400, "That file is empty.");
  }
  if (stored.contentType !== location.contentType) {
    return refuse(400, "The stored file is not the type its name says.");
  }

  const menuId = newMenuId(menuType);
  let result;
  try {
    result = await readMenu({
      menuId,
      groupSlug: location.groupSlug,
      outletSlug: location.outletSlug,
      menuType,
      file: {
        fileName: parsed.data.fileName ?? `${location.fileStem}.${location.extension}`,
        contentType: location.contentType,
        bytes: stored.bytes,
        blobPath,
        uploadedAt: stored.uploadedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof ReadInputError) {
      return refuse(400, error.message);
    }
    if (error instanceof AiStepError) {
      const costUsd = error.usage.reduce((total, entry) => total + entry.costUsd, 0);
      console.error("Menu read failed.", { kind: error.kind, attempts: error.usage.length, costUsd });
      const failure = FAILURE_MESSAGES[error.kind];
      return refuse(failure.status, failure.message);
    }
    console.error("Menu read failed unexpectedly.", error);
    return refuse(500, "Reading failed. Try again.");
  }

  const { menu } = result;
  try {
    await writeJson(menuRecordPathname(menu.groupSlug, menu.outletSlug, menu.menuId), menu, { kind: "create" });
  } catch (error) {
    console.error("Saving a menu record failed.", error);
    return refuse(500, "The menu was read but could not be saved. Try again.");
  }

  return NextResponse.json(
    {
      menuId: menu.menuId,
      menuType: menu.menuType,
      items: itemCount(menu),
      sections: menu.sections.length,
      houseTermsToConfirm: pendingHouseTerms(menu).length,
      consumerAdvisoryItems: itemsWithConsumerAdvisory(menu).length,
      readerNotes: menu.readerNotes,
      model: menu.readModel,
      attempts: result.attempts,
      costUsd: menu.usage.reduce((total, entry) => total + entry.costUsd, 0),
      droppedTerms: result.droppedTerms,
      droppedQuestions: result.droppedQuestions,
    },
    { headers: NO_STORE },
  );
}