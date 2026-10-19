/** Secret-redaction helpers. Values detected as secrets are never returned to callers. */

export type SecretPattern = { kind: string; re: RegExp };

export const SECRET_PATTERNS: SecretPattern[] = [
  { kind: "AWS access key ID", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { kind: "GitHub fine-grained PAT", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { kind: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "Stripe secret key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: "OpenAI-style key", re: /\bsk-[A-Za-z0-9]{32,}\b/g },
  { kind: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { kind: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g },
];

/** Replace every secret-like token with a fixed placeholder. Never returns the original value. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const p of SECRET_PATTERNS) {
    out = out.replace(p.re, (m) => placeholder(p.kind, m));
  }
  return out;
}

/** Mask a single token: keep at most the first 4 characters for correlation. */
export function placeholder(kind: string, token: string): string {
  const head = token.length > 8 ? token.slice(0, 4) : "";
  return `[REDACTED ${kind}${head ? ` ${head}` : ""}]`;
}

/** Check a line for secret-like content without ever exposing the matched value. */
export function scanLine(line: string): Array<{ kind: string; redacted: string }> {
  const hits: Array<{ kind: string; redacted: string }> = [];
  for (const p of SECRET_PATTERNS) {
    p.re.lastIndex = 0;
    const m = p.re.exec(line);
    if (m) hits.push({ kind: p.kind, redacted: placeholder(p.kind, m[0]) });
  }
  return hits;
}
