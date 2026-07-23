import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePlan, isBlueprint } from "@jensforstmann/factorio-blueprint-tools";
import { describe, expect, it } from "vitest";
import { compile } from "./index.js";

/**
 * Golden/integration coverage (#12) for the example programs under `examples/` (#13). Each
 * example is exercised two ways:
 *   - `json: true` output is snapshotted (a stable subset — see `toStableSubset` — since the
 *     full plan already excludes non-deterministic fields like timestamps).
 *   - the default encoded blueprint string is round-tripped through `decodePlan` to assert the
 *     entities/wires it describes are non-trivial and structurally sound.
 *
 * See the README's "Updating snapshots" section for how to review intentional output changes.
 */
const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "examples");

function readExamples(): Array<{ name: string; source: string }> {
  return readdirSync(EXAMPLES_DIR)
    .filter((file) => file.endsWith(".lua"))
    .sort()
    .map((file) => ({
      name: file.replace(/\.lua$/, ""),
      source: readFileSync(join(EXAMPLES_DIR, file), "utf8"),
    }));
}

/**
 * Strips fields from a decoded/parsed plan that are stable in practice but not meaningful to
 * pin in a snapshot's diff (currently just `version`, a blueprint-format constant). Keeping
 * this narrow (rather than allowlisting fields) means new emitter output is captured by golden
 * snapshots by default.
 */
function toStableSubset(plan: unknown): unknown {
  if (typeof plan !== "object" || plan === null || !("blueprint" in plan)) {
    return plan;
  }
  const { version, ...blueprint } = (plan as { blueprint: Record<string, unknown> }).blueprint;
  return { blueprint };
}

describe("golden examples", () => {
  const examples = readExamples();

  it("finds at least 4 example programs", () => {
    expect(examples.length).toBeGreaterThanOrEqual(4);
  });

  for (const { name, source } of examples) {
    describe(name, () => {
      it("compiles to a blueprint JSON plan matching its golden snapshot", () => {
        const result = compile(source, { json: true, name });

        const plan = JSON.parse(result.blueprint);
        expect(isBlueprint(plan)).toBe(true);
        expect(toStableSubset(plan)).toMatchSnapshot();
      });

      it("decodes to a blueprint with combinators and wires", () => {
        const result = compile(source, { name });

        const decoded = decodePlan(result.blueprint);
        expect(isBlueprint(decoded)).toBe(true);
        if (!isBlueprint(decoded)) {
          return;
        }

        expect(decoded.blueprint.entities?.length ?? 0).toBeGreaterThan(0);
        expect(decoded.blueprint.entities?.length ?? 0).toBe(result.stats.combinators);
        // Combinational graphs may have no internal wires once empty I/O pads are stripped.
        expect(decoded.blueprint.wires?.length ?? 0).toBe(result.stats.wires);
      });
    });
  }
});
