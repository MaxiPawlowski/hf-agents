/** Minimum body-text length for a section to stand alone. */
export const MIN_BODY_CHARS = 20;

/** Normalise path separators to forward slashes for cross-platform stability. */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/**
 * Build a deterministic, human-readable chunk id from a file path and section title.
 * Path separators are normalised to forward slashes for cross-platform stability.
 */
export function makeChunkId(filePath: string, sectionTitle: string): string {
  return `${normalizePath(filePath)}#${sectionTitle}`;
}

/**
 * Split text that exceeds maxChars at the given delimiter boundary.
 * Falls back to hard-splitting at maxChars if a single segment is still too long.
 *
 * @param delimiter - regex or string to split on (e.g. `\n\n` for paragraphs, `\n` for lines)
 * @param rejoin   - string used to rejoin segments (should match the delimiter)
 */
export function splitOversized(
  text: string,
  maxChars: number,
  delimiter: string | RegExp = /\n\n/,
  rejoin = "\n\n",
): string[] {
  if (text.length <= maxChars) return [text];

  const segments = text.split(delimiter);
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

  if (current) {
    parts.push(current);
  }

  // Handle single segments that are still too long
  const result: string[] = [];
  for (const part of parts) {
    if (part.length <= maxChars) {
      result.push(part);
    } else {
      for (let i = 0; i < part.length; i += maxChars) {
        result.push(part.slice(i, i + maxChars));
      }
    }
  }

  return result;
}

export interface NamedChunk {
  name: string;
  text: string;
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
  const input = chunks.map((c) => ({ ...c }));
  const merged: NamedChunk[] = [];

  for (let i = 0; i < input.length; i++) {
    const chunk = input[i]!;

    if (merged.length > 0 && chunk.text.trim().length < MIN_BODY_CHARS) {
      const next = input[i + 1];
      if (next) {
        input[i + 1] = {
          name: chunk.name || next.name,
          text: `${chunk.text}${separator}${next.text}`,
        };
        continue;
      }

      const previous = merged[merged.length - 1]!;
      previous.text = `${previous.text}${separator}${chunk.text}`;
      continue;
    }

    merged.push({ ...chunk });
  }

  return merged;
}
