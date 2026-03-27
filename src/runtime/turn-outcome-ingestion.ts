import {
  TURN_OUTCOME_TRAILER_LABEL,
  parseTurnOutcomeInput,
  type TurnOutcomeTrailerParseResult
} from "./turn-outcome-trailer.js";
import { isRecord } from "./utils.js";

interface TurnOutcomeCandidate {
  source: string;
  text: string;
}

export interface TurnOutcomePayloadDetection {
  source: string;
  result: TurnOutcomeTrailerParseResult;
}

function shouldInspectString(value: string): boolean {
  const trimmed = value.trim();
  return value.includes(TURN_OUTCOME_TRAILER_LABEL) || trimmed.startsWith("{");
}

function collectTurnOutcomeCandidates(
  value: unknown,
  source: string,
  candidates: TurnOutcomeCandidate[],
  seen: Set<unknown>
): void {
  if (typeof value === "string") {
    if (shouldInspectString(value)) {
      candidates.push({ source, text: value });
    }
    return;
  }

  if (value === null || value === undefined || seen.has(value)) {
    return;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectTurnOutcomeCandidates(entry, `${source}[${index}]`, candidates, seen);
    });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    collectTurnOutcomeCandidates(entry, `${source}.${key}`, candidates, seen);
  }
}

export function detectTurnOutcomeInPayload(value: unknown, fallbackSource: string): TurnOutcomePayloadDetection {
  const candidates: TurnOutcomeCandidate[] = [];
  collectTurnOutcomeCandidates(value, fallbackSource, candidates, new Set());

  let firstInvalid: TurnOutcomePayloadDetection | null = null;
  for (const candidate of candidates) {
    const result = parseTurnOutcomeInput(candidate.text);
    if (result.kind === "valid") {
      return { source: candidate.source, result };
    }
    if (result.kind === "invalid" && !firstInvalid) {
      firstInvalid = { source: candidate.source, result };
    }
  }

  return firstInvalid ?? {
    source: fallbackSource,
    result: {
      kind: "missing",
      source: "trailer",
      errors: [{ path: "$", message: "missing final turn_outcome trailer" }]
    }
  };
}
