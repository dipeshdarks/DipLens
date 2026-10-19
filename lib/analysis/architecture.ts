import type {
  ArchitectureReport,
  AppType,
  Confidence,
  DependencySet,
  EntryPoint,
  FileSnapshot,
  Finding,
  ModuleEdge,
  ModuleNode,
  TreeEntry,
} from "@/types/analysis";
import { makeFinding } from "@/lib/analysis/evidence";

const FRAMEWORK_DEPS: Record<string, string> = {
  next: "Next.js",
  react: "React",
  vue: "Vue",
  nuxt: "Nuxt",
  svelte: "Svelte",
  "@sveltejs/kit": "SvelteKit",
  angular: "Angular",
  "@angular/core": "Angular",
  express: "Express",
  fastify: "Fastify",
  koa: "Koa",
  nest: "NestJS",
  "@nestjs/core": "NestJS",
  hono: "Hono",
  remix: "Remix",
  "@remix-run/react": "Remix",
  astro: "Astro",
  electron: "Electron",
  "react-native": "React Native",
  django: "Django",
  flask: "Flask",
  fastapi: "FastAPI",
  "spring-boot": "Spring Boot",
  rails: "Ruby on Rails",
  actix_web: "actix-web",
  axum: "axum",
  gin: "gin",
  "gin-gonic/gin": "gin",
};

const ENTRY_CANDIDATES = [
  "src/index.ts",
  "src/index.js",
  "src/main.ts",
  "src/main.js",
  "src/app.ts",
  "src/app.js",
  "src/server.ts",
  "src/server.js",
  "index.js",
  "index.ts",
  "main.ts",
  "main.js",
  "server.js",
  "app.js",
  "main.py",
  "app.py",
  "src/main.rs",
  "src/lib.rs",
  "main.go",
  "cmd",
  "src/cli.ts",
  "bin",
  "src/index.tsx",
];

const IMPORT_RE =
  /(?:^|\n)\s*(?:import\s+(?:type\s+)?(?:[\w$*{},\s]+?)\s+from\s+|const\s+\w+\s*=\s*require\()\s*["']([^"']+)["']/g;
const PY_IMPORT_RE = /(?:^|\n)\s*(?:from\s+([\w.]+)|import\s+([\w.]+))/g;
const GO_IMPORT_RE = /(?:^|\n)\s*import\s*(?:\(\s*)?"([^"]+)"/g;

function detectFrameworks(sets: DependencySet[]): string[] {
  const found = new Set<string>();
  for (const set of sets) {
    for (const dep of set.direct) {
      const hit = FRAMEWORK_DEPS[dep.name];
      if (hit) found.add(hit);
      else {
        const scoped = dep.name.includes("/")
          ? FRAMEWORK_DEPS[dep.name.split("/").pop() ?? ""]
          : undefined;
        if (scoped) found.add(scoped);
      }
    }
  }
  return [...found];
}

function detectAppType(
  sets: DependencySet[],
  entries: TreeEntry[],
  frameworks: string[],
): { type: AppType; confidence: Confidence; why: string } {
  const js = sets.find((s) => s.ecosystem === "javascript");
  const py = sets.find((s) => s.ecosystem === "python");
  const depNames = new Set(sets.flatMap((s) => s.direct.map((d) => d.name)));
  const has = (n: string) => depNames.has(n);
  const paths = entries.map((e) => e.path);

  const serverFramework =
    has("express") || has("fastify") || has("koa") || has("@nestjs/core") || has("hono") ||
    has("django") || has("flask") || has("fastapi");
  const clientFramework = frameworks.some((f) =>
    ["React", "Vue", "Svelte", "Angular", "Next.js", "Nuxt", "SvelteKit", "Astro"].includes(f),
  );
  const isNext = frameworks.includes("Next.js");

  if (isNext) return { type: "fullstack-web", confidence: "high", why: "Next.js dependency plus app/pages directory conventions." };
  if (serverFramework && clientFramework)
    return { type: "fullstack-web", confidence: "medium", why: "Both server and browser UI frameworks are declared." };
  if (clientFramework) return { type: "web-frontend", confidence: "medium", why: "Browser UI framework declared in the manifest." };
  if (serverFramework) return { type: "web-backend", confidence: "medium", why: "Server framework declared in the manifest." };
  if (has("react-native") || has("expo"))
    return { type: "mobile", confidence: "high", why: "Mobile framework dependency detected." };
  if (js && js.scripts?.build && paths.some((p) => /^src\/cli\.(ts|js)$/.test(p)))
    return { type: "cli", confidence: "medium", why: "CLI entry point and build script present." };
  if (py && paths.some((p) => p === "setup.py" || p === "pyproject.toml"))
    return { type: "library", confidence: "medium", why: "Python packaging metadata without a server entry point." };
  const monorepo = entries.some((e) => e.path === "pnpm-workspace.yaml" || e.path === "lerna.json" || e.path.startsWith("packages/") && e.path.split("/").length === 2);
  if (monorepo) return { type: "monorepo", confidence: "medium", why: "Workspace configuration or packages/ layout detected." };
  if (!sets.length) return { type: "unknown", confidence: "low", why: "No package manifest was retrieved." };
  return { type: "library", confidence: "low", why: "No server or UI framework detected; treated as a library by default." };
}

function detectEntryPoints(entries: TreeEntry[], sets: DependencySet[]): EntryPoint[] {
  const out: EntryPoint[] = [];
  const paths = new Set(entries.filter((e) => e.type === "blob").map((e) => e.path));

  for (const cand of ENTRY_CANDIDATES) {
    if (paths.has(cand)) out.push({ path: cand, basis: "conventional entry-point filename" });
    if (out.length >= 5) break;
  }
  const workflowDirs = [...paths].filter((p) => /^(app|pages|src\/app|src\/pages)\//.test(p));
  if (!out.length && workflowDirs.length) {
    out.push({ path: workflowDirs[0].split("/").slice(0, 2).join("/"), basis: "framework routing directory" });
  }
  const cmds = [...paths].filter((p) => /^cmd\/[^/]+\/main\.go$/.test(p));
  for (const c of cmds.slice(0, 3)) out.push({ path: c, basis: "Go cmd convention" });

  for (const set of sets) {
    const startScript = set.scripts?.start;
    if (startScript) {
      out.push({ path: set.manifestPath, basis: `package start script: ${startScript.slice(0, 80)}` });
      break;
    }
  }
  return out.slice(0, 6);
}

/** Extract module edges from source snapshots (relative imports only, resolved against known tree paths). */
export function extractModuleGraph(
  snapshots: FileSnapshot[],
  knownPaths: Set<string>,
): { nodes: ModuleNode[]; edges: ModuleEdge[] } {
  const edgeMap = new Map<string, ModuleEdge>();
  const nodeIds = new Set<string>();

  for (const snap of snapshots) {
    nodeIds.add(snap.path);
    const isPy = snap.path.endsWith(".py");
    const isGo = snap.path.endsWith(".go");
    const re = isPy ? PY_IMPORT_RE : isGo ? GO_IMPORT_RE : IMPORT_RE;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    const localCounts = new Map<string, number>();
    while ((m = re.exec(snap.content)) !== null) {
      const spec = (m[1] ?? m[2] ?? "").trim();
      if (!spec) continue;
      if (isPy) {
        if (!spec.startsWith(".")) continue;
        const resolved = resolvePy(snap.path, spec, knownPaths);
        if (resolved) localCounts.set(resolved, (localCounts.get(resolved) ?? 0) + 1);
      } else if (isGo) {
        // Go imports are module paths, not file paths — only same-module relatives are resolvable.
        continue;
      } else {
        if (!spec.startsWith(".") && !spec.startsWith("/")) continue;
        const resolved = resolveRelative(snap.path, spec, knownPaths);
        if (resolved) localCounts.set(resolved, (localCounts.get(resolved) ?? 0) + 1);
      }
    }
    for (const [to, count] of localCounts) {
      nodeIds.add(to);
      const key = `${snap.path}→${to}`;
      edgeMap.set(key, { from: snap.path, to, count });
    }
  }

  const nodes: ModuleNode[] = [...nodeIds]
    .sort()
    .map((id) => ({ id, kind: id.includes(".") ? "file" : "package" }));
  return { nodes, edges: [...edgeMap.values()].sort((a, b) => b.count - a.count).slice(0, 120) };
}

const EXT_CANDIDATES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.js", "/index.tsx"];

/** Resolve a relative import to a path that exists in the tree. Returns null when unresolvable. */
export function resolveRelative(
  fromPath: string,
  spec: string,
  knownPaths: Set<string>,
): string | null {
  const fromParts = fromPath.split("/");
  fromParts.pop();
  const specParts = (spec.startsWith("/") ? spec.slice(1) : spec).split("/");
  const parts = [...fromParts];
  for (const seg of specParts) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  if (!parts.length) return null;
  const resolved = parts.join("/");
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb)$/.test(resolved)) {
    return knownPaths.has(resolved) ? resolved : null;
  }
  for (const ext of EXT_CANDIDATES) {
    const candidate = resolved + ext;
    if (knownPaths.has(candidate)) return candidate;
  }
  return null;
}

function resolvePy(fromPath: string, spec: string, knownPaths: Set<string>): string | null {
  const fromDir = fromPath.split("/");
  fromDir.pop();
  const segs = spec.split(".");
  const isRelative = spec.startsWith(".");
  const base = isRelative ? [...fromDir, ...segs] : segs;
  for (const suffix of ["", "/__init__.py"]) {
    const candidate = base.join("/") + (suffix || ".py");
    if (knownPaths.has(candidate)) return candidate;
    if (!suffix && knownPaths.has(base.join("/") + ".py")) return base.join("/") + ".py";
  }
  const direct = base.join("/") + ".py";
  return knownPaths.has(direct) ? direct : null;
}

function buildLayers(paths: string[]): Array<{ name: string; paths: string[] }> {
  const layers = [
    { name: "Presentation / routes", match: /(^|\/)(app|pages|components|views|templates|ui)(\/|$)/ },
    { name: "Business logic", match: /(^|\/)(src\/)?(lib|core|services|domain|utils|helpers)(\/|$)/ },
    { name: "Data / persistence", match: /(^|\/)(models|db|database|repositories|storage|prisma|migrations)(\/|$)/ },
    { name: "Configuration", match: /\.(json|ya?ml|toml|ini|config\.[cm]?js|config\.[cm]?ts)$/ },
  ];
  const used = new Set<string>();
  const out: Array<{ name: string; paths: string[] }> = [];
  for (const layer of layers) {
    const hits = paths.filter((p) => layer.match.test(p) && !used.has(p)).slice(0, 12);
    hits.forEach((h) => used.add(h));
    if (hits.length) out.push({ name: layer.name, paths: hits });
  }
  return out;
}

export function buildArchitectureReport(input: {
  entries: TreeEntry[];
  snapshots: FileSnapshot[];
  sets: DependencySet[];
  languages: string[];
}): { report: ArchitectureReport; findings: Finding[] } {
  const { entries, snapshots, sets, languages } = input;
  const findings: Finding[] = [];

  const frameworks = detectFrameworks(sets);
  const { type, confidence, why } = detectAppType(sets, entries, frameworks);
  const entryPoints = detectEntryPoints(entries, sets);
  const knownPaths = new Set(entries.filter((e) => e.type === "blob").map((e) => e.path));
  const { nodes, edges } = extractModuleGraph(snapshots, knownPaths);
  const allPaths = [...knownPaths];
  const layers = buildLayers(allPaths);

  const uncertainties: string[] = [
    `Application type inferred as "${type}" (${confidence} confidence): ${why}`,
  ];
  if (!snapshots.length) {
    uncertainties.push("No source files were retrieved, so the module map is empty by necessity.");
  }

  const integrations: string[] = [];
  const depNames = new Set(sets.flatMap((s) => s.direct.map((d) => d.name)));
  for (const [needle, label] of [
    ["@aws-sdk/client-s3", "AWS S3"],
    ["firebase", "Firebase"],
    ["@prisma/client", "Prisma ORM"],
    ["mongoose", "MongoDB (mongoose)"],
    ["pg", "PostgreSQL"],
    ["mysql2", "MySQL"],
    ["redis", "Redis"],
    ["stripe", "Stripe"],
    ["@sendgrid/mail", "SendGrid"],
    ["socket.io", "WebSockets (socket.io)"],
  ] as const) {
    if (depNames.has(needle)) integrations.push(label);
  }

  const dataFlows: string[] = [];
  if (type === "fullstack-web" || type === "web-frontend") {
    dataFlows.push("Browser → routed page/component → data fetch (client or server) → rendered UI.");
  }
  if (type === "web-backend" || type === "fullstack-web" || type === "api") {
    dataFlows.push("HTTP request → route handler → service/business logic → persistence layer → response.");
  }
  if (type === "cli") dataFlows.push("Argument parsing → command handler → library calls → stdout.");
  if (!dataFlows.length) dataFlows.push("Insufficient evidence to describe a request flow.");

  if (type === "unknown") {
    findings.push(
      makeFinding({
        category: "architecture",
        severity: "info",
        title: "Application type could not be determined",
        summary: "No recognized manifest or framework evidence was retrieved within the analysis budget.",
        evidence: [],
        confidence: "low",
        status: "unavailable",
        recommendation: "Re-run with a GITHUB_TOKEN to raise the request budget, or inspect the repository manually.",
      }),
    );
  }

  return {
    report: {
      appType: type,
      appTypeConfidence: confidence,
      frameworks,
      languages,
      entryPoints,
      nodes,
      edges,
      layers,
      dataFlows,
      integrations,
      uncertainties,
    },
    findings,
  };
}
