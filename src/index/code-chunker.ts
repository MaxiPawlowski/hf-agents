import ts from "typescript";

import type { VaultChunk } from "../runtime/types.js";
import { makeChunkId, mergeThinChunks, normalizePath, splitOversized, type NamedChunk } from "./chunk-utils.js";

function getNodeText(sourceText: string, node: ts.Node): string {
  return sourceText.slice(node.getFullStart(), node.getEnd());
}

function createVaultChunk(filePath: string, chunk: { name: string; text: string }): VaultChunk {
  const normalizedPath = normalizePath(filePath);
  return {
    id: makeChunkId(filePath, chunk.name),
    text: chunk.text,
    metadata: {
      sourcePath: filePath,
      sectionTitle: chunk.name,
      documentTitle: normalizedPath,
      kind: "code",
    },
  };
}

function isExported(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return !!ts
    .getModifiers(node)
    ?.some((modifier: ts.Modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function declarationName(
  node:
    | ts.FunctionDeclaration
    | ts.ClassDeclaration
    | ts.InterfaceDeclaration
    | ts.TypeAliasDeclaration
    | ts.EnumDeclaration,
): string | null {
  if (node.name) return node.name.text;
  if (isExported(node)) return "default";
  return null;
}

function splitOversizedCode(text: string, maxChars: number): string[] {
  return splitOversized(text, maxChars, { delimiter: "\n", rejoin: "\n" });
}

interface ClassifiedStatements {
  imports: string[];
  catchAll: string[];
  declarations: NamedChunk[];
}

function isImportLike(statement: ts.Statement): boolean {
  return (
    ts.isImportDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement) ||
    ts.isExportDeclaration(statement) ||
    ts.isExportAssignment(statement)
  );
}

interface ClassifyContext {
  sourceText: string;
  sourceFile: ts.SourceFile;
  out: ClassifiedStatements;
}

function classifyOneStatement(statement: ts.Statement, ctx: ClassifyContext): void {
  const { sourceText, sourceFile, out } = ctx;
  if (isImportLike(statement)) {
    out.imports.push(getNodeText(sourceText, statement));
    return;
  }

  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    const name = declarationName(statement);
    if (name) {
      out.declarations.push({ name, text: getNodeText(sourceText, statement) });
      return;
    }
  }

  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    out.declarations.push({ name: statement.name.text, text: getNodeText(sourceText, statement) });
    return;
  }

  if (ts.isVariableStatement(statement) && isExported(statement)) {
    const statementText = getNodeText(sourceText, statement);
    for (const declaration of statement.declarationList.declarations) {
      out.declarations.push({ name: declaration.name.getText(sourceFile), text: statementText });
    }
    return;
  }

  out.catchAll.push(getNodeText(sourceText, statement));
}

function classifyStatements(
  sourceText: string,
  statements: ReadonlyArray<ts.Statement>,
  sourceFile: ts.SourceFile,
): ClassifiedStatements {
  const out: ClassifiedStatements = { imports: [], catchAll: [], declarations: [] };
  const ctx: ClassifyContext = { sourceText, sourceFile, out };
  for (const statement of statements) {
    classifyOneStatement(statement, ctx);
  }
  return out;
}

function splitChunkIntoParts(filePath: string, chunk: NamedChunk, maxChunkChars: number): VaultChunk[] {
  const parts = splitOversizedCode(chunk.text, maxChunkChars);
  const result: VaultChunk[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const base = createVaultChunk(filePath, { name: chunk.name, text: part });
    base.id = `${base.id}:${i}`;
    result.push(base);
  }
  return result;
}

function assembleChunks(filePath: string, classified: ClassifiedStatements, maxChunkChars: number | undefined): VaultChunk[] {
  const rawChunks: NamedChunk[] = [];

  if (classified.imports.length > 0) {
    rawChunks.push({ name: "imports", text: classified.imports.join("\n") });
  }

  rawChunks.push(...classified.declarations);

  if (classified.catchAll.length > 0) {
    rawChunks.push({ name: "catch-all", text: classified.catchAll.join("\n") });
  }

  const merged = mergeThinChunks(rawChunks);
  const result: VaultChunk[] = [];

  for (const chunk of merged) {
    if (maxChunkChars && chunk.text.length > maxChunkChars) {
      result.push(...splitChunkIntoParts(filePath, chunk, maxChunkChars));
    } else {
      result.push(createVaultChunk(filePath, chunk));
    }
  }

  return result;
}

export function chunkTypeScriptFile(
  filePath: string,
  sourceText: string,
  maxChunkChars?: number,
): VaultChunk[] {
  if (!sourceText.trim()) return [];

  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const classified = classifyStatements(sourceText, sourceFile.statements, sourceFile);
  return assembleChunks(filePath, classified, maxChunkChars);
}
