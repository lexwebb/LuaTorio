import { analyze } from "../analyze.js";
import { lowerToCombinators } from "../combinators.js";
import { lower } from "../lower.js";
import { optimize } from "../optimize.js";
import { parse } from "../parse.js";
import { reference } from "./reference.js";
import { simulate } from "./simulate.js";

/** Mulberry32 — small deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length) as number] as T;
}

function randInt(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

export type FuzzProgramKind = "combinational" | "counter" | "while" | "for";

export interface GeneratedProgram {
  source: string;
  kind: FuzzProgramKind;
  /** Static inputs used every tick (empty for programs with no inputs). */
  inputs: Record<string, number>;
  /** Suggested tick count for equivalence. */
  ticks: number;
}

/**
 * Generate a small valid LuaTorio program in the supported subset.
 * Prefer correctness over coverage breadth.
 */
export function generateProgram(rand: () => number): GeneratedProgram {
  const kind = pick(rand, ["combinational", "counter", "while", "for"] as const);

  switch (kind) {
    case "combinational": {
      const a = randInt(rand, -5, 5);
      const b = randInt(rand, -5, 5);
      const op = pick(rand, ["+", "-", "*"] as const);
      return {
        kind,
        source: `
local x = input("signal-A")
local y = input("signal-B")
output("signal-C", x ${op} y)
`.trim(),
        inputs: { "signal-A": a, "signal-B": b },
        ticks: 3,
      };
    }
    case "counter": {
      const ticks = randInt(rand, 1, 12);
      return {
        kind,
        source: `
local x = 0
x = x + 1
output("signal-A", x)
`.trim(),
        inputs: {},
        ticks,
      };
    }
    case "while": {
      const lim = randInt(rand, 0, 8);
      return {
        kind,
        source: `
local i = 0
local lim = input("signal-L")
while i < lim do
  i = i + 1
  tick()
end
output("signal-A", i)
`.trim(),
        inputs: { "signal-L": lim },
        ticks: lim + 4,
      };
    }
    case "for": {
      const n = randInt(rand, 1, 6);
      return {
        kind,
        source: `
local sum = 0
for i = 1, ${n} do
  sum = sum + i
  tick()
end
output("signal-A", sum)
`.trim(),
        inputs: {},
        ticks: n + 4,
      };
    }
    default: {
      const unreachable: never = kind;
      throw new Error(`fuzz: bad kind '${String(unreachable)}'`);
    }
  }
}

export interface FuzzCaseResult {
  ok: boolean;
  source: string;
  inputs: Record<string, number>;
  ticks: number;
  simulated?: Record<string, number>[];
  expected?: Record<string, number>[];
  error?: string;
}

function compileGraph(source: string) {
  const module = optimize(lower(analyze(parse(source))));
  return lowerToCombinators(module);
}

/**
 * Compile → simulate vs reference for one generated program.
 */
export function runFuzzCase(program: GeneratedProgram): FuzzCaseResult {
  try {
    const graph = compileGraph(program.source);
    const sim = simulate(graph, { ticks: program.ticks, inputs: program.inputs });
    const ref = reference(program.source, { ticks: program.ticks, inputs: program.inputs });
    const simulated = sim.ticks.map((t) => t.outputs);
    const expected = ref.ticks.map((t) => t.outputs);
    for (let i = 0; i < program.ticks; i += 1) {
      const a = simulated[i] ?? {};
      const b = expected[i] ?? {};
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const key of keys) {
        if ((a[key] ?? 0) !== (b[key] ?? 0)) {
          return {
            ok: false,
            source: program.source,
            inputs: program.inputs,
            ticks: program.ticks,
            simulated,
            expected,
            error: `tick ${i}: ${key}: sim=${a[key] ?? 0} ref=${b[key] ?? 0}`,
          };
        }
      }
    }
    return {
      ok: true,
      source: program.source,
      inputs: program.inputs,
      ticks: program.ticks,
      simulated,
      expected,
    };
  } catch (err) {
    return {
      ok: false,
      source: program.source,
      inputs: program.inputs,
      ticks: program.ticks,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface FuzzOptions {
  seed: number;
  iterations: number;
}

/**
 * Run `iterations` deterministic fuzz cases. Returns the first failure, or undefined if all pass.
 */
export function runFuzz(opts: FuzzOptions): FuzzCaseResult | undefined {
  const rand = mulberry32(opts.seed);
  for (let i = 0; i < opts.iterations; i += 1) {
    const program = generateProgram(rand);
    const result = runFuzzCase(program);
    if (!result.ok) {
      return { ...result, error: `case ${i}: ${result.error ?? "mismatch"}` };
    }
  }
  return undefined;
}
