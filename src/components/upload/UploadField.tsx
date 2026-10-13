/*
 * Location: menu-standards-app/src/components/upload/UploadField.tsx
 *
 * One drop zone on the upload screen, for one menu type. Each file dropped
 * or chosen here gets its own row, which shows its progress and then how
 * many items the reader found.
 *
 * For each file:
 * 1. Checked in the browser: PDF, JPEG, PNG, or WebP, not empty, at most
 *    20 MB. iPhone HEIC photos are refused with a way around it, since the
 *    reader cannot read them. The server checks the type again.
 * 2. Sent straight to private storage. src/app/api/upload/route.ts grants
 *    permission for this one file; the file never passes through the site.
 * 3. Read by src/app/api/read/route.ts, which takes 1 to 4 minutes. A
 *    failed read is never resent on its own (decision 53). Read again reads
 *    the stored file once more, without uploading it again.
 *
 * If the site's security setting blocks the upload, the row names the
 * blocked address, so the setting is corrected from what the browser
 * reports, not guessed.
 *
 * Several files can be added at once, up to six, and each is read on its
 * own. The browser warns before leaving the page while any file is still
 * being sent or read.
 */

"use client";

import { uploadPresigned } from "@vercel/blob/client";
import { CircleAlert, CircleCheck, FileUp, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { type ChangeEvent, type DragEvent, useEffect, useId, useRef, useState } from "react";
import { z } from "zod";

import { UNLOCK_PATH } from "@/lib/auth/access";
import type { MenuType } from "@/lib/schemas/menu";
import type { MAX_REQUESTED_STEM_LENGTH, UploadContentType, UploadExtension } from "@/lib/storage/blob";

import styles from "./Upload.module.css";

const UPLOAD_PERMISSION_PATH = "/api/upload";
const READ_PATH = "/api/read";

/*
 * Limits from src/lib/storage/blob.ts, which the server enforces. The file
 * types and the name length are tied to that file, so the build fails if
 * they differ.
 */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_NAME_LENGTH: typeof MAX_REQUESTED_STEM_LENGTH = 80;
const FILE_TYPES: Readonly<Record<UploadExtension, UploadContentType>> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** What the file picker offers. Dropped files are checked the same way. */
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";

/** The most files one drop or pick may add. */
const MAX_FILES_AT_ONCE = 6;

/** The longest file name sent with a read, matching the read route. */
const MAX_FILE_NAME_LENGTH = 200;

/** The longest error message shown on screen. */
const MAX_MESSAGE_LENGTH = 300;

/* Checking a file */

type FileCheck =
  | { readonly ok: true; readonly extension: UploadExtension; readonly contentType: UploadContentType }
  | { readonly ok: false; readonly message: string };

function isUploadExtension(value: string): value is UploadExtension {
  return Object.hasOwn(FILE_TYPES, value);
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

function checkFile(file: File): FileCheck {
  const extension = extensionOf(file.name);
  const type = file.type.toLowerCase();

  if (extension === "heic" || extension === "heif" || type === "image/heic" || type === "image/heif") {
    return {
      ok: false,
      message:
        "iPhone HEIC photos can't be read. Upload a screenshot of the photo instead, or set the iPhone camera to Most Compatible (Settings, Camera, Formats).",
    };
  }
  if (!isUploadExtension(extension)) {
    return { ok: false, message: "This file type can't be read. Use a PDF, JPEG, PNG, or WebP file." };
  }
  if (file.size === 0) {
    return { ok: false, message: "This file is empty." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: "This file is larger than 20 MB. Use a smaller file or a lower resolution photo." };
  }
  return { ok: true, extension, contentType: FILE_TYPES[extension] };
}

/**
 * The storage address requested for a file, following the layout in
 * src/lib/storage/blob.ts. Storage adds a random ending to the name, and
 * the server refuses any address outside the layout.
 */
function uploadPathname(groupSlug: string, outletSlug: string, fileName: string, extension: UploadExtension): string {
  const dot = fileName.lastIndexOf(".");
  const stem =
    (dot === -1 ? fileName : fileName.slice(0, dot))
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_NAME_LENGTH)
      .replace(/-+$/g, "") || "menu";
  return `groups/${groupSlug}/outlets/${outletSlug}/uploads/${stem}.${extension}`;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shorten(message: string): string {
  return message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}...` : message;
}

/* The read's reply */

const ReadReplySchema = z.object({
  items: z.number().int().nonnegative(),
  sections: z.number().int().nonnegative(),
  houseTermsToConfirm: z.number().int().nonnegative(),
  consumerAdvisoryItems: z.number().int().nonnegative(),
  readerNotes: z.array(z.string()).max(20),
  costUsd: z.number().nonnegative(),
});

const ErrorReplySchema = z.object({ error: z.string().trim().min(1) });

type ReadResult = z.infer<typeof ReadReplySchema>;

/* One file's row */

type RowStage = "sending" | "reading" | "done" | "failed" | "refused";

type FileRow = {
  readonly key: string;
  readonly fileName: string;
  readonly size: string;
  readonly stage: RowStage;
  /** Percent sent, while sending. */
  readonly progress: number;
  /** The stored file's address, once it is in storage. */
  readonly blobPath: string | null;
  readonly result: ReadResult | null;
  readonly message: string | null;
  /** True when the read failed because this device is locked. */
  readonly locked: boolean;
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Seconds since the read started, so a long read visibly keeps going. */
function Elapsed() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const minutes = Math.floor(seconds / 60);
  return (
    <span className={styles.elapsed}>
      {minutes}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

function RowStatus({ row, onReadAgain }: { readonly row: FileRow; readonly onReadAgain: () => void }) {
  switch (row.stage) {
    case "sending":
      return (
        <>
          <p className={styles.status} aria-live="polite">
            <LoaderCircle aria-hidden="true" size={16} className={`${styles.icon} ${styles.spin}`} />
            <span>Sending</span>
          </p>
          <progress className={styles.progress} value={row.progress} max={100} aria-label={`Sending ${row.fileName}`} />
        </>
      );
    case "reading":
      return (
        <p className={styles.status} aria-live="polite">
          <LoaderCircle aria-hidden="true" size={16} className={`${styles.icon} ${styles.spin}`} />
          <span>
            Reading. This usually takes 1 to 4 minutes. <Elapsed />
          </span>
        </p>
      );
    case "done": {
      const result = row.result;
      if (result === null) {
        return null;
      }
      return (
        <div aria-live="polite">
          <p className={`${styles.status} ${styles.statusDone}`}>
            <CircleCheck aria-hidden="true" size={16} className={styles.icon} />
            <span>
              {plural(result.items, "item")} in {plural(result.sections, "section")}
            </span>
          </p>
          <ul className={styles.facts}>
            <li>{plural(result.houseTermsToConfirm, "house term")} to confirm</li>
            <li>{plural(result.consumerAdvisoryItems, "item")} with the raw or undercooked warning</li>
            <li>Cost ${result.costUsd.toFixed(2)}</li>
          </ul>
          {result.readerNotes.length > 0 && (
            <div className={styles.notes}>
              <p className={styles.notesTitle}>Reader notes</p>
              <ul className={styles.notesList}>
                {result.readerNotes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }
    case "failed":
    case "refused":
      return (
        <div className={styles.problem} role="alert">
          <CircleAlert aria-hidden="true" size={16} className={styles.icon} />
          <div>
            <p>
              {row.message}
              {row.locked && (
                <>
                  {" "}
                  <Link href={UNLOCK_PATH} target="_blank" rel="noopener">
                    Unlock in a new tab
                  </Link>
                </>
              )}
            </p>
            {row.stage === "failed" && row.blobPath !== null && (
              <button type="button" className={styles.textButton} onClick={onReadAgain}>
                Read again
              </button>
            )}
          </div>
        </div>
      );
  }
}

/* The field */

export type UploadFieldProps = {
  readonly groupSlug: string;
  readonly outletSlug: string;
  /** Null until a type is chosen; the field is switched off until then. */
  readonly menuType: MenuType | null;
  readonly label: string;
  readonly hint: string;
  readonly headingLevel?: 2 | 3;
  /** Called when the first file is added, so a type choice can be locked. */
  readonly onFirstFile?: () => void;
};

export function UploadField({
  groupSlug,
  outletSlug,
  menuType,
  label,
  hint,
  headingLevel = 2,
  onFirstFile,
}: UploadFieldProps) {
  const fieldId = useId();
  const [rows, setRows] = useState<readonly FileRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [fieldMessage, setFieldMessage] = useState<string | null>(null);
  const nextRowNumber = useRef(0);

  const isOff = menuType === null;
  const isBusy = rows.some((row) => row.stage === "sending" || row.stage === "reading");
  const Heading = headingLevel === 3 ? "h3" : "h2";

  // Leaving the page would abandon files still being sent or read.
  useEffect(() => {
    if (!isBusy) {
      return;
    }
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isBusy]);

  function updateRow(key: string, change: Partial<FileRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  async function readMenuFile(key: string, blobPath: string, fileName: string, type: MenuType) {
    updateRow(key, { stage: "reading", message: null, locked: false });

    let response: Response;
    try {
      response = await fetch(READ_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blobPath, menuType: type, fileName: fileName.slice(0, MAX_FILE_NAME_LENGTH) }),
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch {
      updateRow(key, {
        stage: "failed",
        message: "Could not reach the server. The file is saved, so press Read again when the connection is back.",
      });
      return;
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // A reply that is not JSON is handled by its status below.
    }

    if (response.status === 401) {
      updateRow(key, {
        stage: "failed",
        message: "This device is locked. Unlock it, then come back to this tab and press Read again.",
        locked: true,
      });
      return;
    }
    if (response.ok) {
      const reply = ReadReplySchema.safeParse(body);
      updateRow(
        key,
        reply.success
          ? { stage: "done", result: reply.data }
          : { stage: "failed", message: "The menu was read, but the reply could not be checked. Press Read again." },
      );
      return;
    }
    const reply = ErrorReplySchema.safeParse(body);
    updateRow(key, {
      stage: "failed",
      message: shorten(reply.success ? reply.data.error : `Reading failed (error ${response.status}). Try again.`),
    });
  }

  async function sendFile(key: string, file: File, extension: UploadExtension, contentType: UploadContentType, type: MenuType) {
    // The security setting reports a blocked address as a browser event,
    // not as part of the error, so the event is caught alongside.
    const blocked: string[] = [];
    function onViolation(event: SecurityPolicyViolationEvent) {
      blocked.push(event.blockedURI);
    }
    document.addEventListener("securitypolicyviolation", onViolation);

    let blobPath: string;
    try {
      const stored = await uploadPresigned(uploadPathname(groupSlug, outletSlug, file.name, extension), file, {
        access: "private",
        handleUploadUrl: UPLOAD_PERMISSION_PATH,
        contentType,
        multipart: false,
        onUploadProgress: ({ percentage }) => updateRow(key, { progress: Math.round(percentage) }),
      });
      blobPath = stored.pathname;
    } catch (error) {
      // The violation event can arrive just after the error.
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      const blockedAddress = blocked[0];
      updateRow(key, {
        stage: "failed",
        message: shorten(
          blockedAddress !== undefined
            ? `This site's security setting blocked the upload. Blocked address: ${blockedAddress}`
            : `The upload failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      });
      return;
    } finally {
      document.removeEventListener("securitypolicyviolation", onViolation);
    }

    updateRow(key, { blobPath, progress: 100 });
    await readMenuFile(key, blobPath, file.name, type);
  }

  function addFiles(files: readonly File[]) {
    const type = menuType;
    if (type === null || files.length === 0) {
      return;
    }
    if (files.length > MAX_FILES_AT_ONCE) {
      setFieldMessage(`Add at most ${MAX_FILES_AT_ONCE} files at a time.`);
      return;
    }
    setFieldMessage(null);
    if (rows.length === 0) {
      onFirstFile?.();
    }

    const added: FileRow[] = [];
    const work: Array<() => Promise<void>> = [];
    for (const file of files) {
      nextRowNumber.current += 1;
      const key = `file${nextRowNumber.current}`;
      const check = checkFile(file);
      added.push({
        key,
        fileName: file.name,
        size: sizeLabel(file.size),
        stage: check.ok ? "sending" : "refused",
        progress: 0,
        blobPath: null,
        result: null,
        message: check.ok ? null : check.message,
        locked: false,
      });
      if (check.ok) {
        work.push(() => sendFile(key, file, check.extension, check.contentType, type));
      }
    }

    setRows((current) => [...current, ...added]);
    for (const start of work) {
      void start();
    }
  }

  function readAgain(row: FileRow) {
    if (row.blobPath === null || menuType === null || row.stage !== "failed") {
      return;
    }
    void readMenuFile(row.key, row.blobPath, row.fileName, menuType);
  }

  function handleChoose(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.currentTarget.files ?? []));
    // Lets the same file be chosen again later.
    event.currentTarget.value = "";
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!isOff && !dragging) {
      setDragging(true);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  const titleId = `${fieldId}-title`;
  const hintId = `${fieldId}-hint`;
  const inputId = `${fieldId}-input`;
  const zoneTextId = `${fieldId}-zone`;
  const zoneClass = [styles.zone, dragging ? styles.zoneActive : "", isOff ? styles.zoneOff : ""]
    .filter((name) => name !== "")
    .join(" ");

  return (
    <div className={styles.field} role="group" aria-labelledby={titleId}>
      <Heading id={titleId} className={styles.fieldTitle}>
        {label}
      </Heading>
      <p id={hintId} className={styles.hint}>
        {hint}
      </p>

      <div
        className={zoneClass}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          id={inputId}
          type="file"
          multiple
          accept={ACCEPT}
          disabled={isOff}
          onChange={handleChoose}
          aria-labelledby={`${titleId} ${zoneTextId}`}
          aria-describedby={hintId}
          className={`visually-hidden ${styles.fileInput}`}
        />
        <label htmlFor={inputId} className={styles.zoneLabel}>
          <FileUp aria-hidden="true" size={22} className={styles.zoneIcon} />
          <span id={zoneTextId}>
            {isOff ? (
              "Choose a menu type first"
            ) : (
              <>
                Drop files here, or <span className={styles.zoneLink}>choose files</span>
              </>
            )}
          </span>
        </label>
      </div>

      {fieldMessage !== null && (
        <p className={styles.fieldMessage} role="alert">
          <CircleAlert aria-hidden="true" size={16} className={styles.icon} />
          <span>{fieldMessage}</span>
        </p>
      )}

      {rows.length > 0 && (
        <ul className={styles.rows}>
          {rows.map((row) => (
            <li key={row.key} className={styles.row}>
              <p className={styles.fileName}>
                <span className={styles.fileNameText}>{row.fileName}</span>
                <span className={styles.fileSize}>{row.size}</span>
              </p>
              <RowStatus row={row} onReadAgain={() => readAgain(row)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}