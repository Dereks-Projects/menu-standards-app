/*
 * Location: menu-standards-app/src/lib/ai/prompts.ts
 *
 * Loads the Markdown instructions for each AI step from
 * src/lib/ai/prompts/. Prompts live in Markdown, never as text inside
 * TypeScript, so they can be read and reviewed like any document.
 *
 * Only names on the list below can be loaded, so a prompt name can never
 * point outside that folder. HTML comments (<!-- like this -->) are removed
 * before a prompt is sent, so each file can carry its location note and
 * reviewer notes without the model seeing them. An empty prompt file stops
 * the step with an error instead of running it without instructions.
 *
 * On the live site, this folder must be bundled with every route that uses
 * it. That is set in next.config.ts (outputFileTracingIncludes), added with
 * the read route.
 *
 * Server only.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

export const PROMPT_NAMES = [
  "read-base",
  "read-food",
  "read-cocktail",
  "read-btg",
  "read-bar",
  "read-wine-list",
  "read-non-alcoholic",
  "read-specials",
  "read-other",
] as const;

export type PromptName = (typeof PROMPT_NAMES)[number];

const PROMPT_FOLDER = path.join(process.cwd(), "src", "lib", "ai", "prompts");

/** Prompts never change while the app runs, so each is read once. */
const loaded = new Map<PromptName, string>();

function isPromptName(value: string): value is PromptName {
  return (PROMPT_NAMES as readonly string[]).includes(value);
}

/** Removes HTML comments and extra blank lines, and normalizes line endings. */
export function cleanPrompt(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function loadPrompt(name: PromptName): Promise<string> {
  const cached = loaded.get(name);
  if (cached !== undefined) {
    return cached;
  }
  if (!isPromptName(name)) {
    throw new Error(`Unknown prompt: ${String(name)}.`);
  }
  const text = cleanPrompt(await readFile(path.join(PROMPT_FOLDER, `${name}.md`), "utf8"));
  if (text.length === 0) {
    throw new Error(`Prompt ${name}.md is empty.`);
  }
  loaded.set(name, text);
  return text;
}

/** Joins several prompts, in order, into one set of instructions. */
export async function composePrompt(names: readonly PromptName[]): Promise<string> {
  const parts = await Promise.all(names.map((name) => loadPrompt(name)));
  return parts.join("\n\n");
}