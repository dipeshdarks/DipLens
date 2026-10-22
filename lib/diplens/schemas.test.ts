import { describe, expect, it } from "vitest";
import archFixture from "@/lib/generated/architecture.json";
import evalFixture from "@/lib/diplens/fixtures/evalreport_v1.json";
import {
  importArchMeta,
  importEvalReport,
  importJsonText,
} from "@/lib/diplens/schemas";

describe("importArchMeta", () => {
  it("accepts the shipped architecture fixture", () => {
    const result = importArchMeta(archFixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.schema).toBe("dipai-archmeta");
    expect(result.data.components).toHaveLength(13);
    expect(result.data.params.total).toBe(21113344);
    expect(result.data.params.components.map((c) => c.id)).toContain("token_embedding");
    expect(result.data.flow.length).toBeGreaterThan(0);
    expect(result.data.block_flow?.length).toBe(4);
  });

  it("preserves unknown fields (passthrough contract)", () => {
    const withExtras = {
      ...JSON.parse(JSON.stringify(archFixture)),
      future_top_level: { anything: true },
      components: archFixture.components.map((c) => ({ ...c, future_field: 42 })),
    };
    const result = importArchMeta(withExtras);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data as Record<string, unknown>).future_top_level).toEqual({ anything: true });
    expect((result.data.components[0] as Record<string, unknown>).future_field).toBe(42);
  });

  it("rejects a non-object payload", () => {
    const result = importArchMeta([1, 2, 3]);
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    if (result.ok) return;
    expect(result.message).toContain("not a JSON object");
  });

  it("reports invalid when schema name does not match", () => {
    const result = importArchMeta({ schema: "dipai-evalreport", schema_version: 1 });
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    if (result.ok) return;
    expect(result.message).toContain("dipai-evalreport");
  });

  it("reports unsupported for a future schema_version", () => {
    const result = importArchMeta({
      schema: "dipai-archmeta",
      schema_version: 99,
    });
    expect(result).toMatchObject({ ok: false, kind: "unsupported" });
    if (result.ok) return;
    expect(result.message).toContain("version 99");
    expect(result.message).toContain("expected version 1");
  });

  it("reports invalid with the failing path when required fields are missing", () => {
    const broken = JSON.parse(JSON.stringify(archFixture));
    delete broken.model;
    const result = importArchMeta(broken);
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    if (result.ok) return;
    expect(result.message).toContain("model");
  });

  it("rejects an invalid component kind", () => {
    const broken = JSON.parse(JSON.stringify(archFixture));
    broken.components[0].kind = "quantum";
    const result = importArchMeta(broken);
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    if (result.ok) return;
    expect(result.message).toContain("components.0.kind");
  });
});

describe("importEvalReport", () => {
  it("accepts the shipped eval fixture", () => {
    const result = importEvalReport(evalFixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.schema).toBe("dipai-evalreport");
    expect(result.data.run.status).toBe("completed");
    expect(result.data.metrics.validation?.perplexity).toBeCloseTo(602.4862380340327, 6);
    expect(result.data.reproducible).toBe(true);
    expect(result.data.warnings.map((w) => w.code)).toEqual(["cpu_only_run"]);
    expect(result.data.errors).toEqual([]);
  });

  it("accepts an early-failure dataset placeholder ({})", () => {
    const mutated = JSON.parse(JSON.stringify(evalFixture));
    mutated.dataset = {};
    mutated.reproducible = false;
    mutated.reproducible_reasons = ["val.bin sha256 unavailable"];
    const result = importEvalReport(mutated);
    expect(result.ok).toBe(true);
  });

  it("accepts a failed run with errors", () => {
    const mutated = JSON.parse(JSON.stringify(evalFixture));
    mutated.run.status = "failed";
    mutated.errors = [{ stage: "compat", message: "checkpoint file not found" }];
    const result = importEvalReport(mutated);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.run.status).toBe("failed");
    expect(result.data.errors[0]?.stage).toBe("compat");
  });

  it("preserves unknown fields (passthrough contract)", () => {
    const withExtras = {
      ...JSON.parse(JSON.stringify(evalFixture)),
      future_metric: { score: 1 },
    };
    const result = importEvalReport(withExtras);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data as Record<string, unknown>).future_metric).toEqual({ score: 1 });
  });

  it("reports invalid for a wrong schema name", () => {
    const result = importEvalReport({ schema: "something-else", schema_version: 1 });
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    if (result.ok) return;
    expect(result.message).toContain("something-else");
  });

  it("reports unsupported for schema_version 2", () => {
    const result = importEvalReport({
      schema: "dipai-evalreport",
      schema_version: 2,
    });
    expect(result).toMatchObject({ ok: false, kind: "unsupported" });
    if (result.ok) return;
    expect(result.message).toContain("version 2");
  });

  it("reports invalid when run.status is an unknown value", () => {
    const broken = JSON.parse(JSON.stringify(evalFixture));
    broken.run.status = "running";
    const result = importEvalReport(broken);
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    if (result.ok) return;
    expect(result.message).toContain("run.status");
  });

  it("reports invalid when metrics is missing", () => {
    const broken = JSON.parse(JSON.stringify(evalFixture));
    delete broken.metrics;
    const result = importEvalReport(broken);
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    if (result.ok) return;
    expect(result.message).toContain("metrics");
  });
});

describe("importJsonText", () => {
  it("parses valid JSON text and dispatches to the importer", () => {
    const result = importJsonText(JSON.stringify(evalFixture), importEvalReport);
    expect(result.ok).toBe(true);
  });

  it("reports invalid for broken JSON text", () => {
    const result = importJsonText("{not json", importEvalReport);
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    if (result.ok) return;
    expect(result.message).toContain("not valid JSON");
  });
});
