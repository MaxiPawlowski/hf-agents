import { describe, expect, test } from "vitest";

import {
  validateTurnOutcome,
  extractTurnOutcomeTrailer,
  parseTurnOutcomeInput,
  buildTurnOutcomeIngestionEvent,
  TURN_OUTCOME_TRAILER_LABEL,
  type TurnOutcomeTrailerParseResult
} from "../src/runtime/turn-outcome-trailer.js";

function makeValidOutcome(): Record<string, unknown> {
  return {
    state: "progress",
    summary: "Implemented the feature.",
    files_changed: ["src/feature.ts"],
    tests_run: [{ command: "npm test", result: "pass", summary: "All passed" }],
    next_action: "Write integration tests."
  };
}

function buildTrailerBlock(json: string): string {
  return `Some assistant text.\n\nturn_outcome:\n\`\`\`json\n${json}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// validateTurnOutcome
// ---------------------------------------------------------------------------

describe("validateTurnOutcome", () => {
  test("returns no issues for a minimal valid outcome", () => {
    expect(validateTurnOutcome(makeValidOutcome())).toEqual([]);
  });

  test("returns no issues for valid outcome without optional fields", () => {
    const outcome = {
      state: "blocked",
      summary: "Stuck on auth.",
      files_changed: [],
      tests_run: [],
      blocker: { message: "Missing credentials" },
      next_action: "Ask user for API key."
    };
    expect(validateTurnOutcome(outcome)).toEqual([]);
  });

  test("rejects non-object inputs", () => {
    for (const value of [null, [1, 2], "string", 42, true]) {
      const issues = validateTurnOutcome(value);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.path).toBe("$");
      expect(issues[0]!.message).toContain("expected object");
    }
  });

  test("rejects unknown state value", () => {
    const outcome = { ...makeValidOutcome(), state: "bad" };
    const issues = validateTurnOutcome(outcome);
    expect(issues.some((i) => i.path === "$.state" && i.message.includes("expected one of"))).toBe(true);
  });

  test("rejects empty summary", () => {
    const outcome = { ...makeValidOutcome(), summary: "" };
    const issues = validateTurnOutcome(outcome);
    expect(issues.some((i) => i.path === "$.summary" && i.message.includes("must not be empty"))).toBe(true);
  });

  test("accepts whitespace-only summary without issue", () => {
    const outcome = { ...makeValidOutcome(), summary: "   " };
    expect(validateTurnOutcome(outcome)).toEqual([]);
  });

  test("rejects empty next_action", () => {
    const outcome = { ...makeValidOutcome(), next_action: "" };
    const issues = validateTurnOutcome(outcome);
    expect(issues.some((i) => i.path === "$.next_action" && i.message.includes("must not be empty"))).toBe(true);
  });

  test("rejects non-string entry in files_changed", () => {
    const outcome = { ...makeValidOutcome(), files_changed: [123] };
    const issues = validateTurnOutcome(outcome);
    expect(issues.some((i) => i.path === "$.files_changed[0]" && i.message.includes("expected string"))).toBe(true);
  });

  test("rejects non-object entry in tests_run", () => {
    const outcome = { ...makeValidOutcome(), tests_run: ["string"] };
    const issues = validateTurnOutcome(outcome);
    expect(issues.some((i) => i.path === "$.tests_run[0]" && i.message.includes("expected object"))).toBe(true);
  });

  test("rejects unknown test result value", () => {
    const outcome = {
      ...makeValidOutcome(),
      tests_run: [{ command: "npm test", result: "maybe" }]
    };
    const issues = validateTurnOutcome(outcome);
    expect(issues.some((i) => i.path === "$.tests_run[0].result" && i.message.includes("expected one of"))).toBe(true);
  });

  test("validates blocker with message only", () => {
    const outcome = { ...makeValidOutcome(), state: "blocked", blocker: { message: "stuck" } };
    const issues = validateTurnOutcome(outcome);
    expect(issues.filter((i) => i.path.startsWith("$.blocker"))).toEqual([]);
  });

  test("validates blocker with optional signature", () => {
    const outcome = {
      ...makeValidOutcome(),
      state: "blocked",
      blocker: { message: "stuck", signature: "auth-missing" }
    };
    expect(validateTurnOutcome(outcome)).toEqual([]);
  });

  test("rejects blocker with non-string signature", () => {
    const outcome = {
      ...makeValidOutcome(),
      blocker: { message: "stuck", signature: 42 }
    };
    const issues = validateTurnOutcome(outcome);
    expect(issues.some((i) => i.path === "$.blocker.signature" && i.message.includes("expected string"))).toBe(true);
  });

  test("rejects unexpected root-level keys", () => {
    const outcome = { ...makeValidOutcome(), extra: true };
    const issues = validateTurnOutcome(outcome);
    expect(issues.some((i) => i.path === "$" && i.message.includes("unexpected property"))).toBe(true);
  });

  test("accepts null blocker without issue", () => {
    const outcome = { ...makeValidOutcome(), blocker: null };
    const issues = validateTurnOutcome(outcome);
    expect(issues.filter((i) => i.path.startsWith("$.blocker"))).toEqual([]);
  });

  test("collects multiple issues in a single pass", () => {
    const issues = validateTurnOutcome({});
    expect(issues.length).toBeGreaterThanOrEqual(5);
    const paths = new Set(issues.map((i) => i.path));
    expect(paths.has("$.state")).toBe(true);
    expect(paths.has("$.summary")).toBe(true);
    expect(paths.has("$.files_changed")).toBe(true);
    expect(paths.has("$.tests_run")).toBe(true);
    expect(paths.has("$.next_action")).toBe(true);
  });

  test("rejects unexpected keys inside tests_run entries", () => {
    const outcome = {
      ...makeValidOutcome(),
      tests_run: [{ command: "npm test", result: "pass", extra: true }]
    };
    const issues = validateTurnOutcome(outcome);
    expect(issues.some((i) => i.path === "$.tests_run[0]" && i.message.includes("unexpected property"))).toBe(true);
  });

  test("rejects unexpected keys inside blocker", () => {
    const outcome = {
      ...makeValidOutcome(),
      blocker: { message: "stuck", extra: true }
    };
    const issues = validateTurnOutcome(outcome);
    expect(issues.some((i) => i.path === "$.blocker" && i.message.includes("unexpected property"))).toBe(true);
  });

  test("validates each allowed state value", () => {
    for (const state of ["progress", "blocked", "milestone_complete", "plan_complete", "needs_review"]) {
      const outcome = { ...makeValidOutcome(), state };
      const issues = validateTurnOutcome(outcome);
      expect(issues.filter((i) => i.path === "$.state")).toEqual([]);
    }
  });

  test("validates each allowed test result value", () => {
    for (const result of ["pass", "fail", "not_run"]) {
      const outcome = {
        ...makeValidOutcome(),
        tests_run: [{ command: "npm test", result }]
      };
      const issues = validateTurnOutcome(outcome);
      expect(issues.filter((i) => i.path.includes("result"))).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// extractTurnOutcomeTrailer
// ---------------------------------------------------------------------------

describe("extractTurnOutcomeTrailer", () => {
  test("returns missing when no trailer exists", () => {
    const result = extractTurnOutcomeTrailer("Just some plain text.");
    expect(result.kind).toBe("missing");
    expect(result.source).toBe("trailer");
  });

  test("returns invalid for empty trailer JSON block", () => {
    const text = "Some text.\n\nturn_outcome:\n```json\n\n```";
    const result = extractTurnOutcomeTrailer(text);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.errors[0]!.message).toContain("empty");
    }
  });

  test("returns invalid for malformed JSON in trailer", () => {
    const text = buildTrailerBlock("{not json}");
    const result = extractTurnOutcomeTrailer(text);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.errors[0]!.message).toContain("invalid JSON");
    }
  });

  test("matches the trailing trailer block anchored to end of string", () => {
    // The regex anchors to the end ($), so when two trailers exist, the pattern
    // captures from the first turn_outcome: through to the final closing ```.
    // This means having two trailers will produce invalid JSON (they bleed together).
    // The correct behavior is: only one trailer should appear per turn.
    const outcome = makeValidOutcome();
    const singleTrailer = buildTrailerBlock(JSON.stringify(outcome));
    const result = extractTurnOutcomeTrailer(singleTrailer);
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.outcome.state).toBe("progress");
    }

    // Two trailers concatenated → the regex matches a blob that isn't valid JSON
    const doubled = singleTrailer + `\n\nturn_outcome:\n\`\`\`json\n${JSON.stringify(outcome)}\n\`\`\``;
    const doubledResult = extractTurnOutcomeTrailer(doubled);
    expect(doubledResult.kind).toBe("invalid");
  });

  test("parses a complete valid trailer", () => {
    const outcome = makeValidOutcome();
    const text = buildTrailerBlock(JSON.stringify(outcome));
    const result = extractTurnOutcomeTrailer(text);
    expect(result.kind).toBe("valid");
    expect(result.source).toBe("trailer");
    if (result.kind === "valid") {
      expect(result.outcome.state).toBe("progress");
      expect(result.outcome.summary).toBe("Implemented the feature.");
      expect(result.rawJson).toBe(JSON.stringify(outcome));
    }
  });

  test("returns invalid when trailer has valid JSON but fails validation", () => {
    const text = buildTrailerBlock(JSON.stringify({ state: "bad" }));
    const result = extractTurnOutcomeTrailer(text);
    expect(result.kind).toBe("invalid");
    expect(result.source).toBe("trailer");
    if (result.kind !== "valid") {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// parseTurnOutcomeInput
// ---------------------------------------------------------------------------

describe("parseTurnOutcomeInput", () => {
  test("falls back to raw JSON when text starts with {", () => {
    const outcome = makeValidOutcome();
    const result = parseTurnOutcomeInput(JSON.stringify(outcome));
    expect(result.kind).toBe("valid");
    expect(result.source).toBe("raw_json");
  });

  test("returns missing when no trailer and text does not start with {", () => {
    const result = parseTurnOutcomeInput("Just some plain text response.");
    expect(result.kind).toBe("missing");
  });

  test("prefers trailer over raw JSON fallback", () => {
    const outcome = makeValidOutcome();
    const text = buildTrailerBlock(JSON.stringify(outcome));
    const result = parseTurnOutcomeInput(text);
    expect(result.kind).toBe("valid");
    expect(result.source).toBe("trailer");
  });

  test("reports validation errors from raw JSON path", () => {
    const result = parseTurnOutcomeInput('{"state":"bad"}');
    expect(result.kind).toBe("invalid");
    expect(result.source).toBe("raw_json");
    if (result.kind !== "valid") {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  test("returns missing for whitespace-only input", () => {
    const result = parseTurnOutcomeInput("   \n  ");
    expect(result.kind).toBe("missing");
  });
});

// ---------------------------------------------------------------------------
// buildTurnOutcomeIngestionEvent
// ---------------------------------------------------------------------------

describe("buildTurnOutcomeIngestionEvent", () => {
  test("creates trailer_missing event for missing results", () => {
    const missingResult: TurnOutcomeTrailerParseResult = {
      kind: "missing",
      source: "trailer",
      errors: [{ path: "$", message: "missing final turn_outcome trailer" }]
    };
    const event = buildTurnOutcomeIngestionEvent({
      vendor: "claude",
      source: "stop_hook",
      result: missingResult
    });
    expect(event.type).toBe("turn_outcome.trailer_missing");
    expect(event.vendor).toBe("claude");
  });

  test("creates trailer_invalid event with raw_json in payload", () => {
    const invalidResult: TurnOutcomeTrailerParseResult = {
      kind: "invalid",
      source: "trailer",
      rawJson: '{"state":"bad"}',
      errors: [{ path: "$.state", message: "expected one of progress, blocked, ..." }]
    };
    const event = buildTurnOutcomeIngestionEvent({
      vendor: "opencode",
      sessionId: "sess-1",
      source: "idle_hook",
      result: invalidResult
    });
    expect(event.type).toBe("turn_outcome.trailer_invalid");
    expect((event.payload as Record<string, unknown>).raw_json).toBe('{"state":"bad"}');
    expect(event.sessionId).toBe("sess-1");
  });

  test("omits sessionId when not provided", () => {
    const missingResult: TurnOutcomeTrailerParseResult = {
      kind: "missing",
      source: "trailer",
      errors: [{ path: "$", message: "missing" }]
    };
    const event = buildTurnOutcomeIngestionEvent({
      vendor: "claude",
      source: "stop_hook",
      result: missingResult
    });
    expect("sessionId" in event).toBe(false);
  });

  test("omits raw_json from payload for missing results", () => {
    const missingResult: TurnOutcomeTrailerParseResult = {
      kind: "missing",
      source: "trailer",
      errors: [{ path: "$", message: "missing" }]
    };
    const event = buildTurnOutcomeIngestionEvent({
      vendor: "claude",
      source: "stop_hook",
      result: missingResult
    });
    expect("raw_json" in (event.payload as Record<string, unknown>)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  test("TURN_OUTCOME_TRAILER_LABEL is the expected string", () => {
    expect(TURN_OUTCOME_TRAILER_LABEL).toBe("turn_outcome:");
  });
});
