/*
 * Location: menu-standards-app/src/components/upload/OtherMenuField.tsx
 *
 * The "other menus" part of the upload screen: a menu type dropdown with
 * its own drop zone, repeated as often as needed. Types offered: bar menu,
 * full wine list, non-alcoholic list, specials, and other. The full wine
 * list is offered only here, because wine lists default to by the glass
 * and featured bottles, and the full list is opt-in.
 *
 * A row's type locks once a file is added to it, so every file in that
 * row is read as the same type.
 */

"use client";

import { Plus } from "lucide-react";
import { type ChangeEvent, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";

import type { MenuType } from "@/lib/schemas/menu";

import styles from "./Upload.module.css";
import { UploadField } from "./UploadField";

type OtherType = Exclude<MenuType, "food" | "cocktail" | "by_the_glass">;

const OTHER_TYPES: readonly { readonly value: OtherType; readonly label: string }[] = [
  { value: "bar", label: "Bar menu" },
  { value: "wine_list", label: "Full wine list" },
  { value: "non_alcoholic", label: "Non-alcoholic list" },
  { value: "specials", label: "Specials" },
  { value: "other", label: "Other" },
];

/** The most rows one screen offers. */
const MAX_ROWS = 10;

type Row = {
  readonly key: string;
  readonly type: OtherType | null;
  /** True once a file was added, which locks the type. */
  readonly started: boolean;
};

function toOtherType(value: string): OtherType | null {
  return OTHER_TYPES.find((option) => option.value === value)?.value ?? null;
}

function labelFor(type: OtherType | null): string {
  return OTHER_TYPES.find((option) => option.value === type)?.label ?? "Menu";
}

export type OtherMenuFieldProps = {
  readonly groupSlug: string;
  readonly outletSlug: string;
};

export function OtherMenuField({ groupSlug, outletSlug }: OtherMenuFieldProps) {
  const fieldId = useId();
  const [rows, setRows] = useState<readonly Row[]>([{ key: "row1", type: null, started: false }]);
  const nextRowNumber = useRef(1);

  function selectId(key: string): string {
    return `${fieldId}-${key}-type`;
  }

  function updateRow(key: string, change: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  function addRow() {
    nextRowNumber.current += 1;
    const key = `row${nextRowNumber.current}`;
    flushSync(() => {
      setRows((current) =>
        current.length >= MAX_ROWS ? current : [...current, { key, type: null, started: false }],
      );
    });
    document.getElementById(selectId(key))?.focus();
  }

  return (
    <fieldset className={styles.other}>
      <legend className={styles.fieldTitle}>Other menus</legend>
      <p className={styles.hint}>
        Bar menus, the full wine list, non-alcoholic lists, specials boards, or anything else. Choose the type,
        then add the files.
      </p>

      {rows.map((row, index) => (
        <div key={row.key} className={styles.otherRow}>
          <div className={styles.selectField}>
            <label htmlFor={selectId(row.key)} className={styles.label}>
              Menu type{rows.length > 1 ? ` (${index + 1})` : ""}
            </label>
            <select
              id={selectId(row.key)}
              value={row.type ?? ""}
              disabled={row.started}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                updateRow(row.key, { type: toOtherType(event.currentTarget.value) })
              }
              className={styles.select}
            >
              <option value="">Choose a type</option>
              {OTHER_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <UploadField
            groupSlug={groupSlug}
            outletSlug={outletSlug}
            menuType={row.type}
            label={row.type === null ? "Files" : `${labelFor(row.type)} files`}
            hint={
              row.started
                ? "The type is set for this row. Add another menu for a different type."
                : "Each file is read as the type chosen above."
            }
            headingLevel={3}
            onFirstFile={() => updateRow(row.key, { started: true })}
          />
        </div>
      ))}

      <button
        type="button"
        className={styles.secondaryButton}
        onClick={addRow}
        disabled={rows.length >= MAX_ROWS}
      >
        <Plus aria-hidden="true" size={16} className={styles.buttonIcon} />
        Add another menu
      </button>
    </fieldset>
  );
}