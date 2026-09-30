/*
 * Location: menu-standards-app/src/lib/storage/blob.ts
 *
 * Private file storage for Menu Standards, on Vercel Blob.
 *
 * Everything a client hands us lives here: uploaded menus, what the reader
 * pulled out of them, built programs, and the index file. The store is
 * private, so no file opens by address alone. Every read goes through
 * server code holding the store's credentials.
 *
 * Credentials: on Vercel, the storage library signs in with short-lived
 * credentials that Vercel issues and renews by itself (decision 44). No
 * permanent storage key is kept on the live site. This file never reads or
 * passes credentials; the library finds them.
 *
 * Layout, organized by group and outlet:
 *
 *   index/index.json                                          the index
 *   groups/{group}/outlets/{outlet}/uploads/{name}-{random}.{ext}
 *                                                             uploaded menus
 *   groups/{group}/outlets/{outlet}/menus/{menuId}.json       reader results
 *   groups/{group}/outlets/{outlet}/programs/{programId}/v{n}.json
 *                                                             program versions
 *
 * Storage adds a random ending to every uploaded file name, so names cannot
 * be guessed and two uploads never collide. Slugs never change once issued
 * (decision 19), so these paths stay valid for the life of a program.
 *
 * Server only. Browser code never imports this file.
 */

import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import type { z } from "zod";

import { IdSchema, SlugSchema } from "@/lib/schemas/common";

/* Limits */

/** The largest menu file accepted: room for phone photos and long PDFs. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** How long a browser has to start an upload after receiving permission. */
export const UPLOAD_URL_LIFETIME_MS = 10 * 60 * 1000;

/**
 * The longest file name the browser may request, before storage adds its
 * random ending. Stored names are longer, so the reader accepts up to
 * MAX_STORED_STEM_LENGTH when it reads a file back.
 */
export const MAX_REQUESTED_STEM_LENGTH = 80;
const MAX_STORED_STEM_LENGTH = 160;

/** The largest stored record read or written. The index is far smaller. */
const MAX_JSON_BYTES = 16 * 1024 * 1024;

/** Stored records are always read fresh, so a short cache time is enough. */
const JSON_CACHE_SECONDS = 60;

/**
 * File types a menu may arrive as, by extension. These are the formats the
 * reader's models accept: PDF for documents, and JPEG, PNG, or WebP for
 * photos and screenshots. iPhone HEIC photos are refused.
 */
const UPLOAD_TYPES = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export type UploadExtension = keyof typeof UPLOAD_TYPES;
export type UploadContentType = (typeof UPLOAD_TYPES)[UploadExtension];

function isUploadExtension(value: string): value is UploadExtension {
  return Object.hasOwn(UPLOAD_TYPES, value);
}

/* Paths */

export const INDEX_PATHNAME = "index/index.json";

/** A file name without its extension: letters, numbers, single hyphens. */
const FILE_STEM_PATTERN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

const UPLOAD_PATHNAME_PATTERN = /^groups\/([^/]+)\/outlets\/([^/]+)\/uploads\/([^/]+)\.([a-z]+)$/;

/** Longer than any valid path, checked before any pattern runs. */
const MAX_PATHNAME_LENGTH = 400;

function isSlug(value: string): boolean {
  return SlugSchema.safeParse(value).success;
}

function requireSlug(value: string, label: string): string {
  if (!isSlug(value)) {
    throw new Error(`Not a valid ${label} slug.`);
  }
  return value;
}

function requireId(value: string, label: string): string {
  if (!IdSchema.safeParse(value).success) {
    throw new Error(`Not a valid ${label} identifier.`);
  }
  return value;
}

/** The folder holding everything for one outlet. */
export function outletFolder(groupSlug: string, outletSlug: string): string {
  return `groups/${requireSlug(groupSlug, "group")}/outlets/${requireSlug(outletSlug, "outlet")}`;
}

/** Where an uploaded menu goes, before storage adds its random ending. */
export function menuUploadPathname(
  groupSlug: string,
  outletSlug: string,
  fileStem: string,
  extension: UploadExtension,
): string {
  if (fileStem.length > MAX_REQUESTED_STEM_LENGTH || !FILE_STEM_PATTERN.test(fileStem)) {
    throw new Error("Not a valid file name.");
  }
  return `${outletFolder(groupSlug, outletSlug)}/uploads/${fileStem}.${extension}`;
}

/** Where the reader's result for one menu is saved. */
export function menuRecordPathname(groupSlug: string, outletSlug: string, menuId: string): string {
  return `${outletFolder(groupSlug, outletSlug)}/menus/${requireId(menuId, "menu")}.json`;
}

/** Where one version of a program is saved. Versions are never overwritten. */
export function programVersionPathname(
  groupSlug: string,
  outletSlug: string,
  programId: string,
  version: number,
): string {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("A program version is a whole number from 1 up.");
  }
  return `${outletFolder(groupSlug, outletSlug)}/programs/${requireId(programId, "program")}/v${version}.json`;
}

/** An upload address broken into its parts, after every part was checked. */
export type UploadLocation = {
  readonly groupSlug: string;
  readonly outletSlug: string;
  readonly fileStem: string;
  readonly extension: UploadExtension;
  readonly contentType: UploadContentType;
};

/**
 * Reads an upload address, whether requested by the browser or already
 * stored with its random ending. Returns null for anything outside the
 * layout: another folder, a bad slug, a dot or slash in the name, or a file
 * type the reader does not accept.
 */
export function parseMenuUploadPathname(pathname: string): UploadLocation | null {
  if (pathname.length > MAX_PATHNAME_LENGTH) {
    return null;
  }
  const match = UPLOAD_PATHNAME_PATTERN.exec(pathname);
  if (match === null) {
    return null;
  }
  const [, groupSlug, outletSlug, fileStem, extension] = match;
  if (groupSlug === undefined || outletSlug === undefined || fileStem === undefined || extension === undefined) {
    return null;
  }
  if (!isSlug(groupSlug) || !isSlug(outletSlug)) {
    return null;
  }
  if (fileStem.length > MAX_STORED_STEM_LENGTH || !FILE_STEM_PATTERN.test(fileStem)) {
    return null;
  }
  if (!isUploadExtension(extension)) {
    return null;
  }
  return {
    groupSlug,
    outletSlug,
    fileStem,
    extension,
    contentType: UPLOAD_TYPES[extension],
  };
}

/* Stored records (JSON) */

export type StoredJson<T> = {
  readonly data: T;
  /** The file's version tag. Pass it back to replace the file safely. */
  readonly etag: string;
};

/**
 * Reads a stored record and checks it against its schema. Always reads the
 * latest copy, skipping the cache. Returns null when the file does not
 * exist, and throws when it exists but does not match the schema, so bad
 * data stops here instead of reaching a screen.
 */
export async function readJson<S extends z.ZodType>(
  pathname: string,
  schema: S,
): Promise<StoredJson<z.output<S>> | null> {
  const result = await get(pathname, { access: "private", useCache: false });
  if (result === null) {
    return null;
  }
  if (result.statusCode !== 200 || result.stream === null) {
    throw new Error(`Storage returned no content for ${pathname}.`);
  }
  if (result.blob.size !== null && result.blob.size > MAX_JSON_BYTES) {
    await result.stream.cancel();
    throw new Error(`Stored record is too large: ${pathname}.`);
  }

  const text = await new Response(result.stream).text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`Stored record is not valid JSON: ${pathname}.`, { cause: error });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Stored record does not match its schema: ${pathname}.`, { cause: parsed.error });
  }
  return { data: parsed.data, etag: result.blob.etag };
}

/**
 * How a record is written:
 * - create: only if nothing exists at that address yet.
 * - replace: only if the stored copy still carries this version tag, so a
 *   change made in between is never overwritten.
 */
export type WriteMode = { readonly kind: "create" } | { readonly kind: "replace"; readonly etag: string };

/** Writes a record. Returns the new version tag. */
export async function writeJson(pathname: string, data: unknown, mode: WriteMode): Promise<{ etag: string }> {
  const body = JSON.stringify(data);
  if (new TextEncoder().encode(body).byteLength > MAX_JSON_BYTES) {
    throw new Error(`Record is too large to store: ${pathname}.`);
  }

  const shared = {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: JSON_CACHE_SECONDS,
  } as const;

  const result =
    mode.kind === "create"
      ? await put(pathname, body, { ...shared, allowOverwrite: false })
      : await put(pathname, body, { ...shared, allowOverwrite: true, ifMatch: mode.etag });

  return { etag: result.etag };
}

/** True when a replace failed because someone else changed the file first. */
export function isWriteConflict(error: unknown): boolean {
  return error instanceof BlobPreconditionFailedError;
}

/* Uploaded files */

export type StoredFile = {
  readonly pathname: string;
  readonly bytes: Uint8Array;
  /** Taken from storage, never from what the browser claimed. */
  readonly contentType: string;
  readonly byteSize: number;
  readonly uploadedAt: Date;
};

/**
 * Reads an uploaded file into memory, for the reader to send on
 * (decision 43). Returns null when the file does not exist. Refuses
 * anything larger than an upload can be.
 */
export async function readFile(pathname: string): Promise<StoredFile | null> {
  const result = await get(pathname, { access: "private" });
  if (result === null) {
    return null;
  }
  if (result.statusCode !== 200 || result.stream === null) {
    throw new Error(`Storage returned no content for ${pathname}.`);
  }
  if (result.blob.size !== null && result.blob.size > MAX_UPLOAD_BYTES) {
    await result.stream.cancel();
    throw new Error(`Stored file is larger than an upload can be: ${pathname}.`);
  }

  const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`Stored file is larger than an upload can be: ${pathname}.`);
  }

  return {
    pathname: result.blob.pathname,
    bytes,
    contentType: result.blob.contentType ?? "application/octet-stream",
    byteSize: bytes.byteLength,
    uploadedAt: result.blob.uploadedAt,
  };
}