/* Source, sink and sanitizer catalogs.
 *
 * Every pattern here names a real API. A match is evidence of a *candidate*
 * data-flow endpoint, never a confirmed exploit — the report states that.
 */

import type { TaintCategory } from "@/lib/analysis/engine/types";
import type { LanguageId } from "@/lib/analysis/parsers/loader";

export type SinkSpec = {
  category: TaintCategory;
  /** Dotted callee pattern matched case-insensitively against the callee as written. */
  callee: RegExp;
  /**
   * Which argument must carry taint for this to be a candidate.
   * "first" — the tainted value must be the primary operand (SQL statement,
   *           command string, path, URL, evaluated code).
   * "any"   — any tainted argument is interesting (HTML payloads, template data).
   * Pair with `shell` for command execution, which additionally allows a
   * tainted argument anywhere when an explicit shell wrapper (`sh -c`) is present.
   */
  argRule: "first" | "any";
  /** Command-execution guard: argv arrays with a clean binary are not injection. */
  shell?: boolean;
  note: string;
  remediation: string;
};

export type SourceSpec = {
  kind: string;
  callee: RegExp;
  trust: "untrusted" | "environment" | "mixed";
};

export type SanitizerSpec = {
  name: RegExp;
  category: TaintCategory | "any";
};

const TS_SINKS: SinkSpec[] = [
  {
    category: "sql",
    callee: /(^|\.)(query|execute|raw|queryRow|execSync|knex\.raw)\s*$/,
    argRule: "first",
    note: "database query API",
    remediation: "Use parameterized queries / bound parameters instead of interpolating values into the statement.",
  },
  {
    category: "shell",
    callee: /(^|\.)(exec|execSync|execFile|execFileSync|spawn|spawnSync|child_process\.(exec|spawn))\s*$/,
    argRule: "first",
    shell: true,
    note: "process execution API",
    remediation: "Avoid a shell. Pass argv arrays to spawn/execFile and validate each argument against an allow-list.",
  },
  {
    category: "code-eval",
    callee: /(^|\.)(eval|runInThisContext|runInNewContext|runInContext|compileFunction|Function)\s*$/,
    argRule: "first",
    note: "dynamic code evaluation",
    remediation: "Replace dynamic evaluation with a dispatch table or explicit branching over known inputs.",
  },
  {
    category: "path",
    callee: /(^|\.)(readFile|readFileSync|writeFile|writeFileSync|appendFile|createReadStream|createWriteStream|open|openSync|unlink|unlinkSync|rmdir|rmdirSync|stat|statSync)\s*$/,
    argRule: "first",
    note: "filesystem access",
    remediation: "Resolve the path against a fixed root and reject any result that escapes it (path traversal).",
  },
  {
    category: "ssrf",
    callee: /(^|\.)(fetch|axios|got|superagent|node-fetch|request)(\.|\s*$)|(^|\.)axios\.(get|post|put|patch|delete|head)\s*$|(http|https)\.(get|request)\s*$/,
    argRule: "first",
    note: "outbound HTTP call",
    remediation: "Validate the destination against an allow-list of hosts/schemes; never build a URL from raw input.",
  },
  {
    category: "xss",
    callee: /(innerHTML|outerHTML|insertAdjacentHTML|document\.write|dangerouslySetInnerHTML)\s*(\(|$)/,
    argRule: "any",
    note: "HTML injection sink",
    remediation: "Set text content, or sanitize with a vetted HTML sanitizer before assignment.",
  },
  {
    category: "redirect",
    callee: /(redirect|location\.assign|location\.replace)\s*$/,
    argRule: "first",
    note: "open redirect sink",
    remediation: "Map the target through a fixed route table; never redirect to a raw user-supplied URL.",
  },
  {
    category: "deserialization",
    callee: /(^|\.)(unserialize|yaml\.load|YAML\.load|Deserialize|deserialize|revive)\s*$/,
    argRule: "first",
    note: "deserialization sink",
    remediation: "Use a schema-validated parser with a safe loader; never deserialize untrusted bytes into code.",
  },
  {
    category: "template",
    callee: /\.(render|compile|execute|replace)\s*$/,
    argRule: "any",
    note: "template compilation",
    remediation: "Pass data as template variables, not as template source.",
  },
];

const PY_SINKS: SinkSpec[] = [
  {
    category: "sql",
    callee: /(^|\.)(execute|executemany|executescript|execute_sql|raw)\s*$/,
    argRule: "first",
    note: "database cursor execute",
    remediation: "Use bound parameters (%s / ? placeholders) instead of interpolating values into the SQL string.",
  },
  {
    category: "shell",
    callee: /(^|\.)(system|popen|check_output|check_call|getoutput|getstatusoutput)\s*$|(^|\.)subprocess\.(call|run)\s*$/,
    argRule: "first",
    shell: true,
    note: "subprocess execution",
    remediation: "Use subprocess with shell=False and an argv list; validate each argument.",
  },
  {
    category: "code-eval",
    callee: /(^|\.)(eval|exec|compile|__import__|import_module)\s*$/,
    argRule: "first",
    note: "dynamic code evaluation",
    remediation: "Replace with an explicit dispatch on known values.",
  },
  {
    category: "path",
    callee: /(^|\.)(open|remove|unlink|rmdir|rmtree|rename|copyfile|move)\s*$/,
    argRule: "first",
    note: "filesystem access",
    remediation: "Resolve against a fixed base directory and reject traversal outside it.",
  },
  {
    category: "ssrf",
    callee: /(^|\.)(urlopen|urlretrieve|Request)\s*$|(^|\.)requests\.(get|post|put|delete|head|request)\s*$|(http|https)\.(client\.)?(HTTPConnection|HTTPSConnection)\s*$|(^|\.)urllib\.request\.(urlopen|Request)\s*$/,
    argRule: "first",
    note: "outbound HTTP call",
    remediation: "Allow-list destination hosts and schemes before issuing the request.",
  },
  {
    category: "deserialization",
    callee: /(^|\.)(loads|Unpickler|read_value|yaml\.unsafe_load|yaml\.load)\s*$/,
    argRule: "first",
    note: "deserialization sink",
    remediation: "Use a safe loader (yaml.safe_load) and never unpickle untrusted data.",
  },
  {
    category: "xss",
    callee: /(mark_safe|format_html|__html__)\s*(\(|$)/,
    argRule: "any",
    note: "autoescape bypass",
    remediation: "Do not mark untrusted values as safe; let the template engine escape them.",
  },
];

const GO_SINKS: SinkSpec[] = [
  {
    category: "sql",
    callee: /\.(Query|QueryRow|QueryContext|Exec|ExecContext|Prepare|PrepareContext)\s*$/,
    argRule: "first",
    note: "database handle query",
    remediation: "Use ? placeholders with arguments rather than fmt.Sprintf-built statements.",
  },
  {
    category: "shell",
    callee: /(^|\.)(Command|CommandContext)\s*$/,
    argRule: "first",
    shell: true,
    note: "os/exec command construction",
    remediation: "Pass the binary and each argument separately; never invoke a shell with a concatenated string.",
  },
  {
    category: "path",
    callee: /(^|\.)(Open|Create|OpenFile|ReadFile|WriteFile|Remove|Rename|Stat)\s*$/,
    argRule: "first",
    note: "filesystem access",
    remediation: "Resolve the path against a fixed root and reject results that escape it.",
  },
  {
    category: "ssrf",
    callee: /(^|\.)(http|https|client|httpClient|c)\.(Get|Post|PostForm|Head|Do)\s*$|(^|\.)(Do)\s*$/,
    argRule: "first",
    note: "net/http outbound call",
    remediation: "Allow-list the destination host before issuing the request.",
  },
  {
    category: "template",
    callee: /\.(Execute|ExecuteTemplate)\s*$/,
    argRule: "any",
    note: "text/template execution",
    remediation: "Use html/template for any HTML output so auto-escaping applies.",
  },
];
const TS_SOURCES: SourceSpec[] = [
  { kind: "http-request", callee: /\b(req|request|ctx|context|event)\.(query|params|body|headers|cookies)\b/i, trust: "untrusted" },
  { kind: "http-request", callee: /event\.(queryStringParameters|pathParameters|body)/i, trust: "untrusted" },
  { kind: "document", callee: /\b(document\.(cookie|URL|documentElement)|location\.(search|hash|href))\b/, trust: "untrusted" },
  { kind: "storage", callee: /\b(localStorage|sessionStorage)\.getItem\b/, trust: "untrusted" },
  { kind: "environment", callee: /\bprocess\.env\b/, trust: "environment" },
  { kind: "cli-argv", callee: /\bprocess\.argv\b/, trust: "untrusted" },
];

const PY_SOURCES: SourceSpec[] = [
  { kind: "http-request", callee: /\brequest\.(GET|POST|body|args|form|json|FILES|META|COOKIES)\b/, trust: "untrusted" },
  { kind: "http-request", callee: /\b(request|req)\.(query_params|path_params|headers|cookies)\b/, trust: "untrusted" },
  { kind: "environment", callee: /\bos\.environ\b|\bgetenv\b/, trust: "environment" },
  { kind: "cli-argv", callee: /\bsys\.argv\b/, trust: "untrusted" },
  { kind: "cli-stdin", callee: /\binput\s*\(/, trust: "untrusted" },
];

const GO_SOURCES: SourceSpec[] = [
  { kind: "http-request", callee: /\br\.(URL|Form|FormValue|PostFormValue|Body|Header)\b/, trust: "untrusted" },
  { kind: "http-request", callee: /\br\.URL\.Query\(\)/, trust: "untrusted" },
  { kind: "environment", callee: /\bos\.Getenv\b/, trust: "environment" },
  { kind: "cli-flag", callee: /\bflag\.\w+\s*\(/, trust: "untrusted" },
];

const TS_SANITIZERS: SanitizerSpec[] = [
  { name: /(^|[^\w.])(escape|sanitize|sanitise|encodeURI|encodeURIComponent|he\.escape|validator\.escape)\s*\(/, category: "any" },
  { name: /(parameteriz|bind|placeholder)/i, category: "sql" },
];

const PY_SANITIZERS: SanitizerSpec[] = [
  { name: /(shlex\.quote|html\.escape|bleach\.clean|markupsafe\.escape|urlquote|quote_plus)\s*\(/, category: "any" },
  { name: /(^|[^\w.])(escape)\s*\(/, category: "any" },
];

const GO_SANITIZERS: SanitizerSpec[] = [
  { name: /(strconv\.Quote|url\.QueryEscape|url\.PathEscape|html\.EscapeString|template\.HTMLEscapeString)\s*\(/, category: "any" },
];

export function sinksFor(language: LanguageId): SinkSpec[] {
  switch (language) {
    case "typescript":
    case "tsx":
    case "javascript":
      return TS_SINKS;
    case "python":
      return PY_SINKS;
    case "go":
      return GO_SINKS;
    default:
      return [];
  }
}

export function sourcesFor(language: LanguageId): SourceSpec[] {
  switch (language) {
    case "typescript":
    case "tsx":
    case "javascript":
      return TS_SOURCES;
    case "python":
      return PY_SOURCES;
    case "go":
      return GO_SOURCES;
    default:
      return [];
  }
}

export function sanitizersFor(language: LanguageId): SanitizerSpec[] {
  switch (language) {
    case "typescript":
    case "tsx":
    case "javascript":
      return TS_SANITIZERS;
    case "python":
      return PY_SANITIZERS;
    case "go":
      return GO_SANITIZERS;
    default:
      return [];
  }
}
