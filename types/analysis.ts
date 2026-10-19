/* ---------- evidence & findings ---------- */

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Confidence = "high" | "medium" | "low";
export type FindingStatus = "verified" | "heuristic" | "unavailable";

export type FindingCategory =
  | "architecture"
  | "dependencies"
  | "code-quality"
  | "security"
  | "testing"
  | "documentation"
  | "governance"
  | "activity";

export type Evidence = {
  path?: string;
  startLine?: number;
  endLine?: number;
  excerpt?: string;
  sourceUrl?: string;
};

export type Finding = {
  id: string;
  category: FindingCategory;
  severity: Severity;
  title: string;
  summary: string;
  evidence: Evidence[];
  confidence: Confidence;
  status: FindingStatus;
  recommendation?: string;
};

/* ---------- discovery ---------- */

export type TreeEntry = {
  path: string;
  type: "blob" | "tree" | "commit";
  size?: number;
};

export type FileSnapshot = {
  path: string;
  content: string;
  size: number;
  /** True when the source file exceeded the byte budget and only a prefix was kept. */
  truncated: boolean;
};

export type SkippedFile = { path: string; reason: "too-large" | "budget-exhausted" | "binary" | "fetch-failed" };

export type Ecosystem =
  | "javascript"
  | "python"
  | "rust"
  | "go"
  | "java"
  | "ruby"
  | "php"
  | "dotnet"
  | "other";

/* ---------- dependencies ---------- */

export type Dependency = {
  name: string;
  range: string;
  dev: boolean;
};

export type DependencySet = {
  ecosystem: Ecosystem;
  manifestPath: string;
  direct: Dependency[];
  lockfilePath: string | null;
  packageManager: string | null;
  runtimes: Record<string, string>;
  scripts: Record<string, string>;
  /** True when the manifest declares no version constraint for a dependency. */
  unconstrainedCount: number;
};

export type DependencyReport = {
  sets: DependencySet[];
  notes: string[];
  /** Diplens does not run vulnerability scans; no advisory source is queried. */
  vulnerabilityScanPerformed: boolean;
  outdatedPackagesChecked: boolean;
};

/* ---------- architecture ---------- */

export type AppType =
  | "web-frontend"
  | "web-backend"
  | "fullstack-web"
  | "api"
  | "cli"
  | "library"
  | "mobile"
  | "monorepo"
  | "static-site"
  | "unknown";

export type EntryPoint = { path: string; basis: string };

export type ModuleNode = { id: string; kind: "file" | "package" | "external"; importedBy?: number };
export type ModuleEdge = { from: string; to: string; count: number };

export type ArchitectureReport = {
  appType: AppType;
  appTypeConfidence: Confidence;
  frameworks: string[];
  languages: string[];
  entryPoints: EntryPoint[];
  nodes: ModuleNode[];
  edges: ModuleEdge[];
  layers: Array<{ name: string; paths: string[] }>;
  dataFlows: string[];
  integrations: string[];
  uncertainties: string[];
};

/* ---------- security ---------- */

export type SecretMatch = {
  path: string;
  line: number;
  kind: string;
  /** Redacted placeholder — the secret value itself is never returned. */
  redacted: string;
};

export type SecurityReport = {
  secrets: SecretMatch[];
  policyFiles: { securityPolicy: string | null; dependabot: string | null; codeowners: string | null };
  workflowAudit: Array<{
    path: string;
    hasPermissionsBlock: boolean;
    permissiveWrite: boolean;
    riskyTriggers: string[];
    untrustedContextUse: boolean;
  }>;
  codeScanning: { status: "available" | "inaccessible" | "not-enabled" | "unknown"; note: string };
  envExamplePresent: boolean;
  notes: string[];
};

/* ---------- quality ---------- */

export type QualityReport = {
  inspectedFiles: number;
  largestFiles: Array<{ path: string; size: number }>;
  todoCounts: Array<{ path: string; todos: number; line: number }>;
  lintConfig: string | null;
  formatConfig: string | null;
  typeCheckConfig: string | null;
  strictTyping: boolean | null;
  notes: string[];
};

/* ---------- activity ---------- */

export type CommitSummary = {
  sha: string;
  message: string;
  author: string | null;
  date: string;
  htmlUrl: string;
};

export type ActivityReport = {
  recentCommits: CommitSummary[];
  commitWindowDays: number;
  commitSampleLimited: boolean;
  tags: string[];
  branchCount: number | null;
  observationNote: string;
};

/* ---------- tests & CI ---------- */

export type TestsCiReport = {
  testFiles: string[];
  testFileCount: number;
  testFileSampleLimited: boolean;
  runnerConfig: string | null;
  testScripts: Array<{ name: string; command: string }>;
  workflows: Array<{ name: string; path: string; triggers: string[]; testSteps: string[]; hasPermissions: boolean }>;
  coverageConfig: string | null;
  buildVerifiedByExecution: false;
  notes: string[];
};

/* ---------- health (deep model) ---------- */

export type IndicatorStatus = "good" | "partial" | "missing" | "unknown";

export type DeepIndicator = {
  name: string;
  status: IndicatorStatus;
  detail: string;
  /** Which data the indicator is derived from — null when data is unavailable. */
  basis: string | null;
};

/* ---------- coverage ---------- */

export type CoverageStatus = "complete" | "partial" | "unavailable";

export type CategoryCoverage = {
  category: AnalysisCategory;
  status: CoverageStatus;
  inspected: number;
  total?: number;
  note?: string;
};

export type Coverage = {
  treeTruncated: boolean;
  treeEntries: number;
  treeStatus: CoverageStatus;
  filesInspected: string[];
  filesSkipped: SkippedFile[];
  categories: CategoryCoverage[];
  budget: AnalysisBudgetView;
  apiRequestsUsed: number;
  disclosure: string;
};

export type AnalysisBudgetView = {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalChars: number;
  maxTreeEntries: number;
  maxDepth: number;
};

/* ---------- orchestrator result ---------- */

export type AnalysisCategory =
  | "discovery"
  | "architecture"
  | "dependencies"
  | "security"
  | "quality"
  | "activity"
  | "testing";

export type DeepAnalysis = {
  analyzedAt: string;
  overall: CoverageStatus;
  sectionStatus: Record<AnalysisCategory, { status: CoverageStatus; note?: string }>;
  discovery: {
    defaultBranch: string;
    commitSha: string | null;
    ecosystems: Ecosystem[];
    importantFiles: string[];
    directories: string[];
    treeTruncated: boolean;
  };
  /** Cap-limited path list for the file explorer UI (never the whole tree). */
  browsePaths: string[];
  architecture: ArchitectureReport;
  dependencies: DependencyReport;
  security: SecurityReport;
  quality: QualityReport;
  activity: ActivityReport;
  testsCi: TestsCiReport;
  findings: Finding[];
  indicators: DeepIndicator[];
  coverage: Coverage;
};
