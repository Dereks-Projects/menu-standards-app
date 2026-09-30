/*
 * Location: menu-standards-app/src/app/api/upload/route.ts
 *
 * Upload permission. Before sending a menu file, the browser asks here and
 * receives a short-lived address that accepts exactly one file, straight
 * into private storage. The file never passes through this server, which
 * is how uploads get past Vercel's 4.5 MB request limit (decision 16).
 *
 * Checks, in order, before any permission is given:
 * 1. This browser holds a valid pass. The password gate already checked;
 *    this is the second lock (decision 18a).
 * 2. The requested address follows the storage layout in
 *    src/lib/storage/blob.ts: groups/{group}/outlets/{outlet}/uploads/{name}.{ext}
 * 3. The group and outlet exist in the index and are not archived.
 * 4. The permission covers only that address and that file type, up to
 *    20 MB, for 10 minutes. Storage adds a random ending to the name and
 *    refuses to overwrite anything.
 *
 * No "upload finished" message is requested from Vercel. That message would
 * arrive without a pass and be stopped by the password gate, and opening a
 * door for it is not worth the risk. Instead, the reader records each file
 * when it reads it, taking the size and type from storage itself rather
 * than from the browser.
 *
 * Uses presigned uploads, which work with Vercel's self-renewing
 * credentials, so no permanent storage key is needed (decision 44).
 */

import { issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { isUnlocked, lockedResponse } from "@/lib/auth/guard";
import {
  MAX_REQUESTED_STEM_LENGTH,
  MAX_UPLOAD_BYTES,
  parseMenuUploadPathname,
  UPLOAD_URL_LIFETIME_MS,
  type UploadLocation,
} from "@/lib/storage/blob";
import { findGroup, findOutlet, readIndex } from "@/lib/storage/index-store";

const NO_STORE = { "cache-control": "no-store" } as const;

type Authorization =
  | { readonly ok: true; readonly location: UploadLocation }
  | { readonly ok: false; readonly reason: string };

/** Decides whether this address may receive an upload, and says why not. */
async function authorizeUpload(pathname: string): Promise<Authorization> {
  const location = parseMenuUploadPathname(pathname);
  if (location === null) {
    return { ok: false, reason: "That file type is not accepted. Use a PDF, JPEG, PNG, or WebP file." };
  }
  if (location.fileStem.length > MAX_REQUESTED_STEM_LENGTH) {
    return { ok: false, reason: "That file name is too long. Rename the file and try again." };
  }

  const index = await readIndex();
  const group = findGroup(index, location.groupSlug);
  const outlet = findOutlet(index, location.groupSlug, location.outletSlug);
  if (group === null || outlet === null || group.archivedAt !== null || outlet.archivedAt !== null) {
    return { ok: false, reason: "That outlet does not exist." };
  }

  return { ok: true, location };
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isUnlocked())) {
    return lockedResponse();
  }

  let body: HandleUploadPresignedBody;
  try {
    body = (await request.json()) as HandleUploadPresignedBody;
  } catch {
    return NextResponse.json({ error: "The request could not be read." }, { status: 400, headers: NO_STORE });
  }

  // The storage library may rewrap errors thrown inside getSignedToken, so a
  // refusal is recorded here rather than recognized by its error type.
  const outcome: { refusal: string | null } = { refusal: null };

  try {
    const response = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname) => {
        const authorization = await authorizeUpload(pathname);
        if (!authorization.ok) {
          outcome.refusal = authorization.reason;
          throw new Error(authorization.reason);
        }

        const allowedContentTypes = [authorization.location.contentType];
        const validUntil = Date.now() + UPLOAD_URL_LIFETIME_MS;

        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          allowedContentTypes,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          validUntil,
        });

        return {
          token,
          urlOptions: {
            allowedContentTypes,
            maximumSizeInBytes: MAX_UPLOAD_BYTES,
            validUntil,
            addRandomSuffix: true,
            allowOverwrite: false,
          },
        };
      },
    });

    return NextResponse.json(response, { headers: NO_STORE });
  } catch (error) {
    if (outcome.refusal !== null) {
      return NextResponse.json({ error: outcome.refusal }, { status: 400, headers: NO_STORE });
    }
    console.error("Upload permission failed.", error);
    return NextResponse.json(
      { error: "Upload permission failed. Try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}