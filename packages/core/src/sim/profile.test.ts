import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildProfileReport } from "./profile.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = join(HERE, "..", "..", "..", "..", "examples");
const REPORT_PATH = join(HERE, "opt-profile.json");

function loadExamples(): Array<{ name: string; source: string }> {
  return readdirSync(EXAMPLES_DIR)
    .filter((file: string) => file.endsWith(".lua"))
    .sort()
    .map((file: string) => ({
      name: file.replace(/\.lua$/, ""),
      source: readFileSync(join(EXAMPLES_DIR, file), "utf8"),
    }));
}

describe("opt profile", () => {
  it("profiles examples + 200 fuzz programs and writes opt-profile.json", () => {
    const report = buildProfileReport({
      examples: loadExamples(),
      seed: 0xc17c_51_7,
      fuzzIterations: 200,
    });

    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

    expect(report.examples.length).toBeGreaterThanOrEqual(6);
    expect(report.fuzz).toHaveLength(200);
    expect(report.totals.combinators).toBeGreaterThan(0);
    expect(report.opportunities.length).toBeGreaterThan(0);

    // Sanity: mux or latch should show up as a material cost bucket.
    const { buckets } = report.totals;
    expect(buckets.latch + buckets.mux_side + buckets.mux_merge).toBeGreaterThan(0);
  });
});
