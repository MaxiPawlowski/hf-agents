import ts from "typescript";

import type { VaultChunk } from "./types.js";
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

function classifyStatements(
  sourceText: string,
  statements: ReadonlyArray<ts.Statement>,
  sourceFile: ts.SourceFile,
): ClassifiedStatements {
  const imports: string[] = [];
  const catchAll: string[] = [];
  const declarations: NamedChunk[] = [];

  for (const statement of statements) {
    if (
      ts.isImportDeclaration(statement) ||
      ts.isImportEqualsDeclaration(statement) ||
      ts.isExportDeclaration(statement) ||
      ts.isExportAssignment(statement)
    ) {
      imports.push(getNodeText(sourceText, statement));
      continue;
    }

    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      const name = declarationName(statement);
      if (name) {
        declarations.push({ name, text: getNodeText(sourceText, statement) });
        continue;
      }
    }

    if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      declarations.push({ name: statement.name.text, text: getNodeText(sourceText, statement) });
      continue;
    }

    if (ts.isVariableStatement(statement) && isExported(statement)) {
      const statementText = getNodeText(sourceText, statement);
      for (const declaration of statement.declarationList.declarations) {
        declarations.push({ name: declaration.name.getText(sourceFile), text: statementText });
      }
      continue;
    }

    catchAll.push(getNodeText(sourceText, statement));
  }

  return { imports, catchAll, declarations };
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
      const parts = splitOversizedCode(chunk.text, maxChunkChars);
      for (let i = 0; i < parts.length; i++) {
        const base = createVaultChunk(filePath, { name: chunk.name, text: parts[i]! });
        base.id = `${base.id}:${i}`;
        result.push(base);
      }
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
