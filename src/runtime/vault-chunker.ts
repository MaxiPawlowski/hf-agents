import type { VaultDocument, VaultChunk } from "./types.js";

/** Minimum body-text length (excluding header line) for a section to stand alone. */
const MIN_BODY_CHARS = 20;

/**
 * Header pattern: lines starting with `## ` or `### `.
 * We deliberately exclude `# ` (top-level) so document titles don't split.
 */
const HEADER_RE = /^#{2,3}\s+/;

interface RawSection {
  headerLine: string; // e.g. "## Context"  (empty string for preamble)
  bodyLines: string[];
}

/**
 * Build a deterministic chunk id from a file path and section title.
 * The id is human-readable and stable across runs.
 */
function makeChunkId(filePath: string, sectionTitle: string): string {
  // Normalise path separators to forward slashes for cross-platform stability
  const normPath = filePath.replace(/\\/g, "/");
  return `${normPath}#${sectionTitle}`;
}

/**
 * Extract the section title from a header line.
 * Returns an empty string for preamble (no header).
 */
function extractTitle(headerLine: string): string {
  return headerLine.replace(/^#{2,3}\s+/, "").trim();
}

/**
 * Split a markdown document into raw sections at `##` / `###` boundaries.
 */
function splitIntoRawSections(content: string): RawSection[] {
  const lines = content.split("\n");
  const sections: RawSection[] = [];

  let current: RawSection = { headerLine: "", bodyLines: [] };

  for (const line of lines) {
    if (HEADER_RE.test(line)) {
      // Flush the previous section
      sections.push(current);
      current = { headerLine: line, bodyLines: [] };
    } else {
      current.bodyLines.push(line);
    }
  }
  // Flush last section
  sections.push(current);

  return sections;
}

/**
 * Compute the body text length of a raw section (excluding the header).
 * Only counts non-whitespace meaningful characters.
 */
function bodyTextLength(section: RawSection): number {
  return section.bodyLines.join("\n").trim().length;
}

/**
 * Merge sections whose body text is shorter than MIN_BODY_CHARS with the
 * following section. When the last section is short, merge it with the
 * preceding section instead.
 */
function mergeThinSections(sections: RawSection[]): RawSection[] {
  if (sections.length <= 1) return sections;

  const merged: RawSection[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;

    if (merged.length > 0 && bodyTextLength(section) < MIN_BODY_CHARS) {
      // Try to merge forward (with next section) if one exists
      const next = sections[i + 1];
      if (next) {
        // Append this section's content to the front of next section
        const combinedBody = [
          ...(section.headerLine ? [section.headerLine] : []),
          ...section.bodyLines,
          next.headerLine,
          ...next.bodyLines,
        ];
        // Replace next section in-place (we'll process it on the next iteration)
        sections[i + 1] = {
          headerLine: section.headerLine || next.headerLine,
          bodyLines: combinedBody.filter(
            (l) => l !== section.headerLine && l !== next.headerLine,
          ).length > 0
            ? (() => {
                // Rebuild: header from this section, body = this section body + next header + next body
                const body: string[] = [
                  ...section.bodyLines,
                  next.headerLine,
                  ...next.bodyLines,
                ];
                return body;
              })()
            : next.bodyLines,
        };
        continue;
      } else {
        // Last section is short — merge backward into the previous merged section
        const prev = merged[merged.length - 1]!;
        prev.bodyLines.push(
          ...(section.headerLine ? [section.headerLine] : []),
          ...section.bodyLines,
        );
        continue;
      }
    }

    merged.push({ ...section, bodyLines: [...section.bodyLines] });
  }

  return merged;
}

/**
 * Assemble the text content for a chunk from a raw section.
 */
function sectionText(section: RawSection): string {
  const parts: string[] = [];
  if (section.headerLine) parts.push(section.headerLine);
  parts.push(...section.bodyLines);
  return parts.join("\n");
}

/**
 * Split a VaultDocument into semantically meaningful chunks at `##` / `###` header
 * boundaries. Sections shorter than 20 characters of body text are merged with
 * adjacent sections. Markdown formatting is preserved.
 *
 * @param document - The vault document to chunk.
 * @returns An array of VaultChunk objects. An empty-content document returns an empty array.
 */
export function chunkVaultDocument(document: VaultDocument): VaultChunk[] {
  const { path: filePath, title: documentTitle, content } = document;

  // Empty content → empty array
  if (!content.trim()) return [];

  const rawSections = splitIntoRawSections(content);

  // Filter out empty preamble (no header, no body)
  const nonEmpty = rawSections.filter(
    (s) => s.headerLine || s.bodyLines.join("").trim().length > 0,
  );

  if (nonEmpty.length === 0) return [];

  // If there are no headers at all, return the whole document as one chunk
  const hasHeaders = nonEmpty.some((s) => s.headerLine);
  if (!hasHeaders) {
    const text = content;
    const sectionTitle = documentTitle;
    return [
      {
        id: makeChunkId(filePath, sectionTitle),
        text,
        metadata: { sourcePath: filePath, sectionTitle, documentTitle },
      },
    ];
  }

  // Merge thin sections
  const merged = mergeThinSections(nonEmpty);

  return merged.map((section) => {
    const title = section.headerLine
      ? extractTitle(section.headerLine)
      : documentTitle;
    const text = sectionText(section);
    return {
      id: makeChunkId(filePath, title),
      text,
      metadata: {
        sourcePath: filePath,
        sectionTitle: title,
        documentTitle,
      },
    };
  });
}
