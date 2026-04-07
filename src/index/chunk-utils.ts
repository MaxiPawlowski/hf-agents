/** Minimum body-text length for a section to stand alone. */
export const MIN_BODY_CHARS = 20;

/** Normalise path separators to forward slashes for cross-platform stability. */
export function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

/**
 * Build a deterministic, human-readable chunk id from a file path and section title.
 * Path separators are normalised to forward slashes for cross-platform stability.
 */
export function makeChunkId(filePath: string, sectionTitle: string): string {
  return `${normalizePath(filePath)}#${sectionTitle}`;
}

/** Options for {@link splitOversized}. */
export interface SplitOversizedOpts {
  /** Regex or string to split on (e.g. `\n\n` for paragraphs, `\n` for lines). Defaults to `/\n\n/`. */
  delimiter?: string | RegExp;
  /** String used to rejoin segments (should match the delimiter). Defaults to `"\n\n"`. */
  rejoin?: string;
}

/** Accumulate segments into parts that fit within maxChars, using rejoin between them. */
function accumulateSegments(segments: string[], maxChars: number, rejoin: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (const segment of segments) {
    const candidate = current ? `${current}${rejoin}${segment}` : segment;
    if (candidate.length > maxChars && current) {
      parts.push(current);
      current = segment;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Hard-split a single part that still exceeds maxChars into fixed-size slices. */
function hardSplitPart(part: string, maxChars: number): string[] {
  const slices: string[] = [];
  for (let i = 0; i < part.length; i += maxChars) {
    slices.push(part.slice(i, i + maxChars));
  }
  return slices;
}

/**
 * Split text that exceeds maxChars at the given delimiter boundary.
 * Falls back to hard-splitting at maxChars if a single segment is still too long.
 */
export function splitOversized(
  text: string,
  maxChars: number,
  opts?: SplitOversizedOpts,
): string[] {
  const { delimiter = /\n\n/, rejoin = "\n\n" } = opts ?? {};
  if (text.length <= maxChars) return [text];

  const parts = accumulateSegments(text.split(delimiter), maxChars, rejoin);

  const result: string[] = [];
  for (const part of parts) {
    if (part.length <= maxChars) {
      result.push(part);
    } else {
      result.push(...hardSplitPart(part, maxChars));
    }
  }
  return result;
}

export interface NamedChunk {
  name: string;
  text: string;
}

interface MergeContext {
  input: NamedChunk[];
  merged: NamedChunk[];
  separator: string;
}

/**
 * Attempt to merge a thin chunk into an adjacent slot.
 * Returns true if the chunk was merged (skip pushing to merged).
 */
function absorbThinChunk(chunk: NamedChunk, index: number, ctx: MergeContext): boolean {
  const next = ctx.input[index + 1];
  if (next) {
    ctx.input[index + 1] = {
      name: chunk.name || next.name,
      text: `${chunk.text}${ctx.separator}${next.text}`,
    };
    return true;
  }
  const previous = ctx.merged.at(-1);
  if (!previous) return false;
  previous.text = `${previous.text}${ctx.separator}${chunk.text}`;
  return true;
}

/**
 * Merge chunks whose trimmed text is shorter than MIN_BODY_CHARS with an
 * adjacent chunk.  Short chunks merge forward into the next chunk when one
 * exists, otherwise backward into the previous merged chunk.
 *
 * The separator string is placed between the merged texts (default `"\n\n"`).
 */
export function mergeThinChunks(
  chunks: NamedChunk[],
  separator = "\n\n",
): NamedChunk[] {
  if (chunks.length <= 1) return chunks;

  // Shallow-copy so we can safely mutate the look-ahead slot.
  const ctx: MergeContext = {
    input: chunks.map((c) => ({ ...c })),
    merged: [],
    separator,
  };

  for (let i = 0; i < ctx.input.length; i++) {
    const chunk = ctx.input[i];
    if (!chunk) continue;
    if (ctx.merged.length > 0 && chunk.text.trim().length < MIN_BODY_CHARS) {
      absorbThinChunk(chunk, i, ctx);
      continue;
    }
    ctx.merged.push({ ...chunk });
  }

  return ctx.merged;
}
