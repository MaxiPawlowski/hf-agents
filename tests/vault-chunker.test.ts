import assert from "node:assert";
import { describe, expect, test } from "vitest";

import { chunkVaultDocument } from "../src/index/vault-chunker.js";
import type { VaultDocument } from "../src/runtime/types.js";

function doc(
  content: string,
  path = "vault/plans/test/notes.md",
  title = "Test Notes",
): VaultDocument {
  return { path, title, content };
}

describe("vault-chunker", () => {
  test("splits vault-like markdown with multiple ## sections", () => {
    const md = [
      "## Context",
      "Brief context about the plan and its goals.",
      "",
      "## Decisions",
      "We decided to use TypeScript for everything.",
      "",
      "## References",
      "- Link 1",
      "- Link 2",
      "- Link 3 with extra text to exceed min length",
    ].join("\n");

    const chunks = chunkVaultDocument(doc(md));

    expect(chunks.length).toBe(3);
    const [c0, c1, c2] = chunks;
    assert(c0 !== undefined, "Expected chunk at index 0");
    assert(c1 !== undefined, "Expected chunk at index 1");
    assert(c2 !== undefined, "Expected chunk at index 2");
    expect(c0.metadata.sectionTitle).toBe("Context");
    expect(c1.metadata.sectionTitle).toBe("Decisions");
    expect(c2.metadata.sectionTitle).toBe("References");

    // Each chunk starts with its header
    expect(c0.text).toContain("## Context");
    expect(c1.text).toContain("## Decisions");
    expect(c2.text).toContain("## References");

    // Body text is included
    expect(c0.text).toContain("Brief context about the plan");
    expect(c1.text).toContain("We decided to use TypeScript");
  });

  test("empty file returns empty array", () => {
    const chunks = chunkVaultDocument(doc(""));
    expect(chunks).toEqual([]);
  });

  test("whitespace-only file returns empty array", () => {
    const chunks = chunkVaultDocument(doc("   \n\n  \n"));
    expect(chunks).toEqual([]);
  });

  test("single section with no headers returns one chunk with all content", () => {
    const content = "This is a simple document with no headers at all.\nIt has multiple lines.\nBut no section markers.";
    const chunks = chunkVaultDocument(doc(content));

    expect(chunks).toHaveLength(1);
    const [singleChunk] = chunks;
    assert(singleChunk !== undefined, "Expected chunk at index 0");
    expect(singleChunk.text).toBe(content);
    // falls back to doc title
    expect(singleChunk.metadata.sectionTitle).toBe("Test Notes");
  });

  test("nested ### headers produce separate chunks", () => {
    const md = [
      "## Decisions",
      "Overview of decisions made during planning.",
      "",
      "### Decision 1: Use TypeScript",
      "TypeScript provides type safety which is very important.",
      "",
      "### Decision 2: Use Vitest",
      "Vitest is fast and works great with TypeScript projects.",
    ].join("\n");

    const chunks = chunkVaultDocument(doc(md));

    expect(chunks.length).toBe(3);
    const [d0, d1, d2] = chunks;
    assert(d0 !== undefined, "Expected chunk at index 0");
    assert(d1 !== undefined, "Expected chunk at index 1");
    assert(d2 !== undefined, "Expected chunk at index 2");
    expect(d0.metadata.sectionTitle).toBe("Decisions");
    expect(d1.metadata.sectionTitle).toBe("Decision 1: Use TypeScript");
    expect(d2.metadata.sectionTitle).toBe("Decision 2: Use Vitest");
  });

  test("sections shorter than 20 chars body text merge with next section", () => {
    const md = [
      "## Overview",
      "This is a substantive overview section with lots of content.",
      "",
      "## Short",
      "Tiny.",
      "",
      "## Details",
      "This section has plenty of detail and explanation.",
    ].join("\n");

    const chunks = chunkVaultDocument(doc(md));

    // "Short" section body ("Tiny.") < 20 chars, should merge with "Details"
    // So we get 2 chunks instead of 3
    expect(chunks.length).toBe(2);
    const [mergeC0, mergeC1] = chunks;
    assert(mergeC0 !== undefined, "Expected chunk at index 0");
    assert(mergeC1 !== undefined, "Expected chunk at index 1");
    expect(mergeC0.metadata.sectionTitle).toBe("Overview");

    // Merged chunk uses the short section's header but includes both bodies
    expect(mergeC1.text).toContain("Tiny.");
    expect(mergeC1.text).toContain("## Details");
    expect(mergeC1.text).toContain("plenty of detail");
  });

  test("last short section merges backward", () => {
    const md = [
      "## Main",
      "This is the main section with a reasonable amount of content.",
      "",
      "## End",
      "Fin.",
    ].join("\n");

    const chunks = chunkVaultDocument(doc(md));

    // "End" body ("Fin.") is < 20 chars → merges backward into "Main"
    expect(chunks.length).toBe(1);
    const [mainChunk] = chunks;
    assert(mainChunk !== undefined, "Expected chunk at index 0");
    expect(mainChunk.text).toContain("## Main");
    expect(mainChunk.text).toContain("Fin.");
  });

  test("id is deterministic based on path and section title", () => {
    const md = "## Context\nSome content that is long enough to stand alone.";
    const d = doc(md, "vault/plans/my-plan/notes.md", "My Plan Notes");

    const chunks1 = chunkVaultDocument(d);
    const chunks2 = chunkVaultDocument(d);

    const [c1first] = chunks1;
    const [c2first] = chunks2;
    assert(c1first !== undefined, "Expected chunk1 at index 0");
    assert(c2first !== undefined, "Expected chunk2 at index 0");
    expect(c1first.id).toBe(c2first.id);
    expect(c1first.id).toBe("vault/plans/my-plan/notes.md#Context");
  });

  test("metadata fields are populated correctly", () => {
    const md = "## Section A\nBody text that is sufficiently long for testing.";
    const d = doc(md, "vault/shared/conventions.md", "Conventions");

    const chunks = chunkVaultDocument(d);

    expect(chunks).toHaveLength(1);
    const [chunk] = chunks;
    assert(chunk !== undefined, "Expected chunk at index 0");
    expect(chunk.metadata.sourcePath).toBe("vault/shared/conventions.md");
    expect(chunk.metadata.sectionTitle).toBe("Section A");
    expect(chunk.metadata.documentTitle).toBe("Conventions");
  });

  test("backslash path separators are normalised in id", () => {
    const md = "## Test\nContent that is long enough to stand on its own.";
    const d = doc(md, "vault\\plans\\test\\notes.md", "Notes");

    const chunks = chunkVaultDocument(d);
    const [firstChunk] = chunks;
    assert(firstChunk !== undefined, "Expected chunk at index 0");
    expect(firstChunk.id).toBe("vault/plans/test/notes.md#Test");
  });

  test("preamble before first header is included as its own chunk", () => {
    const md = [
      "This is preamble text that appears before any header.",
      "It provides general context for the document.",
      "",
      "## First Section",
      "Content of the first real section with enough text.",
    ].join("\n");

    const chunks = chunkVaultDocument(doc(md));

    expect(chunks.length).toBe(2);
    const [preambleChunk, firstSectionChunk] = chunks;
    assert(preambleChunk !== undefined, "Expected chunk at index 0");
    assert(firstSectionChunk !== undefined, "Expected chunk at index 1");
    // Preamble chunk uses document title as section title
    expect(preambleChunk.metadata.sectionTitle).toBe("Test Notes");
    expect(preambleChunk.text).toContain("preamble text");
    expect(firstSectionChunk.metadata.sectionTitle).toBe("First Section");
  });

  test("markdown formatting is preserved in chunk text", () => {
    const md = [
      "## Formatted Section",
      "Some **bold** and *italic* text.",
      "- bullet 1",
      "- bullet 2",
      "```ts",
      "const x = 1;",
      "```",
    ].join("\n");

    const chunks = chunkVaultDocument(doc(md));

    const [formattedChunk] = chunks;
    assert(formattedChunk !== undefined, "Expected chunk at index 0");
    expect(formattedChunk.text).toContain("**bold**");
    expect(formattedChunk.text).toContain("```ts");
  });
});
