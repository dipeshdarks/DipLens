/* Path-based file classification.
 *
 * Classification decides what the engine invests budget in. It never
 * executes or trusts the file — it only reads its name.
 */

import type { LanguageId } from "@/lib/analysis/parsers/loader";
import { languageForPath } from "@/lib/analysis/parsers/loader";

export type FileCategory = "source" | "test" | "config" | "docs" | "vendor" | "generated" | "binary" | "data" | "other";

export type ClassifiedFile = {
  path: string;
  name: string;
  ext: string;
  size: number;
  category: FileCategory;
  language: LanguageId;
  /** Lower = analyze first. Source is highest, vendor/binary lowest. */
  priority: number;
  reasons: string[];
};

const VENDOR_DIRS = [
  "node_modules/",
  "vendor/",
  "third_party/",
  "thirdparty/",
  "external/",
  "bower_components/",
  ".yarn/",
  "site-packages/",
  "Pods/",
  "Carthage/",
];

const BUILD_DIRS = ["dist/", "build/", "out/", ".next/", "target/", "coverage/", ".turbo/", ".cache/", "obj/"];

const GENERATED_MARKERS = [
  ".pb.go",
  "_pb2.py",
  "_pb2_grpc.py",
  ".pb.cc",
  ".pb.h",
  ".g.dart",
  ".generated.",
  ".gen.go",
  ".min.js",
  ".min.css",
  ".map",
  ".d.ts",
  "_generated.",
  ".spec.ts.snap",
  "__generated__/",
];

const TEST_PATTERNS = [
  /(^|\/)__tests__\//,
  /(^|\/)__mocks__\//,
  /(^|\/)tests?\//,
  /(^|\/)spec\//,
  /(^|\/)test_/,
  /\.(test|spec)\.[jt]sx?$/,
  /\.test\.py$/,
  /_test\.go$/,
  /Test\.java$/,
  /_spec\.rb$/,
  /\.spec\.ts$/,
  /\.(test|e2e)\./,
];

const DOCS_EXTS = new Set([".md", ".mdx", ".rst", ".adoc", ".txt", ".org"]);
const DATA_EXTS = new Set([".csv", ".tsv", ".jsonl", ".parquet", ".sqlite", ".db"]);
const CONFIG_NAMES = new Set([
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "tsconfig.json",
  "jsconfig.json",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "vite.config.ts",
  "vitest.config.ts",
  "webpack.config.js",
  "rollup.config.js",
  "babel.config.js",
  ".babelrc",
  "jest.config.js",
  "jest.config.ts",
  "eslint.config.js",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.json",
  ".prettierrc",
  "prettier.config.js",
  "tailwind.config.ts",
  "tailwind.config.js",
  "postcss.config.js",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "Makefile",
  "makefile",
  "go.mod",
  "go.sum",
  "requirements.txt",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "Pipfile",
  "poetry.lock",
  "Cargo.toml",
  "Cargo.lock",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "composer.json",
  "composer.lock",
  ".env.example",
  ".gitignore",
  ".npmrc",
  ".nvmrc",
  ".editorconfig",
  ".dockerignore",
  "CODEOWNERS",
  "LICENSE",
  "LICENSE.md",
  "renovate.json",
  "dependabot.yml",
]);

const CONFIG_EXTS = new Set([".yml", ".yaml", ".toml", ".ini", ".cfg", ".properties", ".tf", ".hcl"]);
const CONFIG_PATH_PATTERNS = [
  /^\.github\/workflows\//,
  /^\.github\/actions\//,
  /^\.circleci\//,
  /^\.gitlab-ci/,
  /^k8s\//,
  /^deploy\//,
  /^infra\//,
  /^charts\//,
  /\.(yaml|yml|toml|tf)$/,
];

const BINARY_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".tiff",
  ".psd",
  ".ai",
  ".sketch",
  ".mp3",
  ".wav",
  ".ogg",
  ".m4a",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".zip",
  ".gz",
  ".tar",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".jar",
  ".war",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".wasm",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".eot",
  ".class",
  ".o",
  ".a",
  ".lib",
  ".bin",
  ".dat",
  ".db-journal",
  ".pack",
  ".idx",
]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i).toLowerCase() : "";
}

function startsWithAny(path: string, prefixes: string[]): string | null {
  const lower = path.toLowerCase();
  for (const p of prefixes) {
    if (lower.startsWith(p.toLowerCase()) || lower.includes(`/${p.toLowerCase()}`)) return p;
  }
  return null;
}

export function classifyFile(path: string, size: number): ClassifiedFile {
  const name = path.split("/").pop() ?? path;
  const ext = extOf(name);
  const language = languageForPath(path);
  const reasons: string[] = [];
  let category: FileCategory = "other";
  let priority = 50;

  const vendorDir = startsWithAny(path, VENDOR_DIRS);
  if (vendorDir) {
    return {
      path,
      name,
      ext,
      size,
      category: "vendor",
      language,
      priority: 100,
      reasons: [`under vendor directory: ${vendorDir}`],
    };
  }

  const genMarker = GENERATED_MARKERS.find((m) => path.toLowerCase().includes(m.toLowerCase()));
  if (genMarker && !path.endsWith(".d.ts")) {
    return { path, name, ext, size, category: "generated", language, priority: 90, reasons: [`generated marker: ${genMarker}`] };
  }

  if (BINARY_EXTS.has(ext)) {
    return { path, name, ext, size, category: "binary", language, priority: 100, reasons: [`binary extension: ${ext}`] };
  }

  if (ext === ".min.js" || ext === ".min.css" || name.endsWith(".min.js") || name.endsWith(".min.css")) {
    return { path, name, ext, size, category: "vendor", language, priority: 95, reasons: ["minified bundle"] };
  }

  // Build output is deprioritized even when it carries a code extension:
  // minified/bundled JS in dist/ is not the code under review.
  const buildDir = startsWithAny(path, BUILD_DIRS);
  if (buildDir) {
    return {
      path,
      name,
      ext,
      size,
      category: "generated",
      language,
      priority: 85,
      reasons: [`build output directory: ${buildDir}`],
    };
  }

  const testPattern = TEST_PATTERNS.find((re) => re.test(path));
  if (testPattern) {
    reasons.push(`test path pattern: ${testPattern.source}`);
    category = "test";
    priority = language === "other" ? 70 : 25;
  } else if (CONFIG_NAMES.has(name)) {
    reasons.push("known configuration filename");
    category = "config";
    priority = 20;
  } else if (CONFIG_PATH_PATTERNS.some((re) => re.test(path))) {
    reasons.push("configuration path pattern");
    category = "config";
    priority = 20;
  } else if (CONFIG_EXTS.has(ext) && language === "other") {
    reasons.push(`configuration extension: ${ext}`);
    category = "config";
    priority = 30;
  } else if (DOCS_EXTS.has(ext)) {
    reasons.push(`documentation extension: ${ext}`);
    category = "docs";
    priority = 60;
  } else if (DATA_EXTS.has(ext)) {
    reasons.push(`data extension: ${ext}`);
    category = "data";
    priority = 80;
  } else if (language !== "other") {
    reasons.push(`source extension: ${ext}`);
    category = "source";
    priority = 10;
  } else if (name.startsWith(".env")) {
    reasons.push("environment file");
    category = "config";
    priority = 20;
  }

  if (name.includes(".test.") || name.includes(".spec.")) {
    if (category !== "test") {
      category = "test";
      priority = language === "other" ? 70 : 25;
      reasons.push("test filename");
    }
  }

  return { path, name, ext, size, category, language, priority, reasons };
}

export function classifyAll(entries: Array<{ path: string; size?: number }>): ClassifiedFile[] {
  return entries.map((e) => classifyFile(e.path, e.size ?? 0));
}
