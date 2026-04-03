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
  return splitOversized(text, maxChars, "\n", "\n");
}

// oxlint-disable-next-line max-lines-per-function -- walks a TypeScript AST with multiple declaration-type branches; each branch is minimal; splitting would fragment the traversal logic
export function chunkTypeScriptFile(
  filePath: string,
  sourceText: string,
  maxChunkChars?: number,
): VaultChunk[] {
  if (!sourceText.trim()) return [];

  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );

  const importExportTexts: string[] = [];
  const catchAllTexts: string[] = [];
  const declarationChunks: NamedChunk[] = [];

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) ||
      ts.isImportEqualsDeclaration(statement) ||
      ts.isExportDeclaration(statement) ||
      ts.isExportAssignment(statement)
    ) {
      importExportTexts.push(getNodeText(sourceText, statement));
      continue;
    }

    if (ts.isFunctionDeclaration(statement)) {
      const name = declarationName(statement);
      if (name) {
        declarationChunks.push({
          name,
          text: getNodeText(sourceText, statement),
        });
        continue;
      }
    }

    if (ts.isClassDeclaration(statement)) {
      const name = declarationName(statement);
      if (name) {
        declarationChunks.push({
          name,
          text: getNodeText(sourceText, statement),
        });
        continue;
      }
    }

    if (ts.isInterfaceDeclaration(statement)) {
      declarationChunks.push({
        name: statement.name.text,
        text: getNodeText(sourceText, statement),
      });
      continue;
    }

    if (ts.isTypeAliasDeclaration(statement)) {
      declarationChunks.push({
        name: statement.name.text,
        text: getNodeText(sourceText, statement),
      });
      continue;
    }

    if (ts.isEnumDeclaration(statement)) {
      declarationChunks.push({
        name: statement.name.text,
        text: getNodeText(sourceText, statement),
      });
      continue;
    }

    if (ts.isVariableStatement(statement) && isExported(statement)) {
      const statementText = getNodeText(sourceText, statement);
      for (const declaration of statement.declarationList.declarations) {
        declarationChunks.push({
          name: declaration.name.getText(sourceFile),
          text: statementText,
        });
      }
      continue;
    }

    catchAllTexts.push(getNodeText(sourceText, statement));
  }

  const rawChunks: NamedChunk[] = [];

  if (importExportTexts.length > 0) {
    rawChunks.push({
      name: "imports",
      text: importExportTexts.join("\n"),
    });
  }

  rawChunks.push(...declarationChunks);

  if (catchAllTexts.length > 0) {
    rawChunks.push({
      name: "catch-all",
      text: catchAllTexts.join("\n"),
    });
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
