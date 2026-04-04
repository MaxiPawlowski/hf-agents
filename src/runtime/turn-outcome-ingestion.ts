import {
  TURN_OUTCOME_TRAILER_LABEL,
  parseTurnOutcomeInput,
  type TurnOutcomeTrailerParseResult
} from "./turn-outcome-trailer.js";
import { isRecord, isString } from "./utils.js";

interface TurnOutcomeCandidate {
  source: string;
  text: string;
}

interface CandidateCollector {
  source: string;
  candidates: TurnOutcomeCandidate[];
  seen: Set<unknown>;
}

export interface TurnOutcomePayloadDetection {
  source: string;
  result: TurnOutcomeTrailerParseResult;
}

function shouldInspectString(value: string): boolean {
  const trimmed = value.trim();
  return value.includes(TURN_OUTCOME_TRAILER_LABEL) || trimmed.startsWith("{");
}

function collectTurnOutcomeCandidates(value: unknown, collector: CandidateCollector): void {
  if (isString(value)) {
    if (shouldInspectString(value)) {
      collector.candidates.push({ source: collector.source, text: value });
    }
    return;
  }

  if (value === null || value === undefined || collector.seen.has(value)) {
    return;
  }

  collector.seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectTurnOutcomeCandidates(entry, { ...collector, source: `${collector.source}[${index}]` });
    });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    collectTurnOutcomeCandidates(entry, { ...collector, source: `${collector.source}.${key}` });
  }
}

export function detectTurnOutcomeInPayload(value: unknown, fallbackSource: string): TurnOutcomePayloadDetection {
  const collector: CandidateCollector = { source: fallbackSource, candidates: [], seen: new Set() };
  collectTurnOutcomeCandidates(value, collector);
  const { candidates } = collector;

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
