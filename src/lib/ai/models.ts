/*
 * Location: menu-standards-app/src/lib/ai/models.ts
 *
 * Which model runs each AI step, how hard it thinks, and what it costs.
 * This is the only file where model names appear (decision 13). Changing a
 * model means changing one line here, then rerunning the Milestone 1 menus.
 *
 * Model names are pinned to exact versions, never a "latest" alias, so a
 * model can never change underneath a client's program (decision 41).
 *
 * Reasoning effort: GPT-6.1 Sol and GPT-6 Astra think before every answer
 * and accept low, medium, high, xhigh, or max. Neither accepts "none."
 *
 * Prices are OpenAI's published list prices in US dollars per million
 * tokens, as of September 29, 2026 (developers.openai.com/api/docs/pricing).
 * Reasoning is billed as output. Costs worked out from these prices are
 * estimates; OpenAI's usage page is the invoice. Update the prices here
 * whenever OpenAI changes them.
 */

import type { AiStep } from "@/lib/schemas/common";

export const MODEL_IDS = ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna", "gpt-6-sol"] as const;

export type ModelId = (typeof MODEL_IDS)[number];

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

type ModelPrice = {
  readonly input: number;
  readonly cachedInput: number;
  readonly output: number;
};

/** US dollars per million tokens. */
export const MODEL_PRICES: Readonly<Record<ModelId, ModelPrice>> = {
  "gpt-6.1-sol": { input: 2, cachedInput: 0.1, output: 10 },
  "gpt-6-astra": { input: 10, cachedInput: 1, output: 50 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  "gpt-6-sol": { input: 2, cachedInput: 0.2, output: 10 },
};

export type StepSettings = {
  readonly model: ModelId;
  readonly effort: ReasoningEffort;
  /** The most the model may write, thinking included. Caps the cost of one call. */
  readonly maxOutputTokens: number;
};

/**
 * One line per AI step (decision 41). GPT-6 Sol is the fallback for any
 * Sol step: change "gpt-6.1-sol" to "gpt-6-sol" to switch.
 */
export const STEP_SETTINGS: Readonly<Record<AiStep, StepSettings>> = {
  reader: { model: "gpt-6.1-sol", effort: "high", maxOutputTokens: 64_000 },
  planner: { model: "gpt-6.1-sol", effort: "medium", maxOutputTokens: 16_000 },
  builder: { model: "gpt-6.1-sol", effort: "medium", maxOutputTokens: 64_000 },
  checker: { model: "gpt-6-astra", effort: "high", maxOutputTokens: 32_000 },
  role_play: { model: "gpt-6-luna", effort: "medium", maxOutputTokens: 2_000 },
};

export function isModelId(value: string): value is ModelId {
  return (MODEL_IDS as readonly string[]).includes(value);
}

export type TokenCounts = {
  /** All input tokens, including the cached ones. */
  readonly input: number;
  readonly cachedInput: number;
  /** All output tokens, including reasoning. */
  readonly output: number;
};

/** Estimated cost of one request in US dollars, to six decimal places. */
export function estimateCostUsd(model: ModelId, tokens: TokenCounts): number {
  const price = MODEL_PRICES[model];
  const cached = Math.min(Math.max(0, tokens.cachedInput), Math.max(0, tokens.input));
  const uncached = Math.max(0, tokens.input) - cached;
  const dollars =
    (uncached * price.input + cached * price.cachedInput + Math.max(0, tokens.output) * price.output) /
    1_000_000;
  return Math.round(dollars * 1_000_000) / 1_000_000;
}