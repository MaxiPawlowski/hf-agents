import { describe, expect, test } from "vitest";

import { chunkVaultDocument } from "../src/runtime/vault-chunker.js";
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
    expect(chunks[0]!.metadata.sectionTitle).toBe("Context");
    expect(chunks[1]!.metadata.sectionTitle).toBe("Decisions");
    expect(chunks[2]!.metadata.sectionTitle).toBe("References");

    // Each chunk starts with its header
    expect(chunks[0]!.text).toContain("## Context");
    expect(chunks[1]!.text).toContain("## Decisions");
    expect(chunks[2]!.text).toContain("## References");

    // Body text is included
    expect(chunks[0]!.text).toContain("Brief context about the plan");
    expect(chunks[1]!.text).toContain("We decided to use TypeScript");
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
    expect(chunks[0]!.text).toBe(content);
    expect(chunks[0]!.metadata.sectionTitle).toBe("Test Notes"); // falls back to doc title
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
    expect(chunks[0]!.metadata.sectionTitle).toBe("Decisions");
    expect(chunks[1]!.metadata.sectionTitle).toBe("Decision 1: Use TypeScript");
    expect(chunks[2]!.metadata.sectionTitle).toBe("Decision 2: Use Vitest");
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
    expect(chunks[0]!.metadata.sectionTitle).toBe("Overview");

    // Merged chunk uses the short section's header but includes both bodies
    expect(chunks[1]!.text).toContain("Tiny.");
    expect(chunks[1]!.text).toContain("## Details");
    expect(chunks[1]!.text).toContain("plenty of detail");
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
    expect(chunks[0]!.text).toContain("## Main");
    expect(chunks[0]!.text).toContain("Fin.");
  });

  test("id is deterministic based on path and section title", () => {
    const md = "## Context\nSome content that is long enough to stand alone.";
    const d = doc(md, "vault/plans/my-plan/notes.md", "My Plan Notes");

    const chunks1 = chunkVaultDocument(d);
    const chunks2 = chunkVaultDocument(d);

    expect(chunks1[0]!.id).toBe(chunks2[0]!.id);
    expect(chunks1[0]!.id).toBe("vault/plans/my-plan/notes.md#Context");
  });

  test("metadata fields are populated correctly", () => {
    const md = "## Section A\nBody text that is sufficiently long for testing.";
    const d = doc(md, "vault/shared/conventions.md", "Conventions");

    const chunks = chunkVaultDocument(d);

    expect(chunks).toHaveLength(1);
    const chunk = chunks[0]!;
    expect(chunk.metadata.sourcePath).toBe("vault/shared/conventions.md");
    expect(chunk.metadata.sectionTitle).toBe("Section A");
    expect(chunk.metadata.documentTitle).toBe("Conventions");
  });

  test("backslash path separators are normalised in id", () => {
    const md = "## Test\nContent that is long enough to stand on its own.";
    const d = doc(md, "vault\\plans\\test\\notes.md", "Notes");

    const chunks = chunkVaultDocument(d);
    expect(chunks[0]!.id).toBe("vault/plans/test/notes.md#Test");
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
    // Preamble chunk uses document title as section title
    expect(chunks[0]!.metadata.sectionTitle).toBe("Test Notes");
    expect(chunks[0]!.text).toContain("preamble text");
    expect(chunks[1]!.metadata.sectionTitle).toBe("First Section");
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

    expect(chunks[0]!.text).toContain("**bold**");
    expect(chunks[0]!.text).toContain("```ts");
  });
});
