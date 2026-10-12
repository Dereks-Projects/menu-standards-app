/*
 * Location: menu-standards-app/src/app/(admin)/restaurants/new/NewGroupForm.tsx
 *
 * The new group form, shown by page.tsx in this folder. It records a
 * single restaurant, a hotel, or a restaurant group, with its outlets, and
 * saves through src/app/api/groups/route.ts.
 *
 * How it works:
 * - Addresses are suggested from the names as they are typed. Typing an
 *   address by hand stops the suggestion for that field.
 * - Mistakes are listed when Save is pressed, and each field shows its own
 *   message. The same naming rules run here and on the server
 *   (src/lib/slugs/reserved.ts); the server's check is the one that counts.
 * - Save is refused while a save is in progress, so one press saves once.
 * - The server's reply is checked against the group and outlet schemas
 *   before anything from it is shown.
 *
 * Accessibility: every field has a visible label, errors pair an icon with
 * words and are linked to their field, and focus moves to the result after
 * saving so keyboard and screen reader users hear it.
 */

"use client";

import { CircleAlert, CircleCheck, Plus } from "lucide-react";
import Link from "next/link";
import { type ChangeEvent, type FormEvent, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { z } from "zod";

import { UNLOCK_PATH } from "@/lib/auth/access";
import { type GroupKind, groupPath, GroupSchema, outletPath, OutletSchema } from "@/lib/schemas/tenant";
import { checkSlug, MAX_SLUG_LENGTH, slugify } from "@/lib/slugs/reserved";
import type { MAX_NEW_OUTLETS, NewGroupRequest } from "@/lib/tenants/create-group";

import styles from "./NewGroup.module.css";

const SAVE_PATH = "/api/groups";
const PAGE_PATH = "/restaurants/new";

/*
 * Limits from src/lib/tenants/create-group.ts, which the server enforces.
 * The outlet limit is tied to that file, so the build fails if they differ.
 */
const MAX_OUTLETS: typeof MAX_NEW_OUTLETS = 30;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 200;

/** The longest server message shown on screen. */
const MAX_MESSAGE_LENGTH = 300;

const KIND_OPTIONS: readonly { readonly value: GroupKind; readonly label: string; readonly hint: string }[] = [
  {
    value: "single",
    label: "Single restaurant",
    hint: "One restaurant with one address.",
  },
  {
    value: "hotel",
    label: "Hotel",
    hint: "A hotel with one or more outlets.",
  },
  {
    value: "restaurant_group",
    label: "Restaurant group",
    hint: "A company with one or more restaurants.",
  },
];

/* The form's contents */

type OutletRow = {
  /** Identifies the row on screen only. Never sent. */
  readonly key: string;
  readonly name: string;
  readonly slug: string;
  /** True once the address is typed by hand, so the name stops suggesting it. */
  readonly slugEdited: boolean;
  readonly description: string;
};

type Draft = {
  readonly kind: GroupKind | null;
  readonly name: string;
  readonly slug: string;
  readonly slugEdited: boolean;
  /** Kept when the type changes to single, so switching back restores them. */
  readonly outlets: readonly OutletRow[];
};

const EMPTY_DRAFT: Draft = { kind: null, name: "", slug: "", slugEdited: false, outlets: [] };

function emptyOutlet(key: string): OutletRow {
  return { key, name: "", slug: "", slugEdited: false, description: "" };
}

function hasOutlets(kind: GroupKind | null): boolean {
  return kind === "hotel" || kind === "restaurant_group";
}

/** Addresses are lowercase, so capitals are lowered as they are typed. */
function typedSlug(value: string): string {
  return value.toLowerCase();
}

/* Checking the form */

type FieldError = {
  /** Which field: "kind", "name", "slug", "outlets", or "{row key}.{field}". */
  readonly field: string;
  /** How the summary names the field, matching its label. */
  readonly label: string;
  readonly message: string;
};

/** Every mistake in the form, in the order the fields appear. */
function findErrors(draft: Draft): FieldError[] {
  const errors: FieldError[] = [];

  if (draft.kind === null) {
    errors.push({ field: "kind", label: "Type", message: "Choose a type." });
  }

  if (draft.name.trim().length === 0) {
    errors.push({ field: "name", label: "Name", message: "Enter the name." });
  }

  const groupSlug = checkSlug(draft.slug);
  if (!groupSlug.ok) {
    errors.push({ field: "slug", label: "Address", message: groupSlug.reason });
  }

  if (!hasOutlets(draft.kind)) {
    return errors;
  }

  if (draft.outlets.length === 0) {
    errors.push({ field: "outlets", label: "Outlets", message: "Add at least one outlet." });
  }

  const seen = new Set<string>();
  draft.outlets.forEach((row, index) => {
    const label = `Outlet ${index + 1}`;
    if (row.name.trim().length === 0) {
      errors.push({ field: `${row.key}.name`, label: `${label} name`, message: "Enter the outlet name." });
    }
    const outletSlug = checkSlug(row.slug);
    let slugMessage: string | null = null;
    if (!outletSlug.ok) {
      slugMessage = outletSlug.reason;
    } else if (row.slug === draft.slug) {
      slugMessage = "Use an address different from the group's.";
    } else if (seen.has(row.slug)) {
      slugMessage = "Another outlet in this group already uses it.";
    }
    seen.add(row.slug);
    if (slugMessage !== null) {
      errors.push({ field: `${row.key}.slug`, label: `${label} address`, message: slugMessage });
    }
  });

  return errors;
}

/** What the save route receives. Typed by the server's own request shape. */
function toRequest(draft: Draft, kind: GroupKind): NewGroupRequest {
  return {
    name: draft.name.trim(),
    slug: draft.slug,
    kind,
    outlets: hasOutlets(kind)
      ? draft.outlets.map((row) => ({
          name: row.name.trim(),
          slug: row.slug,
          description: row.description.trim(),
        }))
      : [],
  };
}

/* Saving */

const SavedGroupSchema = z.object({
  group: GroupSchema,
  outlets: z.array(OutletSchema).min(1),
});

const ErrorReplySchema = z.object({ error: z.string().trim().min(1) });

type SavedGroup = z.infer<typeof SavedGroupSchema>;

type SaveState =
  | { readonly status: "editing" }
  | { readonly status: "saving" }
  | { readonly status: "failed"; readonly message: string; readonly locked: boolean }
  | { readonly status: "saved"; readonly saved: SavedGroup };

function failed(message: string, locked = false): SaveState {
  const shortened = message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}...` : message;
  return { status: "failed", message: shortened, locked };
}

/** Sends the group to the save route and turns any reply into a state. */
async function sendGroup(request: NewGroupRequest): Promise<SaveState> {
  let response: Response;
  try {
    response = await fetch(SAVE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return failed("Could not reach the server. Check the connection, then press Save again.");
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A reply that is not JSON is handled by its status below.
  }

  if (response.status === 401) {
    return failed("This device is locked. Unlock it, then fill in the form again.", true);
  }

  if (response.status === 201) {
    const saved = SavedGroupSchema.safeParse(body);
    if (saved.success) {
      return { status: "saved", saved: saved.data };
    }
    return failed(
      "The group may have been saved, but the reply could not be read. Press Save again: if the address is taken, it was saved.",
    );
  }

  const reply = ErrorReplySchema.safeParse(body);
  if (reply.success) {
    return failed(reply.data.error);
  }
  return failed(`Saving failed (error ${response.status}). Try again.`);
}

/* Small pieces */

function FieldMessage({ id, message }: { readonly id: string; readonly message: string }) {
  return (
    <p id={id} className={styles.fieldError}>
      <CircleAlert aria-hidden="true" size={16} className={styles.icon} />
      <span>{message}</span>
    </p>
  );
}

/* The form */

export function NewGroupForm() {
  const formId = useId();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [showErrors, setShowErrors] = useState(false);
  const [save, setSave] = useState<SaveState>({ status: "editing" });

  const nextRowNumber = useRef(0);
  const isSending = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const addOutletRef = useRef<HTMLButtonElement>(null);

  const errors = findErrors(draft);
  const errorByField = new Map(errors.map((error) => [error.field, error.message]));
  const isSaving = save.status === "saving";

  /** The page-wide id of a field, for labels and error links. */
  function fieldId(field: string): string {
    return `${formId}-${field.replace(/\./g, "-")}`;
  }

  /** The props that tie a field to its error, once errors are showing. */
  function errorProps(field: string) {
    const message = showErrors ? errorByField.get(field) : undefined;
    return {
      "aria-invalid": message !== undefined,
      "aria-describedby": message !== undefined ? `${fieldId(field)}-error` : `${fieldId(field)}-hint`,
    };
  }

  function visibleError(field: string): string | undefined {
    return showErrors ? errorByField.get(field) : undefined;
  }

  function newRowKey(): string {
    nextRowNumber.current += 1;
    return `row${nextRowNumber.current}`;
  }

  /* Changes */

  function changeKind(kind: GroupKind) {
    const firstRow = emptyOutlet(newRowKey());
    setDraft((current) => ({
      ...current,
      kind,
      outlets: hasOutlets(kind) && current.outlets.length === 0 ? [firstRow] : current.outlets,
    }));
  }

  function changeName(name: string) {
    setDraft((current) => ({ ...current, name, slug: current.slugEdited ? current.slug : slugify(name) }));
  }

  function changeSlug(value: string) {
    const slug = typedSlug(value);
    setDraft((current) => ({ ...current, slug, slugEdited: slug.length > 0 }));
  }

  function updateOutlet(key: string, change: (row: OutletRow) => OutletRow) {
    setDraft((current) => ({
      ...current,
      outlets: current.outlets.map((row) => (row.key === key ? change(row) : row)),
    }));
  }

  function addOutlet() {
    const row = emptyOutlet(newRowKey());
    flushSync(() => {
      setDraft((current) =>
        current.outlets.length >= MAX_OUTLETS ? current : { ...current, outlets: [...current.outlets, row] },
      );
    });
    document.getElementById(fieldId(`${row.key}.name`))?.focus();
  }

  function removeOutlet(key: string) {
    flushSync(() => {
      setDraft((current) => ({ ...current, outlets: current.outlets.filter((row) => row.key !== key) }));
    });
    addOutletRef.current?.focus();
  }

  function startOver() {
    flushSync(() => {
      setDraft(EMPTY_DRAFT);
      setShowErrors(false);
      setSave({ status: "editing" });
    });
    document.getElementById(fieldId("kind"))?.focus();
  }

  /* Saving */

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSending.current) {
      return;
    }

    if (errors.length > 0 || draft.kind === null) {
      flushSync(() => {
        setShowErrors(true);
        setSave({ status: "editing" });
      });
      summaryRef.current?.focus();
      return;
    }

    isSending.current = true;
    setSave({ status: "saving" });
    const outcome = await sendGroup(toRequest(draft, draft.kind));
    isSending.current = false;

    flushSync(() => {
      setSave(outcome);
    });
    resultRef.current?.focus();
  }

  /* The saved group */

  if (save.status === "saved") {
    const { group, outlets } = save.saved;
    const isSingle = group.kind === "single";
    return (
      <div ref={resultRef} tabIndex={-1} className={styles.success}>
        <h2 className={styles.successTitle}>
          <CircleCheck aria-hidden="true" size={20} className={styles.icon} />
          <span>Saved {group.name}</span>
        </h2>
        <p className={styles.successLead}>
          {isSingle ? "Its address is below." : "Its outlets and their addresses are below."} Addresses never change.
        </p>
        <ul className={styles.savedList}>
          {isSingle ? (
            <li className={styles.savedItem}>
              <span>{group.name}</span>
              <code className={styles.address}>{groupPath(group.slug)}</code>
            </li>
          ) : (
            outlets.map((outlet) => (
              <li key={outlet.outletId} className={styles.savedItem}>
                <span>{outlet.name}</span>
                <code className={styles.address}>{outletPath(group.slug, outlet.slug)}</code>
              </li>
            ))
          )}
        </ul>
        <button type="button" className={styles.secondaryButton} onClick={startOver}>
          Add another group
        </button>
      </div>
    );
  }

  /* The form itself */

  const showOutlets = hasOutlets(draft.kind);
  const groupAddress = draft.slug.length > 0 ? groupPath(draft.slug) : null;

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate aria-busy={isSaving}>
      {showErrors && errors.length > 0 && (
        <div ref={summaryRef} tabIndex={-1} role="alert" className={styles.summary}>
          <p className={styles.summaryTitle}>
            <CircleAlert aria-hidden="true" size={18} className={styles.icon} />
            <span>
              {errors.length === 1 ? "Fix 1 thing before saving:" : `Fix ${errors.length} things before saving:`}
            </span>
          </p>
          <ul className={styles.summaryList}>
            {errors.map((error) => (
              <li key={error.field}>
                <a href={`#${fieldId(error.field)}`} className={styles.summaryLink}>
                  {error.label}: {error.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <fieldset className={styles.fieldsetReset} disabled={isSaving}>
        <fieldset
          id={fieldId("kind")}
          tabIndex={-1}
          className={styles.kindGroup}
          aria-describedby={visibleError("kind") !== undefined ? `${fieldId("kind")}-error` : undefined}
        >
          <legend className={styles.label}>Type</legend>
          {visibleError("kind") !== undefined && (
            <FieldMessage id={`${fieldId("kind")}-error`} message={visibleError("kind") ?? ""} />
          )}
          <div className={styles.kindOptions}>
            {KIND_OPTIONS.map((option) => (
              <label key={option.value} className={styles.kindOption}>
                <input
                  type="radio"
                  name={`${formId}-kind`}
                  value={option.value}
                  checked={draft.kind === option.value}
                  onChange={() => changeKind(option.value)}
                  className={styles.radio}
                />
                <span className={styles.kindText}>
                  <span className={styles.kindLabel}>{option.label}</span>
                  <span className={styles.hint}>{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className={styles.field}>
          <label htmlFor={fieldId("name")} className={styles.label}>
            Name
          </label>
          <input
            id={fieldId("name")}
            type="text"
            value={draft.name}
            onChange={(event: ChangeEvent<HTMLInputElement>) => changeName(event.currentTarget.value)}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="off"
            required
            className={styles.input}
            {...errorProps("name")}
          />
          {visibleError("name") !== undefined ? (
            <FieldMessage id={`${fieldId("name")}-error`} message={visibleError("name") ?? ""} />
          ) : (
            <p id={`${fieldId("name")}-hint`} className={styles.hint}>
              As it should appear in the program.
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={fieldId("slug")} className={styles.label}>
            Address
          </label>
          <input
            id={fieldId("slug")}
            type="text"
            value={draft.slug}
            onChange={(event: ChangeEvent<HTMLInputElement>) => changeSlug(event.currentTarget.value)}
            maxLength={MAX_SLUG_LENGTH}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            className={styles.input}
            {...errorProps("slug")}
          />
          {visibleError("slug") !== undefined ? (
            <FieldMessage id={`${fieldId("slug")}-error`} message={visibleError("slug") ?? ""} />
          ) : (
            <p id={`${fieldId("slug")}-hint`} className={styles.hint}>
              {groupAddress !== null ? <>Shown as <code className={styles.address}>{groupAddress}</code>. </> : null}
              Lowercase letters, numbers, and hyphens. It cannot change after saving.
            </p>
          )}
        </div>

        {showOutlets && (
          <fieldset
            id={fieldId("outlets")}
            tabIndex={-1}
            className={styles.outlets}
            aria-describedby={visibleError("outlets") !== undefined ? `${fieldId("outlets")}-error` : undefined}
          >
            <legend className={styles.label}>Outlets</legend>
            {visibleError("outlets") !== undefined && (
              <FieldMessage id={`${fieldId("outlets")}-error`} message={visibleError("outlets") ?? ""} />
            )}

            {draft.outlets.map((row, index) => {
              const headingId = fieldId(`${row.key}.heading`);
              const outletAddress =
                draft.slug.length > 0 && row.slug.length > 0 ? outletPath(draft.slug, row.slug) : null;
              return (
                <div key={row.key} role="group" aria-labelledby={headingId} className={styles.outlet}>
                  <div className={styles.outletHeader}>
                    <h3 id={headingId} className={styles.outletTitle}>
                      Outlet {index + 1}
                    </h3>
                    <button
                      type="button"
                      className={styles.textButton}
                      onClick={() => removeOutlet(row.key)}
                      disabled={draft.outlets.length === 1}
                      aria-label={`Remove outlet ${index + 1}`}
                    >
                      Remove
                    </button>
                  </div>

                  <div className={styles.field}>
                    <label htmlFor={fieldId(`${row.key}.name`)} className={styles.label}>
                      Outlet name
                    </label>
                    <input
                      id={fieldId(`${row.key}.name`)}
                      type="text"
                      value={row.name}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        const name = event.currentTarget.value;
                        updateOutlet(row.key, (current) => ({
                          ...current,
                          name,
                          slug: current.slugEdited ? current.slug : slugify(name),
                        }));
                      }}
                      maxLength={MAX_NAME_LENGTH}
                      autoComplete="off"
                      required
                      className={styles.input}
                      {...errorProps(`${row.key}.name`)}
                    />
                    {visibleError(`${row.key}.name`) !== undefined ? (
                      <FieldMessage
                        id={`${fieldId(`${row.key}.name`)}-error`}
                        message={visibleError(`${row.key}.name`) ?? ""}
                      />
                    ) : (
                      <p id={`${fieldId(`${row.key}.name`)}-hint`} className={styles.hint}>
                        For example Atlantic Grille.
                      </p>
                    )}
                  </div>

                  <div className={styles.field}>
                    <label htmlFor={fieldId(`${row.key}.slug`)} className={styles.label}>
                      Outlet address
                    </label>
                    <input
                      id={fieldId(`${row.key}.slug`)}
                      type="text"
                      value={row.slug}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        const slug = typedSlug(event.currentTarget.value);
                        updateOutlet(row.key, (current) => ({ ...current, slug, slugEdited: slug.length > 0 }));
                      }}
                      maxLength={MAX_SLUG_LENGTH}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                      className={styles.input}
                      {...errorProps(`${row.key}.slug`)}
                    />
                    {visibleError(`${row.key}.slug`) !== undefined ? (
                      <FieldMessage
                        id={`${fieldId(`${row.key}.slug`)}-error`}
                        message={visibleError(`${row.key}.slug`) ?? ""}
                      />
                    ) : (
                      <p id={`${fieldId(`${row.key}.slug`)}-hint`} className={styles.hint}>
                        {outletAddress !== null ? (
                          <>
                            Shown as <code className={styles.address}>{outletAddress}</code>.
                          </>
                        ) : (
                          "Lowercase letters, numbers, and hyphens."
                        )}
                      </p>
                    )}
                  </div>

                  <div className={styles.field}>
                    <label htmlFor={fieldId(`${row.key}.description`)} className={styles.label}>
                      Description <span className={styles.optional}>(optional)</span>
                    </label>
                    <input
                      id={fieldId(`${row.key}.description`)}
                      type="text"
                      value={row.description}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        const description = event.currentTarget.value;
                        updateOutlet(row.key, (current) => ({ ...current, description }));
                      }}
                      maxLength={MAX_DESCRIPTION_LENGTH}
                      autoComplete="off"
                      aria-describedby={`${fieldId(`${row.key}.description`)}-hint`}
                      className={styles.input}
                    />
                    <p id={`${fieldId(`${row.key}.description`)}-hint`} className={styles.hint}>
                      For example Rooftop bar or Main dining room.
                    </p>
                  </div>
                </div>
              );
            })}

            <button
              ref={addOutletRef}
              type="button"
              className={styles.secondaryButton}
              onClick={addOutlet}
              disabled={draft.outlets.length >= MAX_OUTLETS}
            >
              <Plus aria-hidden="true" size={16} className={styles.icon} />
              Add outlet
            </button>
            {draft.outlets.length >= MAX_OUTLETS && (
              <p className={styles.hint}>{MAX_OUTLETS} outlets is the most one group can list.</p>
            )}
          </fieldset>
        )}

        {draft.kind === "single" && (
          <p className={styles.note}>One outlet is created with the same name and address.</p>
        )}

        {save.status === "failed" && (
          <div ref={resultRef} tabIndex={-1} role="alert" className={styles.failure}>
            <CircleAlert aria-hidden="true" size={18} className={styles.icon} />
            <p>
              {save.message}
              {save.locked && (
                <>
                  {" "}
                  <Link href={`${UNLOCK_PATH}?next=${encodeURIComponent(PAGE_PATH)}`}>Unlock this device</Link>
                </>
              )}
            </p>
          </div>
        )}

        <button type="submit" className={styles.primaryButton}>
          {isSaving ? "Saving..." : "Save"}
        </button>
      </fieldset>

      <p role="status" className="visually-hidden">
        {isSaving ? "Saving." : ""}
      </p>
    </form>
  );
}