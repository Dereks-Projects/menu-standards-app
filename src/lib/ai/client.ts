/*
 * Location: menu-standards-app/src/lib/ai/client.ts
 *
 * The only file that talks to OpenAI (decision 13). Every AI step calls
 * askForJson, which:
 * 1. sends the step's instructions, the content, and the exact answer
 *    shape, with OpenAI's strict mode on, so the answer must fit the shape,
 * 2. turns response storage off (decisions 43 and 45),
 * 3. sends no tools, so the model can only answer (decision 10),
 * 4. checks the answer against the caller's full rules in code, and if it
 *    fails, asks once more with the reasons attached, then stops
 *    (decision 42),
 * 5. records the tokens and estimated cost of every attempt, including
 *    attempts that fail.
 *
 * Files travel inside the request. No storage link is ever sent, and
 * OpenAI's file storage is never used (decision 43).
 *
 * Uploaded content is untrusted. It is sent as data in the user's turn,
 * never mixed into the instructions, and nothing it says can change the
 * answer shape or hand the model a tool.
 *
 * Server only. Never import this from browser code: the key stays on the
 * server.
 */

import OpenAI from "openai";
import { toJSONSchema, type z } from "zod";

import type { AiStep, AiUsage } from "@/lib/schemas/common";

import { estimateCostUsd, type ModelId, type ReasoningEffort, STEP_SETTINGS } from "./models";

/** One attempt, plus one corrected attempt. */
const MAX_ATTEMPTS = 2;

/**
 * How long one request may take before it is abandoned. Reading the
 * Bourbon Steak dinner menu at Milestone 1 took more than 5 minutes on a
 * slow day, so the limit is 10. The read route allows 800 seconds in all.
 */
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * The OpenAI library would otherwise resend a failed or abandoned request
 * on its own. An abandoned request is still billed, and a resend doubles
 * the wait and the cost without anyone seeing it, so a failure is reported
 * plainly instead and the person decides whether to try again.
 */
const LIBRARY_RETRIES = 0;

/** OpenAI accepts up to 50 MB of files per request; stay safely under. */
const MAX_REQUEST_FILE_BYTES = 45 * 1024 * 1024;

/** How many problems are reported back to the model on a retry. */
const MAX_REPORTED_PROBLEMS = 10;

/* Errors */

export type AiFailureKind = "not_configured" | "request_failed" | "refused" | "incomplete" | "invalid_answer";

/** A failed AI step. Carries the usage of every attempt, so cost is never lost. */
export class AiStepError extends Error {
  readonly kind: AiFailureKind;
  readonly usage: readonly AiUsage[];

  constructor(kind: AiFailureKind, message: string, usage: readonly AiUsage[] = [], options?: ErrorOptions) {
    super(message, options);
    this.name = "AiStepError";
    this.kind = kind;
    this.usage = usage;
  }
}

/* Answer shapes */

/**
 * JSON Schema keywords OpenAI's strict mode accepts, and that answer shapes
 * in this app are allowed to use. Length, size, and pattern limits are
 * never sent: they are enforced in code after the answer arrives.
 */
const ALLOWED_KEYWORDS: ReadonlySet<string> = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "anyOf",
  "description",
  "$defs",
  "$ref",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks a JSON Schema against strict mode's rules and completes it:
 * every object gets additionalProperties set to false, and every field must
 * already be required. Throws, naming the problem, when the shape uses
 * anything strict mode would refuse, so a bad shape fails here, clearly,
 * before any request is paid for.
 */
export function toStrictJsonSchema(schema: unknown, at = "answer"): Record<string, unknown> {
  if (!isPlainObject(schema)) {
    throw new Error(`Answer shape at ${at} is not an object.`);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$schema") {
      continue;
    }
    if (!ALLOWED_KEYWORDS.has(key)) {
      throw new Error(`Answer shape at ${at} uses "${key}", which strict mode does not accept.`);
    }
    result[key] = value;
  }

  const properties = result.properties;
  if (isPlainObject(properties)) {
    const names = Object.keys(properties);
    const required = Array.isArray(result.required) ? result.required : [];
    const optional = names.filter((name) => !required.includes(name));
    if (optional.length > 0) {
      throw new Error(`Answer shape at ${at} has optional fields (${optional.join(", ")}). Use nullable instead.`);
    }
    if (result.additionalProperties !== undefined && result.additionalProperties !== false) {
      throw new Error(`Answer shape at ${at} allows extra fields. Strict mode does not.`);
    }
    result.additionalProperties = false;
    result.required = names;
    result.properties = Object.fromEntries(
      names.map((name) => [name, toStrictJsonSchema(properties[name], `${at}.${name}`)]),
    );
  }

  if (result.items !== undefined) {
    result.items = toStrictJsonSchema(result.items, `${at}[]`);
  }
  if (Array.isArray(result.anyOf)) {
    result.anyOf = result.anyOf.map((option, index) => toStrictJsonSchema(option, `${at}(option ${index + 1})`));
  }
  if (isPlainObject(result.$defs)) {
    const defs = result.$defs;
    result.$defs = Object.fromEntries(
      Object.keys(defs).map((name) => [name, toStrictJsonSchema(defs[name], `${at}.$defs.${name}`)]),
    );
  }
  return result;
}

/* Content */

export type AiImageType = "image/jpeg" | "image/png" | "image/webp";

/** What a step sends the model besides its instructions. */
export type AiContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "pdf"; readonly fileName: string; readonly bytes: Uint8Array }
  | { readonly kind: "image"; readonly contentType: AiImageType; readonly bytes: Uint8Array };

type InputPart =
  | { type: "input_text"; text: string }
  | { type: "input_file"; filename: string; file_data: string }
  | { type: "input_image"; image_url: string; detail: "high" };

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

function toInputParts(content: readonly AiContent[], correction: string | null): InputPart[] {
  const parts: InputPart[] = content.map((item): InputPart => {
    switch (item.kind) {
      case "text":
        return { type: "input_text", text: item.text };
      case "pdf":
        return {
          type: "input_file",
          filename: item.fileName,
          file_data: `data:application/pdf;base64,${toBase64(item.bytes)}`,
        };
      case "image":
        return {
          type: "input_image",
          image_url: `data:${item.contentType};base64,${toBase64(item.bytes)}`,
          detail: "high",
        };
    }
  });
  // The correction goes last, so everything before it matches the first
  // attempt and OpenAI can bill that part at the cached rate.
  if (correction !== null) {
    parts.push({ type: "input_text", text: correction });
  }
  return parts;
}

function fileBytes(content: readonly AiContent[]): number {
  return content.reduce((total, item) => total + (item.kind === "text" ? 0 : item.bytes.byteLength), 0);
}

function correctionNote(problems: readonly string[]): string {
  const listed = problems.slice(0, MAX_REPORTED_PROBLEMS).map((problem) => `- ${problem}`);
  return [
    "Your previous answer was rejected by the application for these reasons:",
    ...listed,
    "Return a complete, corrected answer in the same shape, following every instruction.",
  ].join("\n");
}

/* The request */

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (openai !== null) {
    return openai;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new AiStepError("not_configured", "OPENAI_API_KEY is not set.");
  }
  openai = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: LIBRARY_RETRIES });
  return openai;
}

export type AnswerCheck<A, T> = (answer: A) => { ok: true; value: T } | { ok: false; problems: string[] };

export type AskForJsonOptions<S extends z.ZodType, T> = {
  readonly step: AiStep;
  /** The step's Markdown instructions (see prompts.ts). */
  readonly instructions: string;
  readonly content: readonly AiContent[];
  /** The shape sent to OpenAI: every field required, nullable instead of optional, no limits. */
  readonly answerShape: S;
  /** A short name for the shape, letters, numbers, and underscores. */
  readonly answerName: string;
  /** The full rules, applied in code to an answer that already fits the shape. */
  readonly check: AnswerCheck<z.output<S>, T>;
  /** Overrides, for comparing models at Milestone 1. Settings come from models.ts otherwise. */
  readonly model?: ModelId;
  readonly effort?: ReasoningEffort;
};

export type AskForJsonResult<T> = {
  readonly value: T;
  readonly model: ModelId;
  readonly attempts: number;
  readonly usage: readonly AiUsage[];
};

type Outcome<T> = { ok: true; value: T } | { ok: false; problems: string[] };

function readAnswer<S extends z.ZodType, T>(
  text: string,
  shape: S,
  check: AnswerCheck<z.output<S>, T>,
): Outcome<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["The answer was not valid JSON."] };
  }
  const parsed = shape.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => `${issue.path.map(String).join(".") || "answer"}: ${issue.message}`),
    };
  }
  return check(parsed.data);
}

/**
 * Asks the model for an answer in a fixed shape and returns it only after
 * it passes every check. Throws AiStepError otherwise.
 */
export async function askForJson<S extends z.ZodType, T>(options: AskForJsonOptions<S, T>): Promise<AskForJsonResult<T>> {
  const settings = STEP_SETTINGS[options.step];
  const model = options.model ?? settings.model;
  const effort = options.effort ?? settings.effort;

  if (!/^[A-Za-z0-9_]{1,64}$/.test(options.answerName)) {
    throw new Error("An answer name uses letters, numbers, and underscores only.");
  }
  if (fileBytes(options.content) > MAX_REQUEST_FILE_BYTES) {
    throw new AiStepError("request_failed", "The files are too large to send in one request.");
  }

  const schema = toStrictJsonSchema(toJSONSchema(options.answerShape));
  const client = getOpenAI();
  const usage: AiUsage[] = [];
  let problems: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const correction = attempt === 1 ? null : correctionNote(problems);

    let response;
    try {
      response = await client.responses.create({
        model,
        instructions: options.instructions,
        input: [{ role: "user", content: toInputParts(options.content, correction) }],
        text: { format: { type: "json_schema", name: options.answerName, schema, strict: true } },
        reasoning: { effort },
        max_output_tokens: settings.maxOutputTokens,
        store: false,
      });
    } catch (error) {
      throw new AiStepError("request_failed", `The ${options.step} request to OpenAI failed.`, usage, {
        cause: error,
      });
    }

    const inputTokens = response.usage?.input_tokens ?? 0;
    const cachedTokens = response.usage?.input_tokens_details?.cached_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    usage.push({
      step: options.step,
      model,
      inputTokens,
      outputTokens,
      costUsd: estimateCostUsd(model, { input: inputTokens, cachedInput: cachedTokens, output: outputTokens }),
    });

    for (const item of response.output) {
      if (item.type !== "message") {
        continue;
      }
      for (const part of item.content) {
        if (part.type === "refusal") {
          throw new AiStepError("refused", `The model declined the ${options.step} request: ${part.refusal}`, usage);
        }
      }
    }

    if (response.status !== "completed") {
      const reason = response.incomplete_details?.reason ?? response.status ?? "unknown";
      throw new AiStepError("incomplete", `The ${options.step} answer did not finish (${reason}).`, usage);
    }

    const outcome = readAnswer(response.output_text, options.answerShape, options.check);
    if (outcome.ok) {
      return { value: outcome.value, model, attempts: attempt, usage };
    }
    problems = outcome.problems.length > 0 ? outcome.problems : ["The answer failed its check."];
  }

  throw new AiStepError(
    "invalid_answer",
    `The ${options.step} answer failed its check twice. First problems: ${problems.slice(0, 3).join(" | ")}`,
    usage,
  );
}