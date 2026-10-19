/* Language front-end dispatch. */

import type Parser from "web-tree-sitter";
import type { LanguageId } from "@/lib/analysis/parsers/loader";
import type { ExtractedFile } from "./shared";
import { emptyExtracted } from "./shared";
import { extractGo } from "./tree-go";
import { extractPython } from "./tree-py";
import { extractTypeScriptFamily } from "./tree-ts";

export const ANALYZER_VERSION = "1.0.0";

export const SUPPORTED_LANGUAGES: Array<{ language: LanguageId; analyzer: string; version: string }> = [
  { language: "typescript", analyzer: "tree-ts", version: ANALYZER_VERSION },
  { language: "tsx", analyzer: "tree-ts", version: ANALYZER_VERSION },
  { language: "javascript", analyzer: "tree-ts", version: ANALYZER_VERSION },
  { language: "python", analyzer: "tree-py", version: ANALYZER_VERSION },
  { language: "go", analyzer: "tree-go", version: ANALYZER_VERSION },
];

/** Languages whose symbols participate in call-graph resolution. */
export const CODE_LANGUAGES: LanguageId[] = ["typescript", "tsx", "javascript", "python", "go"];

export function isCodeLanguage(language: LanguageId): boolean {
  return CODE_LANGUAGES.includes(language);
}

export function extractFromTree(root: Parser.SyntaxNode, filePath: string, language: LanguageId, parseStatus: "ok" | "partial"): ExtractedFile {
  switch (language) {
    case "typescript":
    case "tsx":
    case "javascript":
      return extractTypeScriptFamily(root, filePath, language, parseStatus);
    case "python":
      return extractPython(root, filePath, parseStatus);
    case "go":
      return extractGo(root, filePath, parseStatus);
    default:
      return emptyExtracted(filePath, language, "unparsed");
  }
}

export type { ExtractedFile, RawCall, RawImport, RawRead, RawSymbol } from "./shared";
