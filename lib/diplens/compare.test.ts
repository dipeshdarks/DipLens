import { describe, expect, it } from "vitest";
import evalFixture from "@/lib/diplens/fixtures/evalreport_v1.json";
import { compareRuns } from "@/lib/diplens/compare";
import type { EvalReport } from "@/lib/diplens/schemas";

function run(id: string, mutate?: (r: EvalReport) => void): EvalReport {
  const copy: EvalReport = JSON.parse(JSON.stringify(evalFixture));
  copy.run.id = id;
  mutate?.(copy);
  return copy;
}

function ds(report: EvalReport): Record<string, unknown> {
  return report.dataset as Record<string, unknown>;
}

function codes(result: ReturnType<typeof compareRuns>): string[] {
  return result.findings.map((f) => f.code);
}

describe("compareRuns — single run", () => {
  it("is always comparable with no findings", () => {
    const result = compareRuns([run("a")]);
    expect(result.level).toBe("comparable");
    expect(result.comparable).toBe(true);
    expect(result.findings).toEqual([]);
  });
});

describe("compareRuns — identical runs", () => {
  it("two runs differing only by run.id are comparable", () => {
    const result = compareRuns([run("a"), run("b")]);
    expect(result.level).toBe("comparable");
    expect(result.comparable).toBe(true);
    expect(result.findings).toEqual([]);
  });
});

describe("compareRuns — blocking mismatches", () => {
  it("blocks when val.bin sha256 differs", () => {
    const result = compareRuns([
      run("a"),
      run("b", (r) => {
        ds(r).sha256 = "0".repeat(64);
      }),
    ]);
    expect(result.level).toBe("block");
    expect(result.comparable).toBe(false);
    expect(codes(result)).toContain("dataset_mismatch");
  });

  it("blocks when one run did not fingerprint the dataset", () => {
    const result = compareRuns([
      run("a"),
      run("b", (r) => {
        r.dataset = {} as EvalReport["dataset"];
      }),
    ]);
    expect(result.level).toBe("block");
    expect(codes(result)).toContain("dataset_mismatch");
    expect(result.findings.find((f) => f.code === "dataset_mismatch")?.message).toContain(
      "not fingerprinted"
    );
  });

  it("blocks when evaluation modes differ", () => {
    const result = compareRuns([
      run("a"),
      run("b", (r) => {
        r.settings.mode = "sampled";
        r.settings.eval_iters = 20;
        r.settings.seed = 42;
        if (r.metrics.validation) r.metrics.validation.mode = "sampled";
      }),
    ]);
    expect(result.level).toBe("block");
    expect(codes(result)).toContain("mode_diff");
  });

  it("blocks when batch sizes differ", () => {
    const result = compareRuns([
      run("a"),
      run("b", (r) => {
        r.settings.batch_size = 8;
      }),
    ]);
    expect(result.level).toBe("block");
    expect(codes(result)).toContain("batch_diff");
  });

  it("blocks when protocols differ", () => {
    const result = compareRuns([
      run("a"),
      run("b", (r) => {
        r.protocol = "dipai-eval/v0";
      }),
    ]);
    expect(result.level).toBe("block");
    expect(codes(result)).toContain("protocol_mismatch");
  });

  it("blocks when generation prompts differ", () => {
    const result = compareRuns([
      run("a"),
      run("b", (r) => {
        const gen = r.settings.generation;
        if (gen) gen.prompt_preview = "A totally different prompt";
      }),
    ]);
    expect(result.level).toBe("block");
    expect(codes(result)).toContain("generation_setup_mismatch");
  });

  it("blocks when tokenizer hashes differ", () => {
    const result = compareRuns([
      run("a"),
      run("b", (r) => {
        r.tokenizer.sha256 = "f".repeat(64);
      }),
    ]);
    expect(result.level).toBe("block");
    expect(codes(result)).toContain("tokenizer_mismatch");
  });

  it("falls back to vocab size when no tokenizer was fingerprinted", () => {
    const equal = compareRuns([
      run("a", (r) => {
        r.tokenizer.sha256 = null;
      }),
      run("b", (r) => {
        r.tokenizer.sha256 = null;
      }),
    ]);
    expect(codes(equal)).not.toContain("tokenizer_mismatch");

    const different = compareRuns([
      run("a", (r) => {
        r.tokenizer.sha256 = null;
        r.tokenizer.vocab_size = 544;
      }),
      run("b", (r) => {
        r.tokenizer.sha256 = null;
        r.tokenizer.vocab_size = 4104;
      }),
    ]);
    expect(different.level).toBe("block");
    expect(codes(different)).toContain("tokenizer_mismatch");
  });
});

describe("compareRuns — warnings", () => {
  it("warns (still comparable) when devices differ", () => {
    const result = compareRuns([
      run("a"),
      run("b", (r) => {
        r.environment.device_resolved = "cuda";
        r.environment.device_name = "NVIDIA GeForce RTX 2050";
      }),
    ]);
    expect(result.level).toBe("warn");
    expect(result.comparable).toBe(true);
    expect(codes(result)).toContain("device_diff");
    expect(codes(result)).not.toContain("dtype_diff");
  });

  it("warns when dtypes differ", () => {
    const result = compareRuns([
      run("a"),
      run("b", (r) => {
        r.environment.dtype_resolved = "bfloat16";
      }),
    ]);
    expect(result.level).toBe("warn");
    expect(result.comparable).toBe(true);
    expect(codes(result)).toContain("dtype_diff");
  });

  it("warns when torch versions differ", () => {
    const result = compareRuns([
      run("a"),
      run("b", (r) => {
        r.environment.torch_version = "2.9.0+cu121";
      }),
    ]);
    expect(result.level).toBe("warn");
    expect(codes(result)).toContain("torch_version_diff");
  });

  it("warns when a run is not reproducible", () => {
    const result = compareRuns([
      run("a"),
      run("b", (r) => {
        r.reproducible = false;
        r.reproducible_reasons = ["val.bin sha256 unavailable"];
      }),
    ]);
    expect(result.level).toBe("warn");
    expect(result.comparable).toBe(true);
    expect(codes(result)).toContain("not_reproducible");
  });

  it("warns when only some runs benchmarked generation", () => {
    const result = compareRuns([
      run("a"),
      run("b", (r) => {
        r.settings.generation = null;
        if (r.metrics.generation) delete (r.metrics as Record<string, unknown>).generation;
      }),
    ]);
    expect(result.level).toBe("warn");
    expect(result.comparable).toBe(true);
    expect(codes(result)).toContain("generation_partial");
  });

  it("a blocking finding outranks warnings", () => {
    const result = compareRuns([
      run("a"),
      run("b", (r) => {
        r.environment.device_resolved = "cuda";
        r.settings.batch_size = 16;
      }),
    ]);
    expect(result.level).toBe("block");
    expect(result.comparable).toBe(false);
    expect(codes(result)).toContain("batch_diff");
    expect(codes(result)).toContain("device_diff");
  });
});
