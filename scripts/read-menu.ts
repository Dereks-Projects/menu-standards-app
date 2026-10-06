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
 *   pnpm exec tsx scripts/read-menu.ts private/<file> <menu type> --compare
 *   pnpm exec tsx scripts/read-menu.ts private/<file> <menu type> --model gpt-6-astra
 *
 * Menu types: food, cocktail, by_the_glass, bar, wine_list, non_alcoholic,
 * specials, other.
 *
 * --compare reads the same file with the reader's model (see models.ts) and
 * with GPT-6 Astra at the same time, then lists where they disagree: items
 * one found and the other missed, allergens, raw or undercooked warnings,
 * and prices. This is the Milestone 1 comparison.
 *
 * Results are client data, so they are written only to private/results/,
 * which Git ignores. The OpenAI key comes from .env.local (the local key).
 * Every run costs money, and the cost is printed at the end.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { AiStepError } from "@/lib/ai/client";
import { isModelId, type ModelId, STEP_SETTINGS } from "@/lib/ai/models";
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

const USAGE = [
  "Usage:",
  "  pnpm exec tsx scripts/read-menu.ts private/<file> <menu type> [--compare | --model <model>]",
  "Menu types: food, cocktail, by_the_glass, bar, wine_list, non_alcoholic, specials, other",
].join("\n");

class UsageError extends Error {}

/* Arguments */

type Options = {
  readonly filePath: string;
  readonly menuType: MenuType;
  readonly compare: boolean;
  readonly model: ModelId | undefined;
};

function parseArguments(args: readonly string[]): Options {
  const positional: string[] = [];
  let compare = false;
  let model: ModelId | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--compare") {
      compare = true;
    } else if (arg === "--model") {
      const value = args[index + 1] ?? "";
      if (!isModelId(value)) {
        throw new UsageError(`Unknown model "${value}".`);
      }
      model = value;
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
  if (compare && model !== undefined) {
    throw new UsageError("Use --compare or --model, not both.");
  }
  return { filePath, menuType: menuType.data, compare, model };
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
  readonly model: ModelId;
  readonly seconds: number;
  readonly result: ReadMenuResult;
  readonly savedTo: string;
};

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

async function runRead(file: LoadedFile, menuType: MenuType, model: ModelId): Promise<Run> {
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
    model,
  });
  const seconds = Math.round((Date.now() - started) / 1000);

  const folder = path.resolve("private", "results");
  await mkdir(folder, { recursive: true });
  const stem = path.parse(file.fileName).name.replace(/[^A-Za-z0-9-]+/g, "-");
  const savedTo = path.join(folder, `${stem}-${model}-${stamp(new Date())}.json`);
  await writeFile(
    savedTo,
    JSON.stringify(
      {
        menu: result.menu,
        attempts: result.attempts,
        droppedTerms: result.droppedTerms,
        droppedQuestions: result.droppedQuestions,
        seconds,
      },
      null,
      2,
    ),
    "utf8",
  );
  return { model, seconds, result, savedTo: path.relative(process.cwd(), savedTo) };
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
    `${file.fileName} (${menuType}), read by ${run.model}`,
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
    `Comparison: ${first.model} vs ${second.model}`,
    `  Items: ${itemCount(first.result.menu)} vs ${itemCount(second.result.menu)}`,
    `  Found only by ${first.model}: ${listNames(onlyFirst)}`,
    `  Found only by ${second.model}: ${listNames(onlySecond)}`,
    `  Same item, different reading (${differences.length}):`,
    ...(differences.length === 0 ? ["    none"] : differences),
    `  Cost: ${money(costOf(first.result.menu))} vs ${money(costOf(second.result.menu))}`,
    `  Time: ${count(first.seconds, "second")} vs ${count(second.seconds, "second")}`,
  ];
  console.log(lines.join("\n"));
}

function reportFailure(model: ModelId, error: unknown): void {
  if (error instanceof AiStepError) {
    const cost = error.usage.reduce((total, entry) => total + entry.costUsd, 0);
    console.error(`\nRead by ${model} failed (${error.kind}): ${error.message}`);
    console.error(`  Cost of the failed attempts: ${money(cost)}`);
    return;
  }
  console.error(`\nRead by ${model} failed: ${error instanceof Error ? error.message : String(error)}`);
}

/* Main */

async function main(): Promise<void> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    throw new UsageError("Could not read .env.local. Run this from the top level of menu-standards-app.");
  }

  const options = parseArguments(process.argv.slice(2));
  const file = await loadMenuFile(options.filePath);
  const readerModel = STEP_SETTINGS.reader.model;

  if (!options.compare) {
    const model = options.model ?? readerModel;
    try {
      report(file, options.menuType, await runRead(file, options.menuType, model));
    } catch (error) {
      reportFailure(model, error);
      process.exitCode = 1;
    }
    return;
  }

  console.log(`Reading ${file.fileName} with ${readerModel} and ${COMPARISON_MODEL} at the same time...`);
  const models = [readerModel, COMPARISON_MODEL] as const;
  const outcomes = await Promise.allSettled(models.map((model) => runRead(file, options.menuType, model)));
  const runs: Run[] = [];
  outcomes.forEach((outcome, index) => {
    const model = models[index] ?? readerModel;
    if (outcome.status === "fulfilled") {
      report(file, options.menuType, outcome.value);
      runs.push(outcome.value);
    } else {
      reportFailure(model, outcome.reason);
      process.exitCode = 1;
    }
  });
  const [first, second] = runs;
  if (first !== undefined && second !== undefined) {
    reportDifferences(first, second);
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