/*
 * Location: menu-standards-app/scripts/read-menu.ts
 *
 * The reader's test command. Runs one menu from the private folder through
 * the real reader, on this computer, and reports what came back. Nothing is
 * saved to storage and nothing touches the live site.
 *
 * Run from the top level of menu-standards-app:
 *
 *   pnpm exec tsx scripts/read-menu.ts private/<file> <menu type>
 *   pnpm exec tsx scripts/read-menu.ts private/<file> <menu type> --effort medium
 *   pnpm exec tsx scripts/read-menu.ts private/<file> <menu type> --model gpt-6-astra
 *   pnpm exec tsx scripts/read-menu.ts private/<file> <menu type> --compare
 *   pnpm exec tsx scripts/read-menu.ts private/<file> <menu type> --compare --effort medium
 *
 * Menu types: food, cocktail, by_the_glass, bar, wine_list, non_alcoholic,
 * specials, other. Thinking levels: low, medium, high, xhigh, max.
 *
 * Without --compare, one read runs with the reader's settings from
 * models.ts, changed by --model or --effort for that read only.
 *
 * --compare reads the same file twice at the same time, so both reads face
 * the same conditions, then lists where they disagree: items one found and
 * the other missed, allergens, raw or undercooked warnings, and prices.
 * The first read always uses the reader's settings from models.ts. The
 * second uses --model and --effort where given:
 * - --compare alone compares with GPT-6 Astra (the Milestone 1 comparison).
 * - --compare --effort medium compares the same model at medium thinking.
 *
 * --model and --effort change this command only. The live site always
 * reads with the settings in models.ts.
 *
 * Results are client data, so they are written only to private/results/,
 * which Git ignores. Each file name carries the model and thinking level.
 * The OpenAI key comes from .env.local (the local key). Every run costs
 * money, and the cost is printed at the end.
 *
 * When a read fails, the reason OpenAI or the network gave is printed
 * under the failure, with anything that looks like a key hidden, so a
 * failure can be diagnosed instead of guessed at.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { AiStepError } from "@/lib/ai/client";
import { isModelId, MODEL_IDS, type ModelId, type ReasoningEffort, STEP_SETTINGS } from "@/lib/ai/models";
import { type MenuFileType, newMenuId, readMenu, type ReadMenuResult } from "@/lib/engine/read";
import {
  allItems,
  itemCount,
  itemsWithConsumerAdvisory,
  type Menu,
  type MenuItem,
  type MenuType,
  MenuTypeSchema,
  pendingHouseTerms,
} from "@/lib/schemas/menu";
import { MAX_UPLOAD_BYTES } from "@/lib/storage/blob";

const COMPARISON_MODEL: ModelId = "gpt-6-astra";

/**
 * Every thinking level models.ts allows. Written as a record, so the type
 * check fails if this list and models.ts ever disagree.
 */
const EFFORT_LEVELS: Readonly<Record<ReasoningEffort, true>> = {
  low: true,
  medium: true,
  high: true,
  xhigh: true,
  max: true,
};

/** Test reads are never stored, so they use a fixed, obviously local outlet. */
const TEST_SLUG = "local-test";

const FILE_TYPES: Readonly<Record<string, MenuFileType>> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** How many names to print before summarizing the rest. */
const MAX_LISTED = 15;

/** How many layers of "caused by" to follow when explaining a failure. */
const MAX_CAUSE_DEPTH = 4;

/** The longest one printed reason may run, in characters. */
const MAX_REASON_LENGTH = 300;

const USAGE = [
  "Usage:",
  "  pnpm exec tsx scripts/read-menu.ts private/<file> <menu type> [--compare] [--model <model>] [--effort <level>]",
  "Menu types: food, cocktail, by_the_glass, bar, wine_list, non_alcoholic, specials, other",
  `Models: ${MODEL_IDS.join(", ")}`,
  `Thinking levels: ${Object.keys(EFFORT_LEVELS).join(", ")}`,
].join("\n");

class UsageError extends Error {}

function isReasoningEffort(value: string): value is ReasoningEffort {
  return Object.hasOwn(EFFORT_LEVELS, value);
}

/* Arguments */

type Options = {
  readonly filePath: string;
  readonly menuType: MenuType;
  readonly compare: boolean;
  readonly model: ModelId | undefined;
  readonly effort: ReasoningEffort | undefined;
};

/** The word after an option, such as "medium" after --effort. */
function optionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new UsageError(`Give a value after ${option}.`);
  }
  return value.toLowerCase();
}

function parseArguments(args: readonly string[]): Options {
  const positional: string[] = [];
  let compare = false;
  let model: ModelId | undefined;
  let effort: ReasoningEffort | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--compare") {
      compare = true;
    } else if (arg === "--model") {
      if (model !== undefined) {
        throw new UsageError("Give --model only once.");
      }
      const value = optionValue(args, index, arg);
      if (!isModelId(value)) {
        throw new UsageError(`Unknown model "${value}".`);
      }
      model = value;
      index += 1;
    } else if (arg === "--effort") {
      if (effort !== undefined) {
        throw new UsageError("Give --effort only once.");
      }
      const value = optionValue(args, index, arg);
      if (!isReasoningEffort(value)) {
        throw new UsageError(`Unknown thinking level "${value}".`);
      }
      effort = value;
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new UsageError(`Unknown option "${arg}".`);
    } else {
      positional.push(arg);
    }
  }

  const [filePath, typeText] = positional;
  if (filePath === undefined || typeText === undefined || positional.length > 2) {
    throw new UsageError("Give one file and one menu type.");
  }
  const menuType = MenuTypeSchema.safeParse(typeText.toLowerCase().replace(/-/g, "_"));
  if (!menuType.success) {
    throw new UsageError(`Unknown menu type "${typeText}".`);
  }
  return { filePath, menuType: menuType.data, compare, model, effort };
}

/* Read settings */

/** The model and thinking level for one read. */
type ReadSettings = {
  readonly model: ModelId;
  readonly effort: ReasoningEffort;
};

/** "gpt-6.1-sol at high thinking". */
function describe(settings: ReadSettings): string {
  return `${settings.model} at ${settings.effort} thinking`;
}

function sameSettings(first: ReadSettings, second: ReadSettings): boolean {
  return first.model === second.model && first.effort === second.effort;
}

/* The file */

type LoadedFile = {
  readonly fileName: string;
  readonly contentType: MenuFileType;
  readonly bytes: Uint8Array;
  readonly relativePath: string;
  readonly uploadedAt: string;
};

async function loadMenuFile(filePath: string): Promise<LoadedFile> {
  const privateFolder = path.resolve("private");
  const absolute = path.resolve(filePath);
  const relative = path.relative(privateFolder, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.split(path.sep)[0] === "results") {
    throw new UsageError("The menu file must be inside the private folder, outside private/results.");
  }

  const contentType = FILE_TYPES[path.extname(absolute).toLowerCase()];
  if (contentType === undefined) {
    throw new UsageError("Use a PDF, JPEG, PNG, or WebP file.");
  }

  const info = await stat(absolute);
  if (info.size === 0) {
    throw new UsageError("That file is empty.");
  }
  if (info.size > MAX_UPLOAD_BYTES) {
    throw new UsageError("That file is larger than 20 MB, the most an upload allows.");
  }

  return {
    fileName: path.basename(absolute),
    contentType,
    bytes: new Uint8Array(await readFile(absolute)),
    relativePath: path.relative(process.cwd(), absolute).split(path.sep).join("/"),
    uploadedAt: info.mtime.toISOString(),
  };
}

/* Reading */

type Run = {
  readonly settings: ReadSettings;
  readonly seconds: number;
  readonly result: ReadMenuResult;
  readonly savedTo: string;
};

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

async function runRead(file: LoadedFile, menuType: MenuType, settings: ReadSettings): Promise<Run> {
  const started = Date.now();
  const result = await readMenu({
    menuId: newMenuId(menuType),
    groupSlug: TEST_SLUG,
    outletSlug: TEST_SLUG,
    menuType,
    file: {
      fileName: file.fileName,
      contentType: file.contentType,
      bytes: file.bytes,
      blobPath: `local/${file.relativePath}`,
      uploadedAt: file.uploadedAt,
    },
    model: settings.model,
    effort: settings.effort,
  });
  const seconds = Math.round((Date.now() - started) / 1000);

  const folder = path.resolve("private", "results");
  await mkdir(folder, { recursive: true });
  const stem = path.parse(file.fileName).name.replace(/[^A-Za-z0-9-]+/g, "-");
  const savedTo = path.join(folder, `${stem}-${settings.model}-${settings.effort}-${stamp(new Date())}.json`);
  await writeFile(
    savedTo,
    JSON.stringify(
      {
        model: settings.model,
        effort: settings.effort,
        seconds,
        attempts: result.attempts,
        droppedTerms: result.droppedTerms,
        droppedQuestions: result.droppedQuestions,
        menu: result.menu,
      },
      null,
      2,
    ),
    "utf8",
  );
  return { settings, seconds, result, savedTo: path.relative(process.cwd(), savedTo) };
}

/* Reporting */

function costOf(menu: Menu): number {
  return menu.usage.reduce((total, entry) => total + entry.costUsd, 0);
}

/** "1 item", "3 items". */
function count(amount: number, word: string): string {
  return `${amount} ${word}${amount === 1 ? "" : "s"}`;
}

function money(amount: number): string {
  return `$${amount.toFixed(amount < 0.1 ? 4 : 2)}`;
}

function listNames(names: readonly string[]): string {
  if (names.length === 0) {
    return "none";
  }
  const shown = names.slice(0, MAX_LISTED).join("; ");
  return names.length > MAX_LISTED ? `${shown}; and ${names.length - MAX_LISTED} more` : shown;
}

function report(file: LoadedFile, menuType: MenuType, run: Run): void {
  const { menu } = run.result;
  const withAllergens = allItems(menu).filter((item) => item.allergens.length > 0);
  const lines = [
    "",
    `${file.fileName} (${menuType}), read by ${describe(run.settings)}`,
    `  ${count(run.seconds, "second")}, ${count(run.result.attempts, "attempt")}, ${money(costOf(menu))}`,
    `  Sections: ${menu.sections.length}   Items: ${itemCount(menu)}   Terms: ${menu.terms.length}`,
    `  Raw or undercooked warning on ${count(itemsWithConsumerAdvisory(menu).length, "item")}: ${listNames(itemsWithConsumerAdvisory(menu).map((item) => item.name))}`,
    `  Allergens printed on the menu (${count(withAllergens.length, "item")}):`,
    ...(withAllergens.length === 0
      ? ["    none"]
      : withAllergens.map(
          (item) =>
            `    ${item.name}: ${item.allergens.map((entry) => `${entry.allergen} ("${entry.note}")`).join(", ")}`,
        )),
    `  Questions for the manager (${pendingHouseTerms(menu).length}):`,
    ...(pendingHouseTerms(menu).length === 0
      ? ["    none"]
      : pendingHouseTerms(menu).map((entry) => `    ${entry.text}: ${entry.question}`)),
    `  Reader notes (${menu.readerNotes.length}):`,
    ...(menu.readerNotes.length === 0 ? ["    none"] : menu.readerNotes.map((note) => `    ${note}`)),
    `  Dropped as not printed on the menu: ${count(run.result.droppedTerms, "term")}, ${count(run.result.droppedQuestions, "question")}`,
    `  Saved: ${run.savedTo}`,
  ];
  console.log(lines.join("\n"));
}

function itemKey(item: MenuItem): string {
  return item.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function allergenList(item: MenuItem): string {
  const names = item.allergens.map((entry) => entry.allergen).sort();
  return names.length === 0 ? "none" : names.join(", ");
}

function reportDifferences(first: Run, second: Run): void {
  const firstItems = new Map(allItems(first.result.menu).map((item) => [itemKey(item), item]));
  const secondItems = new Map(allItems(second.result.menu).map((item) => [itemKey(item), item]));

  const onlyFirst = [...firstItems.keys()].filter((key) => !secondItems.has(key)).map((key) => firstItems.get(key)?.name ?? key);
  const onlySecond = [...secondItems.keys()].filter((key) => !firstItems.has(key)).map((key) => secondItems.get(key)?.name ?? key);

  const differences: string[] = [];
  for (const [key, item] of firstItems) {
    const other = secondItems.get(key);
    if (other === undefined) {
      continue;
    }
    if (allergenList(item) !== allergenList(other)) {
      differences.push(`    ${item.name}: allergens ${allergenList(item)} vs ${allergenList(other)}`);
    }
    if (item.consumerAdvisory !== other.consumerAdvisory) {
      differences.push(`    ${item.name}: raw or undercooked warning ${item.consumerAdvisory ? "yes" : "no"} vs ${other.consumerAdvisory ? "yes" : "no"}`);
    }
    if (item.price.printed !== other.price.printed) {
      differences.push(`    ${item.name}: price "${item.price.printed}" vs "${other.price.printed}"`);
    }
  }

  const lines = [
    "",
    `Comparison: ${describe(first.settings)} vs ${describe(second.settings)}`,
    `  Items: ${itemCount(first.result.menu)} vs ${itemCount(second.result.menu)}`,
    `  Found only by ${describe(first.settings)}: ${listNames(onlyFirst)}`,
    `  Found only by ${describe(second.settings)}: ${listNames(onlySecond)}`,
    `  Same item, different reading (${differences.length}):`,
    ...(differences.length === 0 ? ["    none"] : differences),
    `  Cost: ${money(costOf(first.result.menu))} vs ${money(costOf(second.result.menu))}`,
    `  Time: ${count(first.seconds, "second")} vs ${count(second.seconds, "second")}`,
  ];
  console.log(lines.join("\n"));
}

/* Explaining a failure */

/** One property of an error, read without trusting its shape. */
function readField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}

/** Hides anything shaped like an OpenAI key, and keeps the text to one short line. */
function cleanReason(text: string): string {
  const oneLine = text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[hidden]")
    .replace(/\s+/g, " ")
    .trim();
  return oneLine.length > MAX_REASON_LENGTH ? `${oneLine.slice(0, MAX_REASON_LENGTH)}...` : oneLine;
}

/**
 * One layer of a failure, such as "RateLimitError (status 429, code
 * rate_limit_exceeded, request ID req_123): Rate limit reached...". The
 * request ID lets OpenAI support find the exact request.
 */
function describeCause(cause: unknown): string {
  if (!(cause instanceof Error)) {
    return cleanReason(String(cause));
  }
  const label = cause.name !== "Error" ? cause.name : cause.constructor.name;
  const details: string[] = [];
  const status = readField(cause, "status");
  if (typeof status === "number") {
    details.push(`status ${status}`);
  }
  const code = readField(cause, "code");
  if ((typeof code === "string" && code.length > 0) || typeof code === "number") {
    details.push(`code ${code}`);
  }
  const requestId = readField(cause, "requestID") ?? readField(cause, "request_id");
  if (typeof requestId === "string" && requestId.length > 0) {
    details.push(`request ID ${requestId}`);
  }
  const heading = details.length > 0 ? `${label} (${details.join(", ")})` : label;
  return cleanReason(`${heading}: ${cause.message}`);
}

/** The chain of reasons beneath a failure, outermost first, each listed once. */
function failureReasons(error: unknown): string[] {
  const reasons: string[] = [];
  const seen = new Set<unknown>([error]);
  let current: unknown = error instanceof Error ? error.cause : undefined;
  while (reasons.length < MAX_CAUSE_DEPTH && current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    reasons.push(describeCause(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return reasons;
}

function reportFailure(settings: ReadSettings, error: unknown): void {
  const reasons = failureReasons(error).map((reason, index) => `  ${index === 0 ? "Reason" : "Caused by"}: ${reason}`);

  if (error instanceof AiStepError) {
    const cost = error.usage.reduce((total, entry) => total + entry.costUsd, 0);
    console.error(`\nRead by ${describe(settings)} failed (${error.kind}): ${error.message}`);
    reasons.forEach((line) => console.error(line));
    if (error.kind === "request_failed") {
      // No usage comes back for a request that fails in transit, so any
      // charge for it shows only on OpenAI's usage page (decision 53).
      console.error(`  Cost recorded: ${money(cost)}. Any charge for the failed request shows only on OpenAI's usage page.`);
    } else {
      console.error(`  Cost of the failed attempts: ${money(cost)}`);
    }
    return;
  }
  console.error(`\nRead by ${describe(settings)} failed: ${error instanceof Error ? error.message : String(error)}`);
  reasons.forEach((line) => console.error(line));
}

/* Main */

async function main(): Promise<void> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    throw new UsageError("Could not read .env.local. Run this from the top level of menu-standards-app.");
  }

  const options = parseArguments(process.argv.slice(2));
  const reader: ReadSettings = { model: STEP_SETTINGS.reader.model, effort: STEP_SETTINGS.reader.effort };

  if (!options.compare) {
    const settings: ReadSettings = {
      model: options.model ?? reader.model,
      effort: options.effort ?? reader.effort,
    };
    const file = await loadMenuFile(options.filePath);
    try {
      report(file, options.menuType, await runRead(file, options.menuType, settings));
    } catch (error) {
      reportFailure(settings, error);
      process.exitCode = 1;
    }
    return;
  }

  // With neither option, the second read is the Milestone 1 comparison model.
  const second: ReadSettings = {
    model: options.model ?? (options.effort === undefined ? COMPARISON_MODEL : reader.model),
    effort: options.effort ?? reader.effort,
  };
  if (sameSettings(reader, second)) {
    throw new UsageError(`Both reads would use ${describe(reader)}. Change --model or --effort.`);
  }

  const file = await loadMenuFile(options.filePath);
  console.log(`Reading ${file.fileName} with ${describe(reader)} and ${describe(second)} at the same time...`);
  const reads = [reader, second] as const;
  const outcomes = await Promise.allSettled(reads.map((settings) => runRead(file, options.menuType, settings)));
  const runs: Run[] = [];
  outcomes.forEach((outcome, index) => {
    const settings = reads[index] ?? reader;
    if (outcome.status === "fulfilled") {
      report(file, options.menuType, outcome.value);
      runs.push(outcome.value);
    } else {
      reportFailure(settings, outcome.reason);
      process.exitCode = 1;
    }
  });
  const [first, other] = runs;
  if (first !== undefined && other !== undefined) {
    reportDifferences(first, other);
  }
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    console.error(`${error.message}\n\n${USAGE}`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});