/*
 * Location: menu-standards-app/src/components/plan/PlanView.tsx
 *
 * The plan screen: the one-page plan a manager reads, adjusts, and approves
 * before anything is built. The page that shows it is
 * src/app/admin/[group]/[outlet]/plan/page.tsx, and every change is saved
 * by src/app/api/plan/route.ts as a new version.
 *
 * What the screen shows, top to bottom:
 * 1. Four numbers: menu items, key terms, house terms to confirm, and study
 *    time per person.
 * 2. The synopsis: three sentences, the way a chef would describe the menu.
 * 3. Confirm before we build: each house term with the reader's question
 *    and a field for the answer. A term can be left out instead.
 * 4. What gets built, by track, with the exam's pass mark.
 * 5. The menus the plan is built from.
 * 6. Adjust plan, and Approve plan. Approve is the only primary button.
 *
 * Adjust plan opens the synopsis, the pass mark, and the menus for editing.
 * Changing the menus writes a new plan, which takes about a minute; answers
 * and the pass mark carry over. An approved plan is locked. Start a new
 * plan makes a new draft from it, and the approved version stays on record.
 *
 * Every reply from the route is checked against PlanSchema before it is
 * shown. The browser warns before leaving the page with unsaved changes or
 * while a plan is being written.
 */

"use client";

import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { type ChangeEvent, type FormEvent, useEffect, useId, useState, useSyncExternalStore } from "react";
import { z } from "zod";

import { UNLOCK_PATH } from "@/lib/auth/access";
import type { PlanChanges } from "@/lib/engine/plan";
import type { Track } from "@/lib/schemas/common";
import type { MenuType } from "@/lib/schemas/menu";
import {
  MAX_ANSWER_LENGTH,
  MAX_PASS_THRESHOLD,
  MAX_PLAN_MENUS,
  MAX_SYNOPSIS_LENGTH,
  MIN_PASS_THRESHOLD,
  type Plan,
  type PlanHouseTerm,
  PlanSchema,
  type PlanTrack,
} from "@/lib/schemas/plan";

import styles from "./Plan.module.css";

const PLAN_API_PATH = "/api/plan";

/** The longest error message shown on screen. */
const MAX_MESSAGE_LENGTH = 300;

const MENU_TYPE_LABELS: Readonly<Record<MenuType, string>> = {
  food: "Food menu",
  cocktail: "Cocktail menu",
  by_the_glass: "Wines by the glass",
  bar: "Bar menu",
  wine_list: "Full wine list",
  non_alcoholic: "Non-alcoholic menu",
  specials: "Specials",
  other: "Other menu",
};

const TRACK_LABELS: Readonly<Record<Track, string>> = {
  food: "Food",
  beverage: "Beverage",
};

/** One menu read for this outlet, as the screen shows it. */
export type MenuChoice = {
  readonly menuId: string;
  readonly menuType: MenuType;
  readonly fileName: string;
  readonly readAt: string;
  readonly items: number;
};

export type PlanViewProps = {
  readonly groupSlug: string;
  readonly outletSlug: string;
  /** The outlet's name, as the upload screen shows it. */
  readonly place: string;
  readonly uploadPath: string;
  /** Every menu read for this outlet, newest first. */
  readonly menus: readonly MenuChoice[];
  /** The menus a first plan includes unless changed (defaultMenuSelection in the engine). */
  readonly defaultMenuIds: readonly string[];
  /** The outlet's latest plan version, or null when it has none yet. */
  readonly initialPlan: Plan | null;
};

/* Replies from the plan route */

const PlanReplySchema = z.object({ plan: PlanSchema });
const ErrorReplySchema = z.object({ error: z.string().trim().min(1) });

/* Local edits, before they are saved */

type TermEdit = { readonly answer: string; readonly leftOut: boolean };

type Edits = {
  readonly synopsis: string;
  /** Kept as typed, so the field can be cleared while typing; checked before saving. */
  readonly passMark: string;
  readonly terms: Readonly<Record<string, TermEdit>>;
};

function editsFrom(plan: Plan): Edits {
  const terms: Record<string, TermEdit> = {};
  for (const term of plan.houseTerms) {
    terms[term.termKey] = { answer: term.answer, leftOut: term.status === "left_out" };
  }
  return { synopsis: plan.synopsis, passMark: String(plan.examPassThreshold), terms };
}

function termEdit(edits: Edits, term: PlanHouseTerm): TermEdit {
  return edits.terms[term.termKey] ?? { answer: term.answer, leftOut: term.status === "left_out" };
}

/** The pass mark as a whole number in range, or null when the field holds anything else. */
function passMarkValue(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[0-9]{1,3}$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return value >= MIN_PASS_THRESHOLD && value <= MAX_PASS_THRESHOLD ? value : null;
}

function isUnchanged(plan: Plan, edits: Edits): boolean {
  if (edits.synopsis.trim() !== plan.synopsis || passMarkValue(edits.passMark) !== plan.examPassThreshold) {
    return false;
  }
  return plan.houseTerms.every((term) => {
    const edit = termEdit(edits, term);
    return edit.leftOut === (term.status === "left_out") && (edit.leftOut || edit.answer.trim() === term.answer);
  });
}

/** House terms with neither an answer nor a choice to leave them out. */
function waitingCount(plan: Plan, edits: Edits): number {
  return plan.houseTerms.filter((term) => {
    const edit = termEdit(edits, term);
    return !edit.leftOut && edit.answer.trim() === "";
  }).length;
}

/** What the route is sent. The pass mark must already be checked. */
function changesFrom(plan: Plan, edits: Edits, passMark: number): PlanChanges {
  return {
    synopsis: edits.synopsis,
    examPassThreshold: passMark,
    answers: plan.houseTerms.map((term) => {
      const edit = termEdit(edits, term);
      return { termKey: term.termKey, answer: edit.leftOut ? "" : edit.answer, leftOut: edit.leftOut };
    }),
  };
}

function includedIds(plan: Plan): string[] {
  return plan.menus.filter((menu) => menu.included).map((menu) => menu.menuId);
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((id) => set.has(id));
}

/* Wording */

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "45 min", "1 hr 20 min". */
function duration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

function shorten(message: string): string {
  return message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}...` : message;
}

/* Small pieces */

const noSubscription = () => () => {};

/** False on the server and during hydration, true afterward, so times show in this device's time zone. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

const TIME_FORMAT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function When({ iso, dateOnly = false }: { readonly iso: string; readonly dateOnly?: boolean }) {
  const hydrated = useHydrated();
  return (
    <time dateTime={iso}>{hydrated ? (dateOnly ? DATE_FORMAT : TIME_FORMAT).format(Date.parse(iso)) : ""}</time>
  );
}

/** Seconds since the plan started being written, so a long wait visibly keeps going. */
function Elapsed() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span className={styles.elapsed}>
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

type Notice =
  | { readonly kind: "error"; readonly text: string; readonly locked: boolean; readonly stale: boolean }
  | { readonly kind: "done"; readonly text: string };

function NoticeLine({ notice }: { readonly notice: Notice }) {
  if (notice.kind === "done") {
    return (
      <p className={`${styles.notice} ${styles.noticeDone}`} role="status">
        <CircleCheck aria-hidden="true" size={16} className={styles.icon} />
        <span>{notice.text}</span>
      </p>
    );
  }
  return (
    <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
      <CircleAlert aria-hidden="true" size={16} className={styles.icon} />
      <p>
        {notice.text}
        {notice.locked && (
          <>
            {" "}
            <Link href={UNLOCK_PATH} target="_blank" rel="noopener">
              Unlock in a new tab
            </Link>
          </>
        )}
        {notice.stale && (
          <>
            {" "}
            <button type="button" className={styles.inlineButton} onClick={() => window.location.reload()}>
              Reload the page
            </button>
          </>
        )}
      </p>
    </div>
  );
}

function Working({ action }: { readonly action: Action }) {
  return (
    <p className={styles.working} role="status">
      <LoaderCircle aria-hidden="true" size={16} className={`${styles.icon} ${styles.spin}`} />
      {action === "create" ? (
        <span>
          Writing the plan. This usually takes about a minute. <Elapsed />
        </span>
      ) : (
        <span>{action === "approve" ? "Approving" : "Saving"}</span>
      )}
    </p>
  );
}

function MenuList({
  menus,
  selected,
  disabled,
  onToggle,
  legend,
}: {
  readonly menus: readonly MenuChoice[];
  readonly selected: readonly string[];
  readonly disabled: boolean;
  readonly onToggle: (menuId: string) => void;
  readonly legend: string;
}) {
  const hasWineList = menus.some((menu) => menu.menuType === "wine_list");
  return (
    <fieldset className={styles.menuChoices}>
      <legend className={styles.sectionTitle}>{legend}</legend>
      <p className={styles.sectionLead}>
        Choose up to {MAX_PLAN_MENUS}. When a menu was read more than once, choose the newest read.
        {hasWineList && " The full wine list is left out unless you include it."}
      </p>
      <ul className={styles.menuRows}>
        {menus.map((menu) => (
          <li key={menu.menuId}>
            <label className={styles.menuChoice}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={selected.includes(menu.menuId)}
                disabled={disabled}
                onChange={() => onToggle(menu.menuId)}
              />
              <span className={styles.menuText}>
                <span className={styles.menuName}>{menu.fileName}</span>
                <span className={styles.menuFacts}>
                  {MENU_TYPE_LABELS[menu.menuType]}, {plural(menu.items, "item")}, read <When iso={menu.readAt} dateOnly />
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function TrackFigures({ track, passMark }: { readonly track: PlanTrack; readonly passMark: number }) {
  return (
    <div className={styles.track}>
      <div className={styles.trackTop}>
        <h3 className={styles.trackTitle}>{TRACK_LABELS[track.track]}</h3>
        <span className={styles.trackTime}>About {duration(track.studyMinutes)} per person</span>
      </div>
      <dl className={styles.trackList}>
        <div>
          <dt>Course cards</dt>
          <dd>{track.courseCards}</dd>
        </div>
        <div>
          <dt>Flashcards</dt>
          <dd>{track.flashcards}</dd>
        </div>
        <div>
          <dt>Role play scenarios</dt>
          <dd>{track.rolePlay}</dd>
        </div>
        <div>
          <dt>Quizzes</dt>
          <dd>
            {track.quizzes} <span className={styles.detail}>({plural(track.quizQuestions, "question")})</span>
          </dd>
        </div>
        <div>
          <dt>Exam questions</dt>
          <dd>
            {track.examQuestions} <span className={styles.detail}>(pass mark {passMark} percent)</span>
          </dd>
        </div>
        <div>
          <dt>Pre-shift notes</dt>
          <dd>{track.preShiftNotes}</dd>
        </div>
      </dl>
    </div>
  );
}

/* The screen */

type Action = "create" | "save" | "approve";
type Mode = "view" | "adjust" | "choose";

export function PlanView({ groupSlug, outletSlug, place, uploadPath, menus, defaultMenuIds, initialPlan }: PlanViewProps) {
  const fieldId = useId();
  const [plan, setPlan] = useState<Plan | null>(initialPlan);
  const [edits, setEdits] = useState<Edits | null>(initialPlan === null ? null : editsFrom(initialPlan));
  const [mode, setMode] = useState<Mode>(initialPlan === null ? "choose" : "view");
  const [selected, setSelected] = useState<readonly string[]>(
    initialPlan === null ? defaultMenuIds : includedIds(initialPlan),
  );
  const [busy, setBusy] = useState<Action | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const isDraft = plan !== null && plan.status === "draft";
  const isDirty = isDraft && edits !== null && !isUnchanged(plan, edits);

  // Leaving the page would lose unsaved changes, or a plan being written.
  useEffect(() => {
    if (!isDirty && busy === null) {
      return;
    }
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty, busy]);

  function fail(text: string, options: { locked?: boolean; stale?: boolean } = {}) {
    setNotice({ kind: "error", text, locked: options.locked ?? false, stale: options.stale ?? false });
  }

  /** Runs one press of a button. The buttons stay off until it finishes, whatever happens. */
  async function run(action: Action, work: () => Promise<void>) {
    if (busy !== null) {
      return;
    }
    setBusy(action);
    setNotice(null);
    try {
      await work();
    } finally {
      setBusy(null);
    }
  }

  /** Sends one action to the route. Returns the saved plan, or null after showing what went wrong. */
  async function send(action: Action, body: Record<string, unknown>): Promise<Plan | null> {
    let response: Response;
    try {
      response = await fetch(PLAN_API_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, groupSlug, outletSlug, ...body }),
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch {
      fail("Could not reach the server. Check the connection and try again.");
      return null;
    }

    let reply: unknown = null;
    try {
      reply = await response.json();
    } catch {
      // A reply that is not JSON is handled by its status below.
    }

    if (response.status === 401) {
      fail("This device is locked. Unlock it, then come back to this tab and try again. Nothing was lost.", {
        locked: true,
      });
      return null;
    }
    if (!response.ok) {
      const error = ErrorReplySchema.safeParse(reply);
      fail(shorten(error.success ? error.data.error : `Saving failed (error ${response.status}). Try again.`), {
        stale: response.status === 409,
      });
      return null;
    }
    const saved = PlanReplySchema.safeParse(reply);
    if (!saved.success || saved.data.plan.groupSlug !== groupSlug || saved.data.plan.outletSlug !== outletSlug) {
      fail("The plan was saved, but the reply could not be checked. Reload the page to see it.", { stale: true });
      return null;
    }
    return saved.data.plan;
  }

  function show(saved: Plan, text: string) {
    setPlan(saved);
    setEdits(editsFrom(saved));
    setSelected(includedIds(saved));
    setMode("view");
    setNotice({ kind: "done", text });
  }

  /** Saves the edits as a new draft version, when there are any. Returns the latest plan. */
  async function saveEdits(current: Plan, currentEdits: Edits): Promise<Plan | null> {
    if (isUnchanged(current, currentEdits)) {
      return current;
    }
    const passMark = passMarkValue(currentEdits.passMark);
    if (passMark === null) {
      fail(`Set the pass mark to a whole number from ${MIN_PASS_THRESHOLD} to ${MAX_PASS_THRESHOLD}.`);
      return null;
    }
    return send("save", { version: current.version, changes: changesFrom(current, currentEdits, passMark) });
  }

  function makePlan() {
    if (selected.length === 0 || selected.length > MAX_PLAN_MENUS) {
      return;
    }
    void run("create", async () => {
      // Unsaved answers and pass mark are saved first, so they carry over.
      // The synopsis is not: the new plan gets a new one.
      let base = plan;
      if (base !== null && base.status === "draft" && edits !== null) {
        const saved = await saveEdits(base, { ...edits, synopsis: base.synopsis });
        if (saved === null) {
          return;
        }
        if (saved !== base) {
          // Kept on screen, so a retry starts from the version just saved.
          setPlan(saved);
          setEdits(editsFrom(saved));
        }
        base = saved;
      }
      const created = await send("create", { version: base?.version ?? null, menuIds: selected });
      if (created !== null) {
        show(created, `Plan written and saved as version ${created.version}.`);
      }
    });
  }

  function saveChanges() {
    if (plan === null || edits === null) {
      return;
    }
    if (!sameIds(selected, includedIds(plan))) {
      makePlan();
      return;
    }
    void run("save", async () => {
      const saved = await saveEdits(plan, edits);
      if (saved !== null) {
        show(saved, saved === plan ? "Nothing changed, so nothing was saved." : `Saved as version ${saved.version}.`);
      }
    });
  }

  function approve() {
    if (plan === null || edits === null) {
      return;
    }
    const passMark = passMarkValue(edits.passMark);
    if (passMark === null || waitingCount(plan, edits) > 0) {
      return;
    }
    void run("approve", async () => {
      const approved = await send("approve", { version: plan.version, changes: changesFrom(plan, edits, passMark) });
      if (approved !== null) {
        show(approved, `Plan approved and locked as version ${approved.version}. The program is built from this plan.`);
      }
    });
  }

  function cancel() {
    if (plan === null) {
      return;
    }
    setEdits(editsFrom(plan));
    setSelected(includedIds(plan));
    setMode("view");
    setNotice(null);
  }

  function toggleMenu(menuId: string) {
    setSelected((current) =>
      current.includes(menuId) ? current.filter((id) => id !== menuId) : [...current, menuId],
    );
  }

  function updateTerm(term: PlanHouseTerm, change: Partial<TermEdit>) {
    setEdits((current) =>
      current === null
        ? current
        : { ...current, terms: { ...current.terms, [term.termKey]: { ...termEdit(current, term), ...change } } },
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  const isBusy = busy !== null;
  const tooManyMenus = selected.length > MAX_PLAN_MENUS;
  const menuMessage =
    selected.length === 0
      ? "Choose at least one menu."
      : tooManyMenus
        ? `Choose at most ${MAX_PLAN_MENUS} menus; ${selected.length} are chosen.`
        : null;

  /* No plan yet, or starting a new one from an approved plan */

  if (plan === null || edits === null || mode === "choose") {
    const isNew = plan === null;
    return (
      <section className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>{isNew ? "Make the plan" : "Start a new plan"}</h1>
          <p className={styles.place}>{place}</p>
          <p className={styles.lead}>
            {isNew
              ? "Choose the menus this program is built from. The plan shows exactly what gets built, and nothing is built until it is approved."
              : `Version ${plan.version} stays on record. The new plan starts as a draft and keeps its answers and pass mark.`}
          </p>

          <form className={styles.sections} onSubmit={handleSubmit}>
            <MenuList
              menus={menus}
              selected={selected}
              disabled={isBusy}
              onToggle={toggleMenu}
              legend="Menus"
            />
            {menuMessage !== null && <p className={styles.fieldMessage}>{menuMessage}</p>}

            {busy !== null && <Working action={busy} />}
            {notice !== null && <NoticeLine notice={notice} />}

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={isBusy || menuMessage !== null}
                onClick={makePlan}
              >
                {isNew ? "Make the plan" : "Make the new plan"}
              </button>
              {isNew ? (
                <Link href={uploadPath} className={styles.textLink}>
                  Upload more menus
                </Link>
              ) : (
                <button type="button" className={styles.textButton} disabled={isBusy} onClick={cancel}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>
      </section>
    );
  }

  /* The plan */

  const isAdjusting = mode === "adjust" && isDraft;
  const passMark = passMarkValue(edits.passMark);
  const shownPassMark = passMark ?? plan.examPassThreshold;
  const waiting = waitingCount(plan, edits);
  const synopsisLength = edits.synopsis.trim().length;
  const menusChanged = !sameIds(selected, includedIds(plan));
  const builtFrom = plan.menus.filter((menu) => menu.included);
  const statusId = `${fieldId}-status`;
  const synopsisId = `${fieldId}-synopsis`;
  const passMarkId = `${fieldId}-pass`;
  const approveReasonId = `${fieldId}-approve-reason`;

  const approveReason =
    waiting > 0
      ? `Answer or leave out ${plural(waiting, "house term")} to approve.`
      : passMark === null
        ? `Set the pass mark to a whole number from ${MIN_PASS_THRESHOLD} to ${MAX_PASS_THRESHOLD} to approve.`
        : synopsisLength === 0
          ? "Write a synopsis to approve."
          : null;

  return (
    <section className={styles.page}>
      <div className={styles.card}>
        <div className={styles.top}>
          <div>
            <h1 className={styles.title}>Plan</h1>
            <p className={styles.place}>{place}</p>
          </div>
          <span
            id={statusId}
            className={`${styles.chip} ${plan.status === "approved" ? styles.chipApproved : styles.chipDraft}`}
          >
            {plan.status === "approved" ? "Approved" : "Draft"}, version {plan.version}
          </span>
        </div>
        <p className={styles.stamp}>
          {plan.approvedAt !== null ? (
            <>
              Approved <When iso={plan.approvedAt} />. Locked: start a new plan to change it.
            </>
          ) : (
            <>
              Saved <When iso={plan.savedAt} />
            </>
          )}
        </p>

        <dl className={styles.numbers}>
          <div className={styles.number}>
            <dt>Menu items</dt>
            <dd>{plan.totals.items}</dd>
          </div>
          <div className={styles.number}>
            <dt>Key terms</dt>
            <dd>{plan.totals.terms}</dd>
          </div>
          <div className={styles.number}>
            <dt>House terms to confirm</dt>
            <dd>{plan.totals.houseTerms}</dd>
          </div>
          <div className={styles.number}>
            <dt>Study time per person</dt>
            <dd>{duration(plan.totals.studyMinutes)}</dd>
          </div>
        </dl>

        <form className={styles.sections} onSubmit={handleSubmit}>
          <section className={styles.section} aria-labelledby={`${synopsisId}-title`}>
            <h2 id={`${synopsisId}-title`} className={styles.sectionTitle}>
              Synopsis
            </h2>
            {isAdjusting ? (
              <>
                <textarea
                  id={synopsisId}
                  aria-labelledby={`${synopsisId}-title`}
                  className={styles.textarea}
                  rows={5}
                  maxLength={MAX_SYNOPSIS_LENGTH}
                  value={edits.synopsis}
                  disabled={isBusy || menusChanged}
                  aria-describedby={`${synopsisId}-count`}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                    const synopsis = event.currentTarget.value;
                    setEdits((current) => (current === null ? current : { ...current, synopsis }));
                  }}
                />
                <p id={`${synopsisId}-count`} className={styles.counter}>
                  {menusChanged
                    ? "The menus changed, so a new synopsis will be written."
                    : `${synopsisLength} of ${MAX_SYNOPSIS_LENGTH} characters. Three sentences, no dashes, and no allergen or diet claims.`}
                </p>
              </>
            ) : (
              <p className={styles.synopsis}>{plan.synopsis}</p>
            )}
          </section>

          <section className={styles.section} aria-labelledby={`${fieldId}-terms`}>
            <h2 id={`${fieldId}-terms`} className={styles.sectionTitle}>
              Confirm before we build
            </h2>
            {plan.houseTerms.length === 0 ? (
              <p className={styles.sectionLead}>The menus use no house terms that need confirming.</p>
            ) : (
              <>
                <p className={styles.sectionLead}>
                  {isDraft
                    ? "These words are the house's own. Answer each in the kitchen's or the bar's words, or leave it out of the program."
                    : "The house's own words, as confirmed for this plan."}
                </p>
                <ul className={styles.terms}>
                  {plan.houseTerms.map((term, index) => {
                    const edit = termEdit(edits, term);
                    const answerId = `${fieldId}-answer-${index}`;
                    const state = edit.leftOut ? "left_out" : edit.answer.trim() !== "" ? "answered" : "pending";
                    return (
                      <li key={term.termKey} className={styles.term}>
                        <div className={styles.termTop}>
                          <span className={styles.termText}>{term.text}</span>
                          <span
                            className={`${styles.termStatus} ${
                              state === "pending" ? styles.termWaiting : state === "answered" ? styles.termAnswered : ""
                            }`}
                          >
                            {state === "pending" ? "Waiting" : state === "answered" ? "Answered" : "Left out"}
                          </span>
                        </div>
                        <p className={styles.question}>{term.question}</p>
                        {isDraft ? (
                          <>
                            <label htmlFor={answerId} className={styles.answerLabel}>
                              Answer for {term.text}
                            </label>
                            <textarea
                              id={answerId}
                              className={styles.textarea}
                              rows={2}
                              maxLength={MAX_ANSWER_LENGTH}
                              value={edit.leftOut ? "" : edit.answer}
                              disabled={isBusy || edit.leftOut}
                              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                                updateTerm(term, { answer: event.currentTarget.value })
                              }
                            />
                            <label className={styles.check}>
                              <input
                                type="checkbox"
                                className={styles.checkbox}
                                checked={edit.leftOut}
                                disabled={isBusy}
                                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                  updateTerm(term, { leftOut: event.currentTarget.checked })
                                }
                              />
                              <span>Leave out of the program</span>
                            </label>
                          </>
                        ) : (
                          <p className={styles.answer}>
                            {term.status === "left_out" ? "Left out of the program." : term.answer}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {isDraft && !isAdjusting && (
                  <div className={styles.saveRow}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={isBusy || !isDirty}
                      onClick={saveChanges}
                    >
                      Save answers
                    </button>
                    {isDirty && <span className={styles.unsaved}>Unsaved changes</span>}
                  </div>
                )}
              </>
            )}
          </section>

          <section className={styles.section} aria-labelledby={`${fieldId}-built`}>
            <h2 id={`${fieldId}-built`} className={styles.sectionTitle}>
              What gets built
            </h2>
            <div className={styles.tracks}>
              {plan.tracks.map((track) => (
                <TrackFigures key={track.track} track={track} passMark={shownPassMark} />
              ))}
            </div>
            {isAdjusting && (
              <div className={styles.passMark}>
                <label htmlFor={passMarkId} className={styles.answerLabel}>
                  Exam pass mark, in percent
                </label>
                <input
                  id={passMarkId}
                  className={styles.passInput}
                  type="number"
                  inputMode="numeric"
                  min={MIN_PASS_THRESHOLD}
                  max={MAX_PASS_THRESHOLD}
                  step={1}
                  value={edits.passMark}
                  disabled={isBusy}
                  aria-describedby={`${passMarkId}-hint`}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const value = event.currentTarget.value;
                    setEdits((current) => (current === null ? current : { ...current, passMark: value }));
                  }}
                />
                <p id={`${passMarkId}-hint`} className={styles.counter}>
                  {passMark === null
                    ? `Use a whole number from ${MIN_PASS_THRESHOLD} to ${MAX_PASS_THRESHOLD}.`
                    : "Staff pass the exam at this mark or higher."}
                </p>
              </div>
            )}
          </section>

          {isAdjusting ? (
            <>
              <MenuList
                menus={menus}
                selected={selected}
                disabled={isBusy}
                onToggle={toggleMenu}
                legend="Built from"
              />
              {menuMessage !== null && <p className={styles.fieldMessage}>{menuMessage}</p>}
            </>
          ) : (
            <section className={styles.section} aria-labelledby={`${fieldId}-from`}>
              <h2 id={`${fieldId}-from`} className={styles.sectionTitle}>
                Built from
              </h2>
              <ul className={styles.menuRows}>
                {builtFrom.map((menu) => (
                  <li key={menu.menuId} className={styles.menuRow}>
                    <span className={styles.menuName}>{menu.fileName}</span>
                    <span className={styles.menuFacts}>
                      {MENU_TYPE_LABELS[menu.menuType]}, {plural(menu.items, "item")}, read{" "}
                      <When iso={menu.readAt} dateOnly />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {busy !== null && <Working action={busy} />}
          {notice !== null && <NoticeLine notice={notice} />}

          {isAdjusting ? (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={isBusy || menuMessage !== null || passMark === null}
                onClick={saveChanges}
              >
                {menusChanged ? "Write the new plan" : "Save changes"}
              </button>
              <button type="button" className={styles.textButton} disabled={isBusy} onClick={cancel}>
                Cancel
              </button>
            </div>
          ) : isDraft ? (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={isBusy}
                onClick={() => {
                  setNotice(null);
                  setMode("adjust");
                }}
              >
                Adjust plan
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={isBusy || approveReason !== null}
                aria-describedby={approveReason !== null ? approveReasonId : undefined}
                onClick={approve}
              >
                Approve plan
              </button>
              {approveReason !== null && (
                <p id={approveReasonId} className={styles.reason}>
                  {approveReason}
                </p>
              )}
            </div>
          ) : (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={isBusy}
                onClick={() => {
                  setNotice(null);
                  setSelected(includedIds(plan));
                  setMode("choose");
                }}
              >
                Start a new plan
              </button>
            </div>
          )}
        </form>
      </div>
    </section>
  );
}