import type { RuntimeEvent, TurnOutcome } from "./types.js";
import { isRecord, isString } from "./utils.js";

export const TURN_OUTCOME_TRAILER_LABEL = "turn_outcome:";

const TRAILER_PATTERN = /(?:^|\r?\n)turn_outcome:\s*\r?\n```json\s*\r?\n([\s\S]*?)\r?\n```\s*$/;
const ALLOWED_STATES = new Set(["progress", "blocked", "milestone_complete", "plan_complete", "needs_review"]);
const ALLOWED_RESULTS = new Set(["pass", "fail", "not_run"]);
const ROOT_KEYS = new Set(["state", "summary", "files_changed", "tests_run", "blocker", "next_action"]);
const TEST_KEYS = new Set(["command", "result", "summary"]);
const BLOCKER_KEYS = new Set(["message", "signature"]);

export const TURN_OUTCOME_TRAILER_FORMAT = [
  "turn_outcome:",
  "```json",
  "{",
  '  "state": "progress",',
  '  "summary": "Brief milestone-scoped outcome.",',
  '  "files_changed": [],',
  '  "tests_run": [],',
  '  "next_action": "Describe the next smallest step."',
  "}",
  "```"
].join("\n");

export interface TurnOutcomeValidationIssue {
  path: string;
  message: string;
}

export type TurnOutcomeTrailerParseResult =
  | {
    kind: "valid";
    source: "trailer" | "raw_json";
    outcome: TurnOutcome;
    rawJson: string;
  }
  | {
    kind: "missing";
    source: "trailer";
    errors: TurnOutcomeValidationIssue[];
  }
  | {
    kind: "invalid";
    source: "trailer" | "raw_json";
    rawJson?: string;
    errors: TurnOutcomeValidationIssue[];
  };

function describeType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  // eslint-disable-next-line no-restricted-syntax -- describeType returns the JS type name as a string; typeof is unavoidable here
  return typeof value;
}

interface UnexpectedKeysSchema {
  keys: Set<string>;
  path: string;
}

function pushUnexpectedKeys(
  issues: TurnOutcomeValidationIssue[],
  value: Record<string, unknown>,
  schema: UnexpectedKeysSchema,
): void {
  for (const key of Object.keys(value)) {
    if (!schema.keys.has(key)) {
      issues.push({ path: schema.path, message: `unexpected property "${key}"` });
    }
  }
}

function validateTestsRun(issues: TurnOutcomeValidationIssue[], testsArray: unknown[]): void {
  testsArray.forEach((test, index) => {
    const testPath = `$.tests_run[${index}]`;
    if (!isRecord(test)) {
      issues.push({ path: testPath, message: `expected object, received ${describeType(test)}` });
      return;
    }
    pushUnexpectedKeys(issues, test, { keys: TEST_KEYS, path: testPath });
    if (!isString(test.command)) {
      issues.push({ path: `${testPath}.command`, message: `expected string, received ${describeType(test.command)}` });
    }
    if (!isString(test.result)) {
      issues.push({ path: `${testPath}.result`, message: `expected string, received ${describeType(test.result)}` });
    } else if (!ALLOWED_RESULTS.has(test.result)) {
      issues.push({ path: `${testPath}.result`, message: `expected one of ${Array.from(ALLOWED_RESULTS).join(", ")}` });
    }
    if (test.summary !== undefined && !isString(test.summary)) {
      issues.push({ path: `${testPath}.summary`, message: `expected string, received ${describeType(test.summary)}` });
    }
  });
}

function validateBlocker(issues: TurnOutcomeValidationIssue[], blocker: unknown): void {
  if (blocker === undefined || blocker === null) return;
  if (!isRecord(blocker)) {
    issues.push({ path: "$.blocker", message: `expected object or null, received ${describeType(blocker)}` });
    return;
  }
  pushUnexpectedKeys(issues, blocker, { keys: BLOCKER_KEYS, path: "$.blocker" });
  if (!isString(blocker.message)) {
    issues.push({ path: "$.blocker.message", message: `expected string, received ${describeType(blocker.message)}` });
  }
  if (blocker.signature !== undefined && !isString(blocker.signature)) {
    issues.push({ path: "$.blocker.signature", message: `expected string, received ${describeType(blocker.signature)}` });
  }
}

function validateNextAction(issues: TurnOutcomeValidationIssue[], value: Record<string, unknown>): void {
  if (!isString(value.next_action)) {
    issues.push({ path: "$.next_action", message: `expected string, received ${describeType(value.next_action)}` });
  } else if (value.next_action.length === 0) {
    issues.push({ path: "$.next_action", message: "must not be empty" });
  }
}

export function validateTurnOutcome(value: unknown): TurnOutcomeValidationIssue[] {
  const issues: TurnOutcomeValidationIssue[] = [];
  if (!isRecord(value)) {
    return [{ path: "$", message: `expected object, received ${describeType(value)}` }];
  }

  pushUnexpectedKeys(issues, value, { keys: ROOT_KEYS, path: "$" });

  if (!isString(value.state)) {
    issues.push({ path: "$.state", message: `expected string, received ${describeType(value.state)}` });
  } else if (!ALLOWED_STATES.has(value.state)) {
    issues.push({ path: "$.state", message: `expected one of ${Array.from(ALLOWED_STATES).join(", ")}` });
  }

  if (!isString(value.summary)) {
    issues.push({ path: "$.summary", message: `expected string, received ${describeType(value.summary)}` });
  } else if (value.summary.length === 0) {
    issues.push({ path: "$.summary", message: "must not be empty" });
  }

  if (!Array.isArray(value.files_changed)) {
    issues.push({ path: "$.files_changed", message: `expected array, received ${describeType(value.files_changed)}` });
  } else {
    value.files_changed.forEach((entry, index) => {
      if (!isString(entry)) {
        issues.push({ path: `$.files_changed[${index}]`, message: `expected string, received ${describeType(entry)}` });
      }
    });
  }

  if (!Array.isArray(value.tests_run)) {
    issues.push({ path: "$.tests_run", message: `expected array, received ${describeType(value.tests_run)}` });
  } else {
    validateTestsRun(issues, value.tests_run);
  }

  validateBlocker(issues, value.blocker);
  validateNextAction(issues, value);

  return issues;
}

function parseOutcomeJson(rawJson: string, source: "trailer" | "raw_json"): TurnOutcomeTrailerParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    return {
      kind: "invalid",
      source,
      rawJson,
      errors: [{ path: "$", message: `invalid JSON: ${(error as Error).message}` }]
    };
  }

  const errors = validateTurnOutcome(parsed);
  if (errors.length > 0) {
    return {
      kind: "invalid",
      source,
      rawJson,
      errors
    };
  }

  return {
    kind: "valid",
    source,
    outcome: parsed as TurnOutcome,
    rawJson
  };
}

export function extractTurnOutcomeTrailer(text: string): TurnOutcomeTrailerParseResult {
  const match = text.match(TRAILER_PATTERN);
  if (!match) {
    return {
      kind: "missing",
      source: "trailer",
      errors: [{ path: "$", message: "missing final turn_outcome trailer" }]
    };
  }

  const rawJson = match[1]?.trim();
  if (!rawJson) {
    return {
      kind: "invalid",
      source: "trailer",
      errors: [{ path: "$", message: "turn_outcome trailer is empty" }]
    };
  }

  return parseOutcomeJson(rawJson, "trailer");
}

export function parseTurnOutcomeInput(text: string): TurnOutcomeTrailerParseResult {
  const trailerResult = extractTurnOutcomeTrailer(text);
  if (trailerResult.kind !== "missing") {
    return trailerResult;
  }

  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return trailerResult;
  }

  return parseOutcomeJson(trimmed, "raw_json");
}

export function buildTurnOutcomeIngestionEvent(params: {
  vendor: RuntimeEvent["vendor"];
  sessionId?: string;
  source: string;
  result: Exclude<TurnOutcomeTrailerParseResult, { kind: "valid" }>;
}): RuntimeEvent {
  return {
    vendor: params.vendor,
    type: params.result.kind === "missing"
      ? "turn_outcome.trailer_missing"
      : "turn_outcome.trailer_invalid",
    timestamp: new Date().toISOString(),
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    payload: {
      source: params.source,
      parser_source: params.result.source,
      errors: params.result.errors,
      ...(params.result.kind === "invalid" && params.result.rawJson
        ? { raw_json: params.result.rawJson }
        : {})
    }
  };
}
