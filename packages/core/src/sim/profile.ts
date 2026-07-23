import type { CircuitGraph } from "../combinators.js";
import { lowerToCombinators } from "../combinators.js";
import { analyze } from "../analyze.js";
import { lower } from "../lower.js";
import { optimize } from "../optimize.js";
import { parse } from "../parse.js";
import { isEmptyConstant } from "./eval.js";
import { generateProgram, mulberry32 } from "./fuzz.js";

/** Cost buckets for emitter entity mix. */
export type EntityBucket =
  | "latch"
  | "mux_side"
  | "mux_merge"
  | "decider_other"
  | "arithmetic_other"
  | "constant_value"
  | "placeholder_io";

export interface ProfileRow {
  name: string;
  source: "example" | "fuzz";
  kind: string;
  combinators: number;
  wires: number;
  buckets: Record<EntityBucket, number>;
  /** Share of non-placeholder entities that are mux-related (sides + merges). */
  muxShare: number;
}

export interface ProfileReport {
  generatedAt: string;
  seed: number;
  fuzzIterations: number;
  examples: ProfileRow[];
  fuzz: ProfileRow[];
  totals: {
    programs: number;
    combinators: number;
    buckets: Record<EntityBucket, number>;
    muxShareMean: number;
  };
  opportunities: Array<{
    id: string;
    title: string;
    evidence: string;
    estimatedImpact: "high" | "medium" | "low";
  }>;
}

const EMPTY_BUCKETS = (): Record<EntityBucket, number> => ({
  latch: 0,
  mux_side: 0,
  mux_merge: 0,
  decider_other: 0,
  arithmetic_other: 0,
  constant_value: 0,
  placeholder_io: 0,
});

export function profileGraph(graph: CircuitGraph): {
  combinators: number;
  wires: number;
  buckets: Record<EntityBucket, number>;
  muxShare: number;
} {
  const hasMuxSides = graph.entities.some((entity) => entity.role === "mux-side");
  const buckets = EMPTY_BUCKETS();
  for (const entity of graph.entities) {
    if (entity.role === "latch") {
      buckets.latch += 1;
      continue;
    }
    if (entity.role === "mux-side") {
      buckets.mux_side += 1;
      continue;
    }
    if (isEmptyConstant(entity)) {
      buckets.placeholder_io += 1;
      continue;
    }
    if (entity.kind === "constant") {
      buckets.constant_value += 1;
      continue;
    }
    if (entity.kind === "decider") {
      buckets.decider_other += 1;
      continue;
    }
    if (entity.kind === "arithmetic") {
      const cond = entity.control_behavior.arithmetic_conditions as
        | { first_signal?: unknown; second_signal?: unknown; second_constant?: unknown }
        | undefined;
      const twoSignalAdd =
        cond?.first_signal !== undefined &&
        cond.second_signal !== undefined &&
        cond.second_constant === undefined;
      // Only count two-signal adds as mux merges when the graph has mux-side gates.
      if (hasMuxSides && twoSignalAdd) {
        buckets.mux_merge += 1;
      } else {
        buckets.arithmetic_other += 1;
      }
      continue;
    }
    buckets.arithmetic_other += 1;
  }
  const combinators = graph.entities.length;
  const real = Math.max(combinators - buckets.placeholder_io, 1);
  const muxRelated = buckets.mux_side + buckets.mux_merge;
  return {
    combinators,
    wires: graph.wires.length,
    buckets,
    muxShare: muxRelated / real,
  };
}


function compileGraph(source: string): CircuitGraph {
  return lowerToCombinators(optimize(lower(analyze(parse(source)))));
}

function profileSource(
  name: string,
  source: string,
  origin: "example" | "fuzz",
  kind: string,
): ProfileRow {
  const stats = profileGraph(compileGraph(source));
  return { name, source: origin, kind, ...stats };
}

function sumBuckets(rows: ProfileRow[]): Record<EntityBucket, number> {
  const totals = EMPTY_BUCKETS();
  for (const row of rows) {
    for (const key of Object.keys(totals) as EntityBucket[]) {
      totals[key] += row.buckets[key];
    }
  }
  return totals;
}

function buildOpportunities(
  examples: ProfileRow[],
  fuzz: ProfileRow[],
  totals: Record<EntityBucket, number>,
): ProfileReport["opportunities"] {
  const all = [...examples, ...fuzz];
  const real = (Object.entries(totals) as Array<[EntityBucket, number]>)
    .filter(([k]) => k !== "placeholder_io")
    .reduce((s, [, n]) => s + n, 0);
  const muxPct = real === 0 ? 0 : ((totals.mux_side + totals.mux_merge) / real) * 100;
  const latchPct = real === 0 ? 0 : (totals.latch / real) * 100;
  const allEntities = real + totals.placeholder_io;
  const phPct = allEntities === 0 ? 0 : (totals.placeholder_io / allEntities) * 100;

  const whileRows = all.filter((r) => r.kind === "while" || r.name.includes("while"));
  const avgWhile =
    whileRows.length === 0
      ? 0
      : whileRows.reduce((s, r) => s + r.combinators, 0) / whileRows.length;

  const opportunities: ProfileReport["opportunities"] = [];

  if (muxPct >= 20) {
    opportunities.push({
      id: "mux-tricks",
      title: "Cheaper mux / enable-hold (selector or multi-condition)",
      evidence: `Mux-related entities are ${muxPct.toFixed(0)}% of non-placeholder combinators (sides=${totals.mux_side}, merges=${totals.mux_merge}).`,
      estimatedImpact: "high",
    });
  }

  if (latchPct >= 10) {
    opportunities.push({
      id: "latch-tricks",
      title: "Tighter latches (EACH / SR / absorb more into latch)",
      evidence: `Latches are ${latchPct.toFixed(0)}% of real entities (${totals.latch} total). While-kind programs avg ${avgWhile.toFixed(1)} combinators.`,
      estimatedImpact: "high",
    });
  }

  if (phPct >= 8) {
    opportunities.push({
      id: "drop-placeholders",
      title: "Drop empty I/O placeholder constants from blueprints",
      evidence: `Placeholders are ${phPct.toFixed(0)}% of all entities (${totals.placeholder_io}).`,
      estimatedImpact: "medium",
    });
  }

  opportunities.push({
    id: "fold-arith-decider",
    title: "Further arith/decider folding (constants, shared cmps)",
    evidence: `Non-mux arith=${totals.arithmetic_other}, other deciders=${totals.decider_other}.`,
    estimatedImpact: "medium",
  });

  opportunities.push({
    id: "selector-combinator",
    title: "Emit Factorio selector-combinator where it replaces gate+merge",
    evidence: "Requires VM selector support; prove with fuzz before landing.",
    estimatedImpact: "high",
  });

  return opportunities;
}

/** Build an optimization profile for given examples + a fuzz corpus. */
export function buildProfileReport(opts: {
  examples: Array<{ name: string; source: string }>;
  seed?: number;
  fuzzIterations?: number;
}): ProfileReport {
  const seed = opts.seed ?? 0xc17c_51_7;
  const fuzzIterations = opts.fuzzIterations ?? 200;
  const examples = opts.examples.map((ex) =>
    profileSource(ex.name, ex.source, "example", "example"),
  );
  const rand = mulberry32(seed);
  const fuzz: ProfileRow[] = [];
  for (let i = 0; i < fuzzIterations; i += 1) {
    const prog = generateProgram(rand);
    fuzz.push(profileSource(`fuzz-${i}-${prog.kind}`, prog.source, "fuzz", prog.kind));
  }
  const all = [...examples, ...fuzz];
  const buckets = sumBuckets(all);
  const combinators = all.reduce((s, r) => s + r.combinators, 0);
  const muxShareMean = all.reduce((s, r) => s + r.muxShare, 0) / (all.length || 1);

  return {
    generatedAt: new Date().toISOString(),
    seed,
    fuzzIterations,
    examples,
    fuzz,
    totals: {
      programs: all.length,
      combinators,
      buckets,
      muxShareMean,
    },
    opportunities: buildOpportunities(examples, fuzz, buckets),
  };
}
