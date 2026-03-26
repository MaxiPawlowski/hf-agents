import { describe, expect, test } from "vitest";

import { chunkTypeScriptFile } from "../src/runtime/code-chunker.js";

describe("code-chunker", () => {
  test("function, class, interface, type, enum, and exported vars produce chunks", () => {
    const source = [
      'import { readFileSync } from "node:fs";',
      "",
      "/** Adds one to the input. */",
      "export function increment(value: number): number {",
      "  return value + 1;",
      "}",
      "",
      "export class Counter {}",
      "",
      "export interface CounterShape {",
      "  count: number;",
      "}",
      "",
      "export type CounterId = string;",
      "",
      "export enum Status {",
      "  Ready = 'ready',",
      "}",
      "",
      "export const COUNT = 1;",
    ].join("\n");

    const chunks = chunkTypeScriptFile("src/example.ts", source);

    expect(chunks.map((chunk) => chunk.metadata.sectionTitle)).toEqual([
      "imports",
      "increment",
      "Counter",
      "CounterShape",
      "CounterId",
      "Status",
      "COUNT",
    ]);
  });

  test("includes leading JSDoc in chunk text", () => {
    const source = [
      "/**",
      " * Explains the helper.",
      " */",
      "export function helper(): number {",
      "  return 1;",
      "}",
    ].join("\n");

    const chunks = chunkTypeScriptFile("src/helper.ts", source);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toContain("Explains the helper.");
    expect(chunks[0]!.text.startsWith("/**")).toBe(true);
  });

  test("empty file returns empty array", () => {
    expect(chunkTypeScriptFile("src/empty.ts", "")).toEqual([]);
  });

  test("thin chunks merge with neighbors", () => {
    const source = [
      "export function mainFeature(): number {",
      "  return 42;",
      "}",
      "",
      "export type ID=1;",
      "",
      "export interface Profile {",
      "  id: ID;",
      "  name: string;",
      "}",
    ].join("\n");

    const chunks = chunkTypeScriptFile("src/thin.ts", source);

    expect(chunks).toHaveLength(2);
    expect(chunks[1]!.metadata.sectionTitle).toBe("ID");
    expect(chunks[1]!.text).toContain("export type ID=1;");
    expect(chunks[1]!.text).toContain("export interface Profile");
  });

  test("all chunks are marked as code and ids are deterministic", () => {
    const source = [
      'import { join } from "node:path";',
      "export function buildPath(): string {",
      '  return join("a", "b");',
      "}",
    ].join("\n");

    const chunksA = chunkTypeScriptFile("src\\paths.ts", source);
    const chunksB = chunkTypeScriptFile("src\\paths.ts", source);

    expect(chunksA.map((chunk) => chunk.metadata.kind)).toEqual(["code", "code"]);
    expect(chunksA.map((chunk) => chunk.id)).toEqual(chunksB.map((chunk) => chunk.id));
    expect(chunksA[0]!.id).toBe("src/paths.ts#imports");
    expect(chunksA[1]!.id).toBe("src/paths.ts#buildPath");
  });
});
