import type { IRModule, IRNode } from "./ir.js";
import {
  fusedCmpForSelect,
  isBooleanOrSelect,
  isBooleanValued,
  literalValueOf,
  matchAndOrMux,
  matchMemoryStore,
  memPlusDelta,
  soleUseCmp,
} from "./ir-match.js";

type CmpOp = Extract<IRNode, { kind: "cmp" }>["op"];

/** The Factorio combinator families a v1/v2 IR node can lower to. */
export type CombinatorKind = "constant" | "arithmetic" | "decider" | "selector";

/**
 * Optional role for layout / expansion:
 * - `latch` — memory cell; feedback cycles may break here during layout
 * - `mux-side` — secondary half of a `select` expansion (not the merge entity)
 */
export type CircuitRole = "latch" | "mux-side";

/**
 * An unpositioned circuit entity: *what* combinator to place and how its `control_behavior`
 * is configured, but not *where* (layout) or how it's serialized (emit).
 */
export interface CircuitEntity {
  /** IR node id, synthetic `__oN` output marker, or mux-side id like `__t4__gate`. */
  id: string;
  kind: CombinatorKind;
  /** Factorio entity name, e.g. `"arithmetic-combinator"`. */
  name: string;
  control_behavior: Record<string, unknown>;
  /** Output signal name this entity produces (a temp signal like `__t3`, or a user signal). */
  outputSignal: string;
  role?: CircuitRole;
  /**
   * Human-facing name for UI (Lua local, port signal, “Δ → i”, …).
   * Does not affect Factorio emit — wire signals stay `__tN`.
   */
  label?: string;
  /**
   * Multi-signal latch Q seed for the simulator (signal name → count).
   * Used when a decider latch holds more than `outputSignal` (fused `__run`+induction).
   * Init constants on the wire still use literal filter ids so they do not pollute copies.
   */
  latchSeeds?: Record<string, number>;
}

/** Factorio wire color. Most compiled Lua stays green; `each_latch` uses red (#46). */
export type WireColor = "red" | "green";

export interface WireEdge {
  /** Producer entity id. */
  from: string;
  /** Consumer entity id. */
  to: string;
  color: WireColor;
}

export interface CircuitGraph {
  entities: CircuitEntity[];
  wires: WireEdge[];
  outputs: Array<{ signal: string; entityId: string }>;
  inputs: Array<{ signal: string; entityId: string }>;
}

/** Factorio logic signal used for per-signal arithmetic (wiki EACH). */
const SIGNAL_EACH = "signal-each";
const SIGNAL_EVERYTHING = "signal-everything";
const SIGNAL_ANYTHING = "signal-anything";

function signalRef(name: string): { type: "virtual"; name: string } {
  return { type: "virtual", name };
}

function greenWire(from: string, to: string): WireEdge {
  return { from, to, color: "green" };
}

/** Explicit red edge for hand graphs / fixtures (#40). Compiled emit still uses `greenWire`. */
export function redWire(from: string, to: string): WireEdge {
  return { from, to, color: "red" };
}

/** Lua/circuit truthiness: signal ≠ 0. */
function truthyCond(signalId: string): Record<string, unknown> {
  return { first_signal: signalRef(signalId), comparator: "!=", constant: 0 };
}

/** Same as `truthyCond`, for AND-chained decider conditions. */
function andTruthy(signalId: string): Record<string, unknown> {
  return { ...truthyCond(signalId), compare_type: "and" };
}

/** Green wires to `to`, skipping duplicate `from` ids. */
function uniqueGreenWires(fromIds: Iterable<string>, to: string): WireEdge[] {
  const seen = new Set<string>();
  const wires: WireEdge[] = [];
  for (const from of fromIds) {
    if (seen.has(from)) {
      continue;
    }
    seen.add(from);
    wires.push(greenWire(from, to));
  }
  return wires;
}

const COMPARATOR: Record<CmpOp, string> = {
  "<": "<",
  ">": ">",
  "<=": "<=",
  ">=": ">=",
  "==": "=",
  "~=": "!=",
};

function lowerLiteral(node: Extract<IRNode, { kind: "literal" }>): CircuitEntity {
  return {
    id: node.id,
    kind: "constant",
    name: "constant-combinator",
    outputSignal: node.id,
    control_behavior: {
      sections: {
        sections: [{ index: 1, filters: [{ index: 1, count: node.value, ...signalRef(node.id) }] }],
      },
    },
  };
}

function lowerInput(node: Extract<IRNode, { kind: "input" }>): CircuitEntity {
  return {
    id: node.id,
    kind: "constant",
    name: "constant-combinator",
    // Channel id (not user signal): sim injects by entity.id; dual-inject would inflate counts.
    outputSignal: node.id,
    control_behavior: { sections: { sections: [] } },
  };
}

function lowerBinop(
  node: Extract<IRNode, { kind: "binop" }>,
  nodeById: ReadonlyMap<string, IRNode>,
): { entity: CircuitEntity; wireFrom: string[] } {
  const leftLit = literalValueOf(nodeById.get(node.left));
  const rightLit = literalValueOf(nodeById.get(node.right));

  const arithmetic_conditions: Record<string, unknown> = {
    operation: node.op,
    output_signal: signalRef(node.id),
  };
  const wireFrom: string[] = [];

  if (leftLit !== undefined && rightLit === undefined) {
    arithmetic_conditions.first_constant = leftLit;
    arithmetic_conditions.second_signal = signalRef(node.right);
    wireFrom.push(node.right);
  } else if (rightLit !== undefined && leftLit === undefined) {
    arithmetic_conditions.first_signal = signalRef(node.left);
    arithmetic_conditions.second_constant = rightLit;
    wireFrom.push(node.left);
  } else if (leftLit !== undefined && rightLit !== undefined) {
    // Both literals — still emit as constants (optimize should have folded; belt-and-suspenders).
    arithmetic_conditions.first_constant = leftLit;
    arithmetic_conditions.second_constant = rightLit;
  } else {
    arithmetic_conditions.first_signal = signalRef(node.left);
    arithmetic_conditions.second_signal = signalRef(node.right);
    wireFrom.push(node.left, node.right);
  }

  return {
    entity: {
      id: node.id,
      kind: "arithmetic",
      name: "arithmetic-combinator",
      outputSignal: node.id,
      control_behavior: { arithmetic_conditions },
    },
    wireFrom,
  };
}

function cmpCondition(
  node: Extract<IRNode, { kind: "cmp" }>,
  nodeById: ReadonlyMap<string, IRNode>,
): { condition: Record<string, unknown>; wireFrom: string[] } {
  const leftLit = literalValueOf(nodeById.get(node.left));
  const rightLit = literalValueOf(nodeById.get(node.right));
  const condition: Record<string, unknown> = {
    comparator: COMPARATOR[node.op],
  };
  const wireFrom: string[] = [];

  if (leftLit !== undefined && rightLit === undefined) {
    condition.first_constant = leftLit;
    condition.second_signal = signalRef(node.right);
    wireFrom.push(node.right);
  } else if (rightLit !== undefined && leftLit === undefined) {
    condition.first_signal = signalRef(node.left);
    condition.constant = rightLit;
    wireFrom.push(node.left);
  } else if (leftLit !== undefined && rightLit !== undefined) {
    condition.first_constant = leftLit;
    condition.constant = rightLit;
  } else {
    condition.first_signal = signalRef(node.left);
    condition.second_signal = signalRef(node.right);
    wireFrom.push(node.left, node.right);
  }

  return { condition, wireFrom };
}

function lowerCmp(
  node: Extract<IRNode, { kind: "cmp" }>,
  nodeById: ReadonlyMap<string, IRNode>,
): { entity: CircuitEntity; wireFrom: string[] } {
  const { condition, wireFrom } = cmpCondition(node, nodeById);
  return {
    entity: {
      id: node.id,
      kind: "decider",
      name: "decider-combinator",
      outputSignal: node.id,
      control_behavior: {
        decider_conditions: {
          conditions: [condition],
          outputs: [{ signal: signalRef(node.id), constant: 1 }],
        },
      },
    },
    wireFrom,
  };
}

/**
 * Faithful mux side: gate `branchSignal` when `cond` matches `comparator`/`constant`.
 * Lua truthiness: only 0 is false.
 */
function lowerSelectGate(
  id: string,
  condId: string,
  branchSignal: string,
  comparator: "=" | "!=",
  constant: number,
): CircuitEntity {
  return {
    id,
    kind: "decider",
    name: "decider-combinator",
    outputSignal: branchSignal,
    role: "mux-side",
    control_behavior: {
      decider_conditions: {
        conditions: [{ first_signal: signalRef(condId), comparator, constant }],
        outputs: [{ signal: signalRef(branchSignal), copy_count_from_input: true }],
      },
    },
  };
}

/**
 * One decider: copy `thenSignal` when `cond != 0`, else copy `elseSignal`
 * (Factorio 2.x `else_outputs`). Keeps branch signal names on the wire.
 */
function lowerElseOutputsMux(
  id: string,
  condId: string,
  thenSignal: string,
  elseSignal: string,
): CircuitEntity {
  return {
    id,
    kind: "decider",
    name: "decider-combinator",
    outputSignal: thenSignal,
    role: "mux-side",
    control_behavior: {
      decider_conditions: {
        conditions: [{ first_signal: signalRef(condId), comparator: "!=", constant: 0 }],
        outputs: [{ signal: signalRef(thenSignal), copy_count_from_input: true }],
        else_outputs: [{ signal: signalRef(elseSignal), copy_count_from_input: true }],
      },
    },
  };
}

/** Arithmetic rename: copy `fromSignal` onto `id` (used after a gate that kept the branch name). */
function lowerRename(id: string, fromSignal: string): CircuitEntity {
  return {
    id,
    kind: "arithmetic",
    name: "arithmetic-combinator",
    outputSignal: id,
    control_behavior: {
      arithmetic_conditions: {
        first_signal: signalRef(fromSignal),
        second_constant: 0,
        operation: "+",
        output_signal: signalRef(id),
      },
    },
  };
}

/** One decider: when `cond comparator 0`, output a constant on `nodeId`. */
function lowerConstWhen(
  nodeId: string,
  condId: string,
  comparator: "=" | "!=",
  outputConstant: number,
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  return {
    entities: [
      {
        id: nodeId,
        kind: "decider",
        name: "decider-combinator",
        outputSignal: nodeId,
        control_behavior: {
          decider_conditions: {
            conditions: [{ first_signal: signalRef(condId), comparator, constant: 0 }],
            outputs: [{ signal: signalRef(nodeId), constant: outputConstant }],
          },
        },
      },
    ],
    wires: [greenWire(condId, nodeId)],
  };
}

/**
 * `select(cmp, lit, 0)` / `select(cmp, 0, lit)` — inline cmp into one const-when decider.
 * `whenCmpPasses`: emit on the then path; else emit via `else_outputs`.
 */
function lowerConstWhenFromCmp(
  nodeId: string,
  cmp: Extract<IRNode, { kind: "cmp" }>,
  outputConstant: number,
  nodeById: ReadonlyMap<string, IRNode>,
  whenCmpPasses: boolean,
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  const { condition, wireFrom } = cmpCondition(cmp, nodeById);
  const output = { signal: signalRef(nodeId), constant: outputConstant };
  return {
    entities: [
      {
        id: nodeId,
        kind: "decider",
        name: "decider-combinator",
        outputSignal: nodeId,
        control_behavior: {
          decider_conditions: whenCmpPasses
            ? { conditions: [condition], outputs: [output] }
            : { conditions: [condition], outputs: [], else_outputs: [output] },
        },
      },
    ],
    wires: wireFrom.map((from) => greenWire(from, nodeId)),
  };
}

/**
 * One decider with AND of two truthiness checks, outputting constant 1.
 * Use `condComparator="="` for `select(c, 0, bool)` (true when cond is 0 and other ≠ 0).
 */
function lowerTruthAndToOne(
  nodeId: string,
  condId: string,
  otherId: string,
  condComparator: "=" | "!=" = "!=",
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  return {
    entities: [
      {
        id: nodeId,
        kind: "decider",
        name: "decider-combinator",
        outputSignal: nodeId,
        control_behavior: {
          decider_conditions: {
            conditions: [
              { first_signal: signalRef(condId), comparator: condComparator, constant: 0 },
              {
                first_signal: signalRef(otherId),
                comparator: "!=",
                constant: 0,
                compare_type: "and",
              },
            ],
            outputs: [{ signal: signalRef(nodeId), constant: 1 }],
          },
        },
      },
    ],
    wires: [greenWire(condId, nodeId), greenWire(otherId, nodeId)],
  };
}

/**
 * Gate `branchId` under `cond`. When `outputOnly`, the gate's id is `nodeId`
 * (no rename); otherwise gate + rename (2).
 */
function lowerGateAndRename(
  nodeId: string,
  condId: string,
  branchId: string,
  comparator: "=" | "!=",
  outputOnly: boolean,
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  const gateId = outputOnly ? nodeId : `${nodeId}__gate`;
  const gate = lowerSelectGate(gateId, condId, branchId, comparator, 0);
  const wires = [greenWire(condId, gateId), greenWire(branchId, gateId)];
  if (outputOnly) {
    return { entities: [gate], wires };
  }
  return {
    entities: [gate, lowerRename(nodeId, branchId)],
    wires: [...wires, greenWire(gateId, nodeId)],
  };
}

/**
 * Gate `branchId` with an inlined sole-use cmp.
 * `whenCmpPasses`: `select(cmp, x, 0)`; else `select(cmp, 0, x)` via `else_outputs`.
 * `outputOnly`: single gate (no rename) when the select is only an output.
 */
function lowerGateByCmpAndRename(
  nodeId: string,
  cmp: Extract<IRNode, { kind: "cmp" }>,
  branchId: string,
  nodeById: ReadonlyMap<string, IRNode>,
  whenCmpPasses: boolean,
  outputOnly: boolean,
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  const { condition, wireFrom } = cmpCondition(cmp, nodeById);
  const copy = { signal: signalRef(branchId), copy_count_from_input: true };
  const decider_conditions = whenCmpPasses
    ? { conditions: [condition], outputs: [copy] }
    : { conditions: [condition], outputs: [], else_outputs: [copy] };
  const gateId = outputOnly ? nodeId : `${nodeId}__gate`;
  const gate: CircuitEntity = {
    id: gateId,
    kind: "decider",
    name: "decider-combinator",
    outputSignal: branchId,
    role: "mux-side",
    control_behavior: { decider_conditions },
  };
  const wires = [...wireFrom.map((from) => greenWire(from, gateId)), greenWire(branchId, gateId)];
  if (outputOnly) {
    return { entities: [gate], wires };
  }
  return {
    entities: [gate, lowerRename(nodeId, branchId)],
    wires: [...wires, greenWire(gateId, nodeId)],
  };
}

/** `select(cmp, bool, 0)` — cmp ∧ (other ≠ 0) → constant 1. */
function lowerTruthAndFromCmp(
  nodeId: string,
  cmp: Extract<IRNode, { kind: "cmp" }>,
  otherId: string,
  nodeById: ReadonlyMap<string, IRNode>,
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  const { condition, wireFrom } = cmpCondition(cmp, nodeById);
  return {
    entities: [
      {
        id: nodeId,
        kind: "decider",
        name: "decider-combinator",
        outputSignal: nodeId,
        control_behavior: {
          decider_conditions: {
            conditions: [
              condition,
              {
                first_signal: signalRef(otherId),
                comparator: "!=",
                constant: 0,
                compare_type: "and",
              },
            ],
            outputs: [{ signal: signalRef(nodeId), constant: 1 }],
          },
        },
      },
    ],
    wires: [...wireFrom.map((from) => greenWire(from, nodeId)), greenWire(otherId, nodeId)],
  };
}

/** `select(cmpA, cmpB, 0)` — two inlined cmps ANDed → constant 1. */
function lowerTruthAndTwoCmps(
  nodeId: string,
  left: Extract<IRNode, { kind: "cmp" }>,
  right: Extract<IRNode, { kind: "cmp" }>,
  nodeById: ReadonlyMap<string, IRNode>,
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  const a = cmpCondition(left, nodeById);
  const b = cmpCondition(right, nodeById);
  return {
    entities: [
      {
        id: nodeId,
        kind: "decider",
        name: "decider-combinator",
        outputSignal: nodeId,
        control_behavior: {
          decider_conditions: {
            conditions: [a.condition, { ...b.condition, compare_type: "and" }],
            outputs: [{ signal: signalRef(nodeId), constant: 1 }],
          },
        },
      },
    ],
    wires: [
      ...a.wireFrom.map((from) => greenWire(from, nodeId)),
      ...b.wireFrom.map((from) => greenWire(from, nodeId)),
    ],
  };
}

/**
 * Boolean OR with cmp(s) inlined when not referenced outside this `select(a, a, b)`.
 * Left may be counted twice (cond+then); allow useCount <= 2 in that case.
 */
function lowerTruthOrWithOptionalCmps(
  nodeId: string,
  leftId: string,
  rightId: string,
  nodeById: ReadonlyMap<string, IRNode>,
  useCount: ReadonlyMap<string, number>,
  leftIsAlsoCond: boolean,
): { entities: CircuitEntity[]; wires: WireEdge[]; absorbedCmpIds: string[] } {
  const leftUses = useCount.get(leftId) ?? 0;
  const leftCmpNode = nodeById.get(leftId);
  const leftCmp =
    leftCmpNode?.kind === "cmp" && leftUses <= (leftIsAlsoCond ? 2 : 1) ? leftCmpNode : undefined;
  const rightCmp = soleUseCmp(rightId, nodeById, useCount);
  const absorbedCmpIds: string[] = [];
  const wires: WireEdge[] = [];
  let leftCond: Record<string, unknown>;
  let rightCond: Record<string, unknown>;

  if (leftCmp !== undefined) {
    const { condition, wireFrom } = cmpCondition(leftCmp, nodeById);
    leftCond = condition;
    wires.push(...wireFrom.map((from) => greenWire(from, nodeId)));
    absorbedCmpIds.push(leftCmp.id);
  } else {
    leftCond = { first_signal: signalRef(leftId), comparator: "!=", constant: 0 };
    wires.push(greenWire(leftId, nodeId));
  }

  if (rightCmp !== undefined) {
    const { condition, wireFrom } = cmpCondition(rightCmp, nodeById);
    rightCond = { ...condition, compare_type: "or" };
    wires.push(...wireFrom.map((from) => greenWire(from, nodeId)));
    absorbedCmpIds.push(rightCmp.id);
  } else {
    rightCond = {
      first_signal: signalRef(rightId),
      comparator: "!=",
      constant: 0,
      compare_type: "or",
    };
    wires.push(greenWire(rightId, nodeId));
  }

  return {
    entities: [
      {
        id: nodeId,
        kind: "decider",
        name: "decider-combinator",
        outputSignal: nodeId,
        control_behavior: {
          decider_conditions: {
            conditions: [leftCond, rightCond],
            outputs: [{ signal: signalRef(nodeId), constant: 1 }],
          },
        },
      },
    ],
    wires,
    absorbedCmpIds,
  };
}

/**
 * Emit `c and x or y` as one else_outputs decider + EACH merge.
 * Preserves circuit truthiness: yield x only when c≠0 and x≠0; else y.
 * When x is a nonzero literal, the x≠0 check is implied.
 */
function lowerAndOrMux(
  outer: Extract<IRNode, { kind: "select" }>,
  inner: Extract<IRNode, { kind: "select" }>,
  nodeById: ReadonlyMap<string, IRNode>,
  useCount: ReadonlyMap<string, number>,
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  const x = inner.then;
  const y = outer.else;
  const xLit = literalValueOf(nodeById.get(x));
  const muxId = `${outer.id}__mux`;
  const xIsNonzeroLit = xLit !== undefined && xLit !== 0;

  const { conditions: baseConds, wireFrom: baseFrom } = condFromSoleUseCmpOrSignal(
    inner.cond,
    nodeById,
    useCount,
  );
  const conditions = xIsNonzeroLit ? baseConds : [...baseConds, andTruthy(x)];
  const wireFrom = xIsNonzeroLit ? baseFrom : [...baseFrom, x];
  const thenOutputs = xIsNonzeroLit
    ? [{ signal: signalRef(x), constant: xLit }]
    : [{ signal: signalRef(x), copy_count_from_input: true }];

  return {
    entities: [
      {
        id: muxId,
        kind: "decider",
        name: "decider-combinator",
        outputSignal: x,
        role: "mux-side",
        control_behavior: {
          decider_conditions: {
            conditions,
            outputs: thenOutputs,
            else_outputs: [{ signal: signalRef(y), copy_count_from_input: true }],
          },
        },
      },
      lowerSelectMerge(outer.id),
    ],
    wires: [...uniqueGreenWires([...wireFrom, y], muxId), greenWire(muxId, outer.id)],
  };
}

/** True when lowerSelect would emit else_outputs mux + merge (not a cheaper specialization). */
function selectUsesFullMux(
  node: Extract<IRNode, { kind: "select" }>,
  nodeById: ReadonlyMap<string, IRNode>,
  useCount?: ReadonlyMap<string, number>,
): boolean {
  if (node.then === node.else) {
    return false;
  }
  if (useCount !== undefined && matchAndOrMux(node, nodeById, useCount) !== undefined) {
    return false;
  }
  const thenLit = literalValueOf(nodeById.get(node.then));
  const elseLit = literalValueOf(nodeById.get(node.else));
  if (elseLit === 0 || thenLit === 0) {
    return false;
  }
  if (isBooleanOrSelect(node, nodeById)) {
    return false;
  }
  return true;
}

function lowerSharedElseOutputsMux(
  muxId: string,
  condId: string,
  selects: ReadonlyArray<Extract<IRNode, { kind: "select" }>>,
): CircuitEntity {
  return {
    id: muxId,
    kind: "decider",
    name: "decider-combinator",
    outputSignal: selects[0]!.then,
    role: "mux-side",
    control_behavior: {
      decider_conditions: {
        conditions: [{ first_signal: signalRef(condId), comparator: "!=", constant: 0 }],
        outputs: selects.map((select) => ({
          signal: signalRef(select.then),
          copy_count_from_input: true,
        })),
        else_outputs: selects.map((select) => ({
          signal: signalRef(select.else),
          copy_count_from_input: true,
        })),
      },
    },
  };
}

/**
 * Merge mux branch signals onto `id`. Uses EACH+0 → `id` so any present branch
 * count (then or else) is summed onto the result — Factorio-accurate and drops the
 * need to name both operands (wiki: EACH input + specific output = sum).
 */
function lowerSelectMerge(id: string): CircuitEntity {
  return {
    id,
    kind: "arithmetic",
    name: "arithmetic-combinator",
    outputSignal: id,
    control_behavior: {
      arithmetic_conditions: {
        first_signal: signalRef(SIGNAL_EACH),
        second_constant: 0,
        operation: "+",
        output_signal: signalRef(id),
      },
    },
  };
}

/**
 * General mux via one `else_outputs` decider + arithmetic merge (−1 vs two gates).
 * Copy keeps branch signal names; merge renames onto `node.id`.
 */
function lowerSelectFullMux(node: Extract<IRNode, { kind: "select" }>): {
  entities: CircuitEntity[];
  wires: WireEdge[];
} {
  const muxId = `${node.id}__mux`;
  return {
    entities: [
      lowerElseOutputsMux(muxId, node.cond, node.then, node.else),
      lowerSelectMerge(node.id),
    ],
    wires: [
      greenWire(node.cond, muxId),
      greenWire(node.then, muxId),
      greenWire(node.else, muxId),
      greenWire(muxId, node.id),
    ],
  };
}

/** Full mux with sole-use cmp inlined into the `else_outputs` decider. */
function lowerSelectFullMuxFromCmp(
  node: Extract<IRNode, { kind: "select" }>,
  cmp: Extract<IRNode, { kind: "cmp" }>,
  nodeById: ReadonlyMap<string, IRNode>,
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  const muxId = `${node.id}__mux`;
  const { condition, wireFrom } = cmpCondition(cmp, nodeById);
  const mux: CircuitEntity = {
    id: muxId,
    kind: "decider",
    name: "decider-combinator",
    outputSignal: node.then,
    role: "mux-side",
    control_behavior: {
      decider_conditions: {
        conditions: [condition],
        outputs: [{ signal: signalRef(node.then), copy_count_from_input: true }],
        else_outputs: [{ signal: signalRef(node.else), copy_count_from_input: true }],
      },
    },
  };
  return {
    entities: [mux, lowerSelectMerge(node.id)],
    wires: [
      ...wireFrom.map((from) => greenWire(from, muxId)),
      greenWire(node.then, muxId),
      greenWire(node.else, muxId),
      greenWire(muxId, node.id),
    ],
  };
}

/**
 * Decider condition from a sole-use cmp (inlined), else `condId ≠ 0`.
 * Returns the cmp when absorbed so callers can track `absorbedCmpIds`.
 */
function condFromSoleUseCmpOrSignal(
  condId: string,
  nodeById: ReadonlyMap<string, IRNode>,
  useCount: ReadonlyMap<string, number>,
): {
  conditions: Record<string, unknown>[];
  wireFrom: string[];
  cmp?: Extract<IRNode, { kind: "cmp" }>;
} {
  const cmp = soleUseCmp(condId, nodeById, useCount);
  if (cmp !== undefined) {
    const { condition, wireFrom } = cmpCondition(cmp, nodeById);
    return { conditions: [condition], wireFrom, cmp };
  }
  return { conditions: [truthyCond(condId)], wireFrom: [condId] };
}

/**
 * Specialize common `select` shapes to cut the 3-entity mux tax:
 * - `select(c, lit, 0)` / `select(c, 0, lit)` → 1 decider (constant when cond matches)
 * - `select(c, bool, 0)` / `select(c, 0, bool)` → 1 AND-decider → constant 1
 * - `select(a, a, b)` when a,b boolean → 1 OR-decider → constant 1
 * - `select(c, x, 0)` / `select(c, 0, x)` → one gate if output-only, else gate + rename
 * - `select(c, x, x)` → rename (1)
 * - otherwise → else_outputs mux + merge (2)
 * When `c` is a sole-use cmp, its condition is inlined and the cmp entity is omitted.
 */
function lowerSelect(
  node: Extract<IRNode, { kind: "select" }>,
  nodeById: ReadonlyMap<string, IRNode>,
  useCount: ReadonlyMap<string, number>,
  outputOnly: boolean,
): {
  entities: CircuitEntity[];
  wires: WireEdge[];
} {
  const thenNode = nodeById.get(node.then);
  const elseNode = nodeById.get(node.else);
  const thenLit = literalValueOf(thenNode);
  const elseLit = literalValueOf(elseNode);
  const fusedCmp = fusedCmpForSelect(node, nodeById, useCount);

  if (node.then === node.else) {
    return {
      entities: [lowerRename(node.id, node.then)],
      wires: [greenWire(node.then, node.id)],
    };
  }

  const andOr = matchAndOrMux(node, nodeById, useCount);
  if (andOr !== undefined) {
    return lowerAndOrMux(node, andOr.inner, nodeById, useCount);
  }

  if (elseLit === 0 && thenLit !== undefined) {
    return fusedCmp
      ? lowerConstWhenFromCmp(node.id, fusedCmp, thenLit, nodeById, true)
      : lowerConstWhen(node.id, node.cond, "!=", thenLit);
  }
  if (thenLit === 0 && elseLit !== undefined) {
    return fusedCmp
      ? lowerConstWhenFromCmp(node.id, fusedCmp, elseLit, nodeById, false)
      : lowerConstWhen(node.id, node.cond, "=", elseLit);
  }

  if (elseLit === 0 && isBooleanValued(thenNode)) {
    // Inline sole-use then-cmp: select(c, cmp, 0) → one AND (c ≠ 0 ∧ cmp).
    const thenCmp = soleUseCmp(node.then, nodeById, useCount);
    if (thenCmp !== undefined) {
      return fusedCmp
        ? lowerTruthAndTwoCmps(node.id, fusedCmp, thenCmp, nodeById)
        : lowerTruthAndFromCmp(node.id, thenCmp, node.cond, nodeById);
    }
    return fusedCmp
      ? lowerTruthAndFromCmp(node.id, fusedCmp, node.then, nodeById)
      : lowerTruthAndToOne(node.id, node.cond, node.then, "!=");
  }
  if (thenLit === 0 && isBooleanValued(elseNode)) {
    return lowerTruthAndToOne(node.id, node.cond, node.else, "=");
  }

  if (elseLit === 0) {
    return fusedCmp
      ? lowerGateByCmpAndRename(node.id, fusedCmp, node.then, nodeById, true, outputOnly)
      : lowerGateAndRename(node.id, node.cond, node.then, "!=", outputOnly);
  }
  if (thenLit === 0) {
    return fusedCmp
      ? lowerGateByCmpAndRename(node.id, fusedCmp, node.else, nodeById, false, outputOnly)
      : lowerGateAndRename(node.id, node.cond, node.else, "=", outputOnly);
  }

  // `a or b` → select(a, a, b); when both are 0/1, one OR-decider (no mux tax).
  if (isBooleanOrSelect(node, nodeById)) {
    const { entities, wires } = lowerTruthOrWithOptionalCmps(
      node.id,
      node.then,
      node.else,
      nodeById,
      useCount,
      true,
    );
    return { entities, wires };
  }

  return fusedCmp ? lowerSelectFullMuxFromCmp(node, fusedCmp, nodeById) : lowerSelectFullMux(node);
}

/** 1-tick delay register: passes `store.value` onto the memory signal (role: latch). */
function lowerMemory(
  node: Extract<IRNode, { kind: "memory" }>,
  storeValueId: string,
  initIsZero: boolean,
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  const entity: CircuitEntity = {
    id: node.id,
    kind: "arithmetic",
    name: "arithmetic-combinator",
    outputSignal: node.id,
    role: "latch",
    control_behavior: {
      arithmetic_conditions: {
        first_signal: signalRef(storeValueId),
        second_constant: 0,
        operation: "+",
        output_signal: signalRef(node.id),
      },
    },
  };

  const wires = [greenWire(storeValueId, node.id)];
  // Literal 0 init is the default absent signal — no need to place/wire a constant.
  if (!initIsZero) {
    wires.unshift(greenWire(node.init, node.id));
  }

  return { entities: [entity], wires };
}

/** Latch arithmetic: `first + second` onto `id` (second may be a wired signal or literal). */
function lowerLatch(id: string, firstSignal: string, second: string | number): CircuitEntity {
  const arithmetic_conditions: Record<string, unknown> = {
    first_signal: signalRef(firstSignal),
    operation: "+",
    output_signal: signalRef(id),
  };
  if (typeof second === "number") {
    arithmetic_conditions.second_constant = second;
  } else {
    arithmetic_conditions.second_signal = signalRef(second);
  }
  return {
    id,
    kind: "arithmetic",
    name: "arithmetic-combinator",
    outputSignal: id,
    role: "latch",
    control_behavior: { arithmetic_conditions },
  };
}

/**
 * Free-running `store(mem, mem + δ)` → one latch `Q + δ` with Q feedback (no separate + binop).
 * Literal δ uses `second_constant` so no extra constant entity is required on the wire.
 */
function lowerFreeRunningDeltaLatch(
  memory: Extract<IRNode, { kind: "memory" }>,
  deltaId: string,
  initIsZero: boolean,
  nodeById: ReadonlyMap<string, IRNode>,
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  const deltaLit = literalValueOf(nodeById.get(deltaId));
  const wires: WireEdge[] = [greenWire(memory.id, memory.id)];
  if (!initIsZero) {
    wires.push(greenWire(memory.init, memory.id));
  }
  if (deltaLit === undefined) {
    wires.push(greenWire(deltaId, memory.id));
  }
  return {
    entities: [lowerLatch(memory.id, memory.id, deltaLit ?? deltaId)],
    wires,
  };
}

/**
 * Factorio 2.0 copy-increment clock: one decider latch.
 * then: copy mem + constant δ; else: copy mem (hold).
 */
function lowerCopyIncrementLatch(
  memory: Extract<IRNode, { kind: "memory" }>,
  select: Extract<IRNode, { kind: "select" }>,
  deltaLit: number,
  initIsZero: boolean,
  nodeById: ReadonlyMap<string, IRNode>,
  stickyEnable?: { runId: string; thenId: string },
  /** Remap absorbed signal entity ids (fused `__run` → host). */
  wireHost: (id: string) => string = (id) => id,
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  const { conditions, wireFrom } = stickyEnable
    ? stickyEnableGateConditions(stickyEnable.runId, stickyEnable.thenId, nodeById)
    : {
        conditions: [truthyCond(select.cond)],
        wireFrom: [select.cond],
      };

  const memRef = signalRef(memory.id);
  // cmp wireFrom may already include `memory.id`; dedupe so feedback is not doubled.
  const wires = uniqueGreenWires([...wireFrom.map(wireHost), memory.id], memory.id);
  if (!initIsZero) {
    wires.push(greenWire(memory.init, memory.id));
  }

  return {
    entities: [
      {
        id: memory.id,
        kind: "decider",
        name: "decider-combinator",
        outputSignal: memory.id,
        role: "latch",
        control_behavior: {
          decider_conditions: {
            conditions,
            outputs: [
              { signal: memRef, copy_count_from_input: true },
              { signal: memRef, constant: deltaLit },
            ],
            else_outputs: [{ signal: memRef, copy_count_from_input: true }],
          },
        },
      },
    ],
    wires,
  };
}

/**
 * Fuse sticky `__run` latch + literal copy-increment induction into one multi-output decider.
 * then: copy i + δ on i, const 1 on __run; else: copy i (__run clears).
 */
function lowerFusedRunClockLatch(
  memory: Extract<IRNode, { kind: "memory" }>,
  deltaLit: number,
  stickyEnable: { runId: string; thenId: string },
  runInit: number,
  inductionInit: number,
  nodeById: ReadonlyMap<string, IRNode>,
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  const { conditions, wireFrom } = stickyEnableGateConditions(
    stickyEnable.runId,
    stickyEnable.thenId,
    nodeById,
  );
  const memRef = signalRef(memory.id);
  const runRef = signalRef(stickyEnable.runId);
  // `__run` arrives via self-feedback on the host — do not wire a missing run entity.
  // cmp wireFrom may already include induction id; dedupe so feedback is not doubled.
  const wires = uniqueGreenWires(
    [...wireFrom.filter((id) => id !== stickyEnable.runId), memory.id],
    memory.id,
  );
  // Nonzero inits: keep literal constants on the net for blueprint/sim seed discovery.
  const initFrom = new Set<string>();
  if (inductionInit !== 0) {
    initFrom.add(memory.init);
  }
  const runMem = nodeById.get(stickyEnable.runId);
  if (runMem?.kind === "memory" && runInit !== 0) {
    initFrom.add(runMem.init);
  }
  for (const initId of initFrom) {
    wires.push(greenWire(initId, memory.id));
  }

  const latchSeeds: Record<string, number> = {};
  if (inductionInit !== 0) {
    latchSeeds[memory.id] = inductionInit;
  }
  if (runInit !== 0) {
    latchSeeds[stickyEnable.runId] = runInit;
  }

  return {
    entities: [
      {
        id: memory.id,
        kind: "decider",
        name: "decider-combinator",
        outputSignal: memory.id,
        role: "latch",
        ...(Object.keys(latchSeeds).length > 0 ? { latchSeeds } : {}),
        control_behavior: {
          decider_conditions: {
            conditions,
            outputs: [
              { signal: memRef, copy_count_from_input: true },
              { signal: memRef, constant: deltaLit },
              { signal: runRef, constant: 1 },
            ],
            else_outputs: [{ signal: memRef, copy_count_from_input: true }],
          },
        },
      },
    ],
    wires,
  };
}

/**
 * Incremental enable-hold when `next = mem + δ`: gate only δ, latch `Q + gated_δ`
 * with Q feedback (no else-gate). Literal δ uses a 2.0 copy-increment decider latch.
 * Non-literal δ keeps the gate + arithmetic path (e.g. `sum += i`).
 *
 * When `stickyEnable` is set, the hold's cond was a multi-use sticky `__run∧cond`
 * select absorbed into the run latch — expand the gate to `[run ≠ 0 ∧ then]` so we
 * do not depend on the sticky output (wrong tick).
 */
function lowerIncrementalHoldLatch(
  memory: Extract<IRNode, { kind: "memory" }>,
  select: Extract<IRNode, { kind: "select" }>,
  deltaId: string,
  initIsZero: boolean,
  nodeById: ReadonlyMap<string, IRNode>,
  stickyEnable?: { runId: string; thenId: string },
  wireHost: (id: string) => string = (id) => id,
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  const deltaLit = literalValueOf(nodeById.get(deltaId));
  if (deltaLit !== undefined) {
    return lowerCopyIncrementLatch(
      memory,
      select,
      deltaLit,
      initIsZero,
      nodeById,
      stickyEnable,
      wireHost,
    );
  }

  const deltaGateId = `${select.id}__d`;
  const gatedDeltaSignal = deltaId;

  const { conditions, wireFrom } = stickyEnable
    ? stickyEnableGateConditions(stickyEnable.runId, stickyEnable.thenId, nodeById)
    : {
        conditions: [truthyCond(select.cond)],
        wireFrom: [select.cond],
      };

  const outputs = [{ signal: signalRef(deltaId), copy_count_from_input: true }];

  const deltaGate: CircuitEntity = {
    id: deltaGateId,
    kind: "decider",
    name: "decider-combinator",
    outputSignal: gatedDeltaSignal,
    role: "mux-side",
    control_behavior: {
      decider_conditions: { conditions, outputs },
    },
  };

  const gateInputs = [...wireFrom.map(wireHost), wireHost(deltaId)];
  const wires = uniqueGreenWires(gateInputs, deltaGateId);
  wires.push(
    greenWire(deltaGateId, memory.id),
    // Q feedback: latch still sees `mem` when enable is off (gate silent).
    greenWire(memory.id, memory.id),
  );
  if (!initIsZero) {
    wires.push(greenWire(memory.init, memory.id));
  }

  return {
    entities: [deltaGate, lowerLatch(memory.id, memory.id, gatedDeltaSignal)],
    wires,
  };
}

/** Gate conditions for hold when enable was absorbed into a sticky run latch. */
function stickyEnableGateConditions(
  runId: string,
  thenId: string,
  nodeById: ReadonlyMap<string, IRNode>,
): { conditions: Record<string, unknown>[]; wireFrom: string[] } {
  const thenNode = nodeById.get(thenId);
  if (thenNode?.kind === "cmp") {
    const { condition, wireFrom } = cmpCondition(thenNode, nodeById);
    return {
      conditions: [truthyCond(runId), { ...condition, compare_type: "and" }],
      wireFrom: [runId, ...wireFrom],
    };
  }
  return {
    conditions: [truthyCond(runId), andTruthy(thenId)],
    wireFrom: [runId, thenId],
  };
}

function lowerStickyAndLatch(
  memory: Extract<IRNode, { kind: "memory" }>,
  select: Extract<IRNode, { kind: "select" }>,
  initIsZero: boolean,
  nodeById: ReadonlyMap<string, IRNode>,
  useCount: ReadonlyMap<string, number>,
): { entities: CircuitEntity[]; wires: WireEdge[]; absorbedCmpIds: string[] } {
  const thenCmp = soleUseCmp(select.then, nodeById, useCount);
  const absorbedCmpIds: string[] = thenCmp !== undefined ? [thenCmp.id] : [];
  const wires: WireEdge[] = [greenWire(memory.id, memory.id)];
  let thenCond: Record<string, unknown>;
  if (thenCmp !== undefined) {
    const { condition, wireFrom } = cmpCondition(thenCmp, nodeById);
    thenCond = { ...condition, compare_type: "and" };
    wires.push(...wireFrom.map((from) => greenWire(from, memory.id)));
  } else {
    thenCond = andTruthy(select.then);
    wires.push(greenWire(select.then, memory.id));
  }
  if (!initIsZero) {
    wires.push(greenWire(memory.init, memory.id));
  }
  return {
    entities: [
      {
        id: memory.id,
        kind: "decider",
        name: "decider-combinator",
        outputSignal: memory.id,
        role: "latch",
        control_behavior: {
          decider_conditions: {
            conditions: [truthyCond(memory.id), thenCond],
            outputs: [{ signal: signalRef(memory.id), constant: 1 }],
          },
        },
      },
    ],
    wires,
    absorbedCmpIds,
  };
}

/**
 * `store(mem, select(c, mem+δ₁, mem+δ₂))` with literal deltas → one copy±δ decider latch
 * (Factorio 2.0: then copy+δ₁ / else copy+δ₂; no separate arith).
 */
function lowerDeltaChooseLatch(
  memory: Extract<IRNode, { kind: "memory" }>,
  select: Extract<IRNode, { kind: "select" }>,
  thenDelta: number,
  elseDelta: number,
  initIsZero: boolean,
  nodeById: ReadonlyMap<string, IRNode>,
  useCount: ReadonlyMap<string, number>,
): { entities: CircuitEntity[]; wires: WireEdge[]; absorbedCmpIds: string[] } {
  const { conditions, wireFrom, cmp } = condFromSoleUseCmpOrSignal(select.cond, nodeById, useCount);
  const absorbedCmpIds: string[] = cmp !== undefined ? [cmp.id] : [];
  const memRef = signalRef(memory.id);

  const wires = uniqueGreenWires([...wireFrom, memory.id], memory.id);
  if (!initIsZero) {
    wires.push(greenWire(memory.init, memory.id));
  }

  return {
    entities: [
      {
        id: memory.id,
        kind: "decider",
        name: "decider-combinator",
        outputSignal: memory.id,
        role: "latch",
        control_behavior: {
          decider_conditions: {
            conditions,
            outputs: [
              { signal: memRef, copy_count_from_input: true },
              { signal: memRef, constant: thenDelta },
            ],
            else_outputs: [
              { signal: memRef, copy_count_from_input: true },
              { signal: memRef, constant: elseDelta },
            ],
          },
        },
      },
    ],
    wires,
    absorbedCmpIds,
  };
}

/**
 * Cookbook SR latch: Q' = (Q ∨ set) ∧ ¬reset → constant 1.
 * Decider AND-before-OR: (Q≠0 ∧ R=0) ∨ (S≠0 ∧ R=0).
 */
function lowerSrLatch(
  memory: Extract<IRNode, { kind: "memory" }>,
  sr: Extract<IRNode, { kind: "sr" }>,
  initIsZero: boolean,
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  const wires: WireEdge[] = [
    greenWire(memory.id, memory.id),
    greenWire(sr.set, memory.id),
    greenWire(sr.reset, memory.id),
  ];
  if (!initIsZero) {
    wires.push(greenWire(memory.init, memory.id));
  }
  return {
    entities: [
      {
        id: memory.id,
        kind: "decider",
        name: "decider-combinator",
        outputSignal: memory.id,
        role: "latch",
        control_behavior: {
          decider_conditions: {
            conditions: [
              { first_signal: signalRef(memory.id), comparator: "!=", constant: 0 },
              {
                first_signal: signalRef(sr.reset),
                comparator: "=",
                constant: 0,
                compare_type: "and",
              },
              {
                first_signal: signalRef(sr.set),
                comparator: "!=",
                constant: 0,
                compare_type: "or",
              },
              {
                first_signal: signalRef(sr.reset),
                comparator: "=",
                constant: 0,
                compare_type: "and",
              },
            ],
            outputs: [{ signal: signalRef(memory.id), constant: 1 }],
          },
        },
      },
    ],
    wires,
  };
}

/** One selector combinator counting nonzero unique arg signals onto `node.id`. */
function lowerSignalCount(node: Extract<IRNode, { kind: "signal_count" }>): {
  entity: CircuitEntity;
  wires: WireEdge[];
} {
  return {
    entity: {
      id: node.id,
      kind: "selector",
      name: "selector-combinator",
      outputSignal: node.id,
      control_behavior: {
        operation: "count",
        count_signal: signalRef(node.id),
      },
    },
    wires: uniqueGreenWires(node.args, node.id),
  };
}

/**
 * Selector rank/index (#47): pick Nth nonzero arg by value.
 * Pass-through keeps the winner's signal name; output-port rename yields the count.
 */
function lowerSignalAt(node: Extract<IRNode, { kind: "signal_at" }>): {
  entity: CircuitEntity;
  wires: WireEdge[];
} {
  return {
    entity: {
      id: node.id,
      kind: "selector",
      name: "selector-combinator",
      outputSignal: node.id,
      label: node.ascending ? "signal_at_asc" : "signal_at",
      control_behavior: {
        operation: "select",
        index_constant: node.index,
        select_max: !node.ascending,
      },
    },
    wires: uniqueGreenWires(node.args, node.id),
  };
}

const NET_GREEN = { red: false, green: true };
const NET_RED = { red: true, green: false };

/**
 * EACH-tag sticky hysteresis (#46): 1 constant (green tags) + 1 multi-OR decider latch.
 * Levels + feedback on red; tag table on green; output EACH = 1.
 */
function lowerEachLatch(node: Extract<IRNode, { kind: "each_latch" }>): {
  entities: CircuitEntity[];
  wires: WireEdge[];
} {
  const tagsId = `${node.id}__tags`;
  const conditions: Array<Record<string, unknown>> = [];
  for (const entry of node.entries) {
    const setGroup = [
      {
        first_signal: signalRef(entry.level),
        first_signal_networks: NET_RED,
        comparator: "=",
        constant: 0,
        ...(conditions.length > 0 ? { compare_type: "or" } : {}),
      },
      {
        compare_type: "and",
        first_signal: signalRef(SIGNAL_EACH),
        first_signal_networks: NET_GREEN,
        comparator: "=",
        second_signal: signalRef(entry.signal),
        second_signal_networks: NET_GREEN,
      },
    ];
    const holdGroup = [
      {
        compare_type: "or",
        first_signal: signalRef(entry.level),
        first_signal_networks: NET_RED,
        comparator: "<",
        constant: entry.buffer,
      },
      {
        compare_type: "and",
        first_signal: signalRef(entry.signal),
        first_signal_networks: NET_RED,
        comparator: ">",
        constant: 0,
      },
      {
        compare_type: "and",
        first_signal: signalRef(SIGNAL_EACH),
        first_signal_networks: NET_GREEN,
        comparator: "=",
        second_signal: signalRef(entry.signal),
        second_signal_networks: NET_GREEN,
      },
    ];
    conditions.push(...setGroup, ...holdGroup);
  }

  const wires: WireEdge[] = [greenWire(tagsId, node.id), redWire(node.id, node.id)];
  const seenLevel = new Set<string>();
  for (const entry of node.entries) {
    if (seenLevel.has(entry.level)) {
      continue;
    }
    seenLevel.add(entry.level);
    wires.push(redWire(entry.level, node.id));
  }

  return {
    entities: [
      {
        id: tagsId,
        kind: "constant",
        name: "constant-combinator",
        outputSignal: node.entries[0]!.signal,
        label: "tags",
        control_behavior: {
          sections: {
            sections: [
              {
                index: 1,
                filters: node.entries.map((entry, index) => ({
                  index: index + 1,
                  count: entry.tag,
                  type: "virtual",
                  name: entry.signal,
                })),
              },
            ],
          },
        },
      },
      {
        id: node.id,
        kind: "decider",
        name: "decider-combinator",
        outputSignal: SIGNAL_EACH,
        role: "latch",
        label: "each_latch",
        control_behavior: {
          decider_conditions: {
            conditions,
            outputs: [
              { signal: signalRef(SIGNAL_EACH), copy_count_from_input: false, constant: 1 },
            ],
          },
        },
      },
    ],
    wires,
  };
}

/** Multi-signal constant bag: one Factorio constant combinator. */
function lowerBagConst(node: Extract<IRNode, { kind: "bag_const" }>): CircuitEntity {
  return {
    id: node.id,
    kind: "constant",
    name: "constant-combinator",
    outputSignal: node.id,
    label: "bag_const",
    control_behavior: {
      sections: {
        sections: [
          {
            index: 1,
            filters: node.entries.map((entry, index) => ({
              index: index + 1,
              count: entry.count,
              ...signalRef(entry.signal),
            })),
          },
        ],
      },
    },
  };
}

/**
 * Cookbook 1 math: `EACH op EACH` with left on red and right on green.
 * The input colors deliberately do not mix, and Factorio retains each signal name on output.
 */
function lowerBagBinop(node: Extract<IRNode, { kind: "bag_binop" }>): {
  entity: CircuitEntity;
  wires: WireEdge[];
} {
  return {
    entity: {
      id: node.id,
      kind: "arithmetic",
      name: "arithmetic-combinator",
      outputSignal: SIGNAL_EACH,
      label: `bag ${node.op}`,
      control_behavior: {
        arithmetic_conditions: {
          first_signal: signalRef(SIGNAL_EACH),
          first_signal_networks: NET_RED,
          operation: node.op,
          second_signal: signalRef(SIGNAL_EACH),
          second_signal_networks: NET_GREEN,
          output_signal: signalRef(SIGNAL_EACH),
        },
      },
    },
    wires: [redWire(node.left, node.id), greenWire(node.right, node.id)],
  };
}

/**
 * Cookbook 3–5: filter red data against green mask with one EACH decider.
 * Include/exclude compare mask presence; limit compares per-channel counts.
 */
function lowerBagFilter(node: Extract<IRNode, { kind: "bag_filter" }>): {
  entity: CircuitEntity;
  wires: WireEdge[];
} {
  const dataEach = {
    first_signal: signalRef(SIGNAL_EACH),
    first_signal_networks: NET_RED,
  };
  const maskEach = {
    first_signal: signalRef(SIGNAL_EACH),
    first_signal_networks: NET_GREEN,
  };
  const conditions =
    node.mode === "include"
      ? [
          { ...dataEach, comparator: "!=" },
          { ...maskEach, comparator: "!=", constant: 0, compare_type: "and" },
        ]
      : node.mode === "exclude"
        ? [
            { ...dataEach, comparator: "!=" },
            { ...maskEach, comparator: "=", constant: 0, compare_type: "and" },
          ]
        : [
            {
              ...dataEach,
              comparator: "<=",
              second_signal: signalRef(SIGNAL_EACH),
              second_signal_networks: NET_GREEN,
            },
          ];

  return {
    entity: {
      id: node.id,
      kind: "decider",
      name: "decider-combinator",
      outputSignal: SIGNAL_EACH,
      label: `bag ${node.mode}`,
      control_behavior: {
        decider_conditions: {
          conditions,
          outputs: [
            {
              signal: signalRef(SIGNAL_EACH),
              copy_count_from_input: true,
              networks: NET_RED,
            },
          ],
        },
      },
    },
    wires: [redWire(node.data, node.id), greenWire(node.mask, node.id)],
  };
}

/** Scalar boundary for `bag["signal"]`: copy one named bag channel onto the temp signal. */
function lowerBagSample(node: Extract<IRNode, { kind: "bag_sample" }>): {
  entity: CircuitEntity;
  wires: WireEdge[];
} {
  return {
    entity: {
      id: node.id,
      kind: "arithmetic",
      name: "arithmetic-combinator",
      outputSignal: node.id,
      label: `sample ${node.signal}`,
      control_behavior: {
        arithmetic_conditions: {
          first_signal: signalRef(node.signal),
          second_constant: 0,
          operation: "+",
          output_signal: signalRef(node.id),
        },
      },
    },
    wires: [greenWire(node.bag, node.id)],
  };
}

/** Cookbook 19: compare a scalar value with its one-tick delayed copy. */
function lowerEdge(node: Extract<IRNode, { kind: "edge" }>): {
  entities: CircuitEntity[];
  wires: WireEdge[];
} {
  const previousId = `${node.id}__previous`;
  return {
    entities: [
      { ...lowerRename(previousId, node.value), role: "latch" },
      {
        id: node.id,
        kind: "decider",
        name: "decider-combinator",
        outputSignal: node.id,
        label: "edge",
        control_behavior: {
          decider_conditions: {
            conditions: [
              {
                first_signal: signalRef(node.value),
                first_signal_networks: NET_RED,
                comparator: ">",
                second_signal: signalRef(previousId),
                second_signal_networks: NET_GREEN,
              },
            ],
            outputs: [{ signal: signalRef(node.id), constant: 1 }],
          },
        },
      },
    ],
    wires: [greenWire(node.value, previousId), redWire(node.value, node.id), greenWire(previousId, node.id)],
  };
}

/** One wildcard decider: ANYTHING/EVERYTHING in, constant 1 when the predicate passes. */
function lowerBagTest(node: Extract<IRNode, { kind: "bag_test" }>): {
  entity: CircuitEntity;
  wires: WireEdge[];
} {
  return {
    entity: {
      id: node.id,
      kind: "decider",
      name: "decider-combinator",
      outputSignal: node.id,
      label: `bag ${node.mode}`,
      control_behavior: {
        decider_conditions: {
          conditions: [
            {
              first_signal: signalRef(node.mode === "any" ? SIGNAL_ANYTHING : SIGNAL_EVERYTHING),
              comparator: COMPARATOR[node.op],
              constant: node.value,
            },
          ],
          outputs: [{ signal: signalRef(node.id), constant: 1 }],
        },
      },
    },
    wires: [greenWire(node.bag, node.id)],
  };
}

/**
 * Fuse `store(mem, select(en, next, mem))` into an enable/hold latch.
 *
 * When `next = mem + δ`: literal δ → copy-increment decider; else gate δ + `Q+δ`.
 * Otherwise: one decider with else_outputs (next vs mem) + latch merge (−1 vs two gates).
 */
function lowerEnabledHoldLatch(
  memory: Extract<IRNode, { kind: "memory" }>,
  select: Extract<IRNode, { kind: "select" }>,
  initIsZero: boolean,
  nodeById: ReadonlyMap<string, IRNode>,
  stickyEnable?: { runId: string; thenId: string },
  wireHost: (id: string) => string = (id) => id,
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  const deltaId = memPlusDelta(select.then, memory.id, nodeById);
  if (deltaId !== undefined) {
    return lowerIncrementalHoldLatch(
      memory,
      select,
      deltaId,
      initIsZero,
      nodeById,
      stickyEnable,
      wireHost,
    );
  }

  const muxId = `${select.id}__mux`;
  const wires: WireEdge[] = [
    greenWire(wireHost(select.cond), muxId),
    greenWire(wireHost(select.then), muxId),
    greenWire(wireHost(select.else), muxId),
    greenWire(muxId, memory.id),
  ];
  if (!initIsZero) {
    wires.push(greenWire(memory.init, memory.id));
  }

  return {
    entities: [
      lowerElseOutputsMux(muxId, select.cond, select.then, select.else),
      lowerLatch(memory.id, select.then, select.else),
    ],
    wires,
  };
}

function lowerOutput(output: IRModule["outputs"][number], index: number): CircuitEntity {
  return {
    id: `__o${index + 1}`,
    kind: "constant",
    name: "constant-combinator",
    outputSignal: output.signal,
    control_behavior: { sections: { sections: [] } },
  };
}

/**
 * Lowers an `IRModule` to an unpositioned circuit graph. Most IR nodes become one entity;
 * `select` expands to 1–3 entities depending on specialization; `store` has no entity of its
 * own (it only contributes the value→memory wire via the paired `memory` lowering).
 * Enable/hold `select(en, next, mem)` used as a cell's store value fuses into the latch;
 * when `next = mem + δ` that fusion is incremental (gate δ only).
 * Free-running `store(mem, mem+δ)` folds into one `Q+δ` latch (Factorio-accurate clock).
 */

/** Strip compiler `__` noise for display (`__run` → `run`). */
function prettyCellName(cell: string): string {
  if (cell.startsWith("__")) {
    return cell.slice(2);
  }
  return cell;
}

/**
 * Attach human `label`s for the playground without renaming Factorio wire signals.
 * Latches get Lua cell names; ports get signal names; mux-sides get short role tags.
 */
function annotateEntityLabels(
  module: IRModule,
  entities: CircuitEntity[],
  wires: WireEdge[],
): void {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));

  for (const node of module.nodes) {
    if (node.kind === "memory") {
      const entity = byId.get(node.id);
      if (entity !== undefined) {
        entity.label = prettyCellName(node.cell);
      }
    }
  }

  for (const input of module.inputs) {
    const entity = byId.get(input.nodeId);
    if (entity !== undefined) {
      entity.label = input.signal;
    }
  }

  for (let index = 0; index < module.outputs.length; index += 1) {
    const output = module.outputs[index];
    if (output === undefined) {
      continue;
    }
    const entity = byId.get(`__o${index + 1}`);
    if (entity !== undefined) {
      entity.label = output.signal;
    }
  }

  for (const entity of entities) {
    if (entity.label !== undefined) {
      continue;
    }
    if (entity.id.includes("__d")) {
      const latchLabels = wires
        .filter((wire) => wire.from === entity.id)
        .map((wire) => byId.get(wire.to)?.label)
        .filter((label): label is string => label !== undefined);
      entity.label = latchLabels[0] !== undefined ? `Δ → ${latchLabels[0]}` : "Δ gate";
      continue;
    }
    if (entity.id.includes("__gate")) {
      entity.label = "gate";
      continue;
    }
    if (entity.id.includes("__mux")) {
      entity.label = "mux";
      continue;
    }
    if (entity.kind === "constant") {
      const sections = (
        entity.control_behavior.sections as
          | { sections?: Array<{ filters?: unknown[] }> }
          | undefined
      )?.sections;
      const filters = sections?.[0]?.filters ?? [];
      if (filters.length === 1 && filters[0] !== null && typeof filters[0] === "object") {
        const filter = filters[0] as { count?: number };
        if (typeof filter.count === "number") {
          entity.label = `const ${filter.count}`;
          continue;
        }
      }
      if (filters.length === 0) {
        entity.label = "I/O pad";
      }
    }
  }
}

/** Map wire/signal names → human labels for inspector slots (UI only). */
export function signalLabelMap(graph: {
  entities: CircuitEntity[];
  inputs?: CircuitGraph["inputs"];
  outputs?: CircuitGraph["outputs"];
}): Record<string, string> {
  const map: Record<string, string> = {};
  for (const port of graph.inputs ?? []) {
    map[port.signal] = port.signal;
  }
  for (const port of graph.outputs ?? []) {
    map[port.signal] = port.signal;
  }
  for (const entity of graph.entities) {
    if (entity.label === undefined) {
      continue;
    }
    map[entity.id] = entity.label;
    map[entity.outputSignal] = entity.label;
  }
  return map;
}

export function lowerToCombinators(module: IRModule): CircuitGraph {
  const storeValueByCell = new Map<string, string>();
  const nodeById = new Map(module.nodes.map((node) => [node.id, node]));
  for (const node of module.nodes) {
    if (node.kind === "store") {
      storeValueByCell.set(node.cell, node.value);
    }
  }

  /** Select node ids absorbed into an enabled-hold latch (do not emit separately). */
  const absorbedSelectIds = new Set<string>();
  /** `mem + δ` binops only used by an incremental hold — skip emitting them. */
  const absorbedBinopIds = new Set<string>();
  /** Sole-use cmps inlined into a select's decider — skip emitting them. */
  const absorbedCmpIds = new Set<string>();
  const useCount = countNodeUses(module);
  /** Sticky-clear selects fused into a decider latch (`select(mem, bool, 0)`). */
  const stickyClearSelectIds = new Set<string>();
  /**
   * Multi-use sticky enable selects: also used as `cond` of enable-holds.
   * Hold gates expand to `[run ≠ 0 ∧ then]` instead of reading the sticky output.
   */
  const stickyEnableBySelectId = new Map<string, { runId: string; thenId: string }>();
  /** Free-running `mem+δ` stores folded into the latch (memory id → δ id). */
  const freeRunningDeltaByMemory = new Map<string, string>();
  /** `select(c, mem±δ₁, mem±δ₂)` folded into delta decider + latch. */
  const deltaChooseByMemory = new Map<
    string,
    {
      select: Extract<IRNode, { kind: "select" }>;
      thenDelta: number;
      elseDelta: number;
    }
  >();
  /** `store(mem, sr(mem, set, reset))` → one cookbook SR decider latch. */
  const srByMemory = new Map<string, Extract<IRNode, { kind: "sr" }>>();
  const absorbedSrIds = new Set<string>();
  for (const node of module.nodes) {
    if (node.kind !== "memory") {
      continue;
    }
    const storeValueId = storeValueByCell.get(node.cell);
    if (storeValueId === undefined) {
      continue;
    }
    const matched = matchMemoryStore(node, storeValueId, nodeById, useCount);
    switch (matched.kind) {
      case "free-delta":
        absorbedBinopIds.add(matched.binopId);
        freeRunningDeltaByMemory.set(node.id, matched.deltaId);
        break;
      case "sr":
        absorbedSrIds.add(matched.sr.id);
        srByMemory.set(node.id, matched.sr);
        break;
      case "enable-hold":
        absorbedSelectIds.add(matched.select.id);
        // Elide `mem+δ` only when this select is its sole user.
        if (matched.deltaId !== undefined && (useCount.get(matched.select.then) ?? 0) <= 1) {
          absorbedBinopIds.add(matched.select.then);
        }
        break;
      case "sticky-clear": {
        // Sticky clear: sole-use, or only also used as cond of enable-hold selects.
        const users = nodesReferencing(matched.select.id, module);
        const onlyStoreAndHolds = users.every((user) => {
          if (
            user.kind === "store" &&
            user.value === matched.select.id &&
            user.cell === node.cell
          ) {
            return true;
          }
          return (
            user.kind === "select" &&
            user.cond === matched.select.id &&
            nodeById.get(user.else)?.kind === "memory"
          );
        });
        if (onlyStoreAndHolds) {
          absorbedSelectIds.add(matched.select.id);
          stickyClearSelectIds.add(matched.select.id);
          // Hold gates also inline this then-cmp; absorb even if useCount>1.
          const thenNode = nodeById.get(matched.select.then);
          if (thenNode?.kind === "cmp") {
            absorbedCmpIds.add(thenNode.id);
          }
          if ((useCount.get(matched.select.id) ?? 0) > 1) {
            stickyEnableBySelectId.set(matched.select.id, {
              runId: node.id,
              thenId: matched.select.then,
            });
          }
        }
        break;
      }
      case "delta-choose": {
        absorbedSelectIds.add(matched.select.id);
        absorbedBinopIds.add(matched.select.then);
        absorbedBinopIds.add(matched.select.else);
        deltaChooseByMemory.set(node.id, {
          select: matched.select,
          thenDelta: matched.thenDelta,
          elseDelta: matched.elseDelta,
        });
        const condCmp = soleUseCmp(matched.select.cond, nodeById, useCount);
        if (condCmp !== undefined) {
          absorbedCmpIds.add(condCmp.id);
        }
        break;
      }
      case "plain":
        break;
      default: {
        const unreachable: never = matched;
        throw new Error(
          `internal error: unhandled memory store match '${JSON.stringify(unreachable)}'`,
        );
      }
    }
  }
  for (const node of module.nodes) {
    if (node.kind !== "select" || absorbedSelectIds.has(node.id)) {
      continue;
    }
    const andOr = matchAndOrMux(node, nodeById, useCount);
    if (andOr !== undefined) {
      absorbedSelectIds.add(andOr.inner.id);
      const innerCmp = soleUseCmp(andOr.inner.cond, nodeById, useCount);
      if (innerCmp !== undefined) {
        absorbedCmpIds.add(innerCmp.id);
      }
      continue;
    }
    if (isBooleanOrSelect(node, nodeById)) {
      const leftNode = nodeById.get(node.then);
      const leftUses = useCount.get(node.then) ?? 0;
      if (leftNode?.kind === "cmp" && leftUses <= 2) {
        absorbedCmpIds.add(leftNode.id);
      }
      const rightCmp = soleUseCmp(node.else, nodeById, useCount);
      if (rightCmp !== undefined) {
        absorbedCmpIds.add(rightCmp.id);
      }
      continue;
    }
    const fused = fusedCmpForSelect(node, nodeById, useCount);
    if (fused !== undefined) {
      absorbedCmpIds.add(fused.id);
    }
    // Sole-use then-cmp inlined into select(c, cmp, 0) truth-AND (see lowerSelect).
    if (literalValueOf(nodeById.get(node.else)) === 0 && isBooleanValued(nodeById.get(node.then))) {
      const thenCmp = soleUseCmp(node.then, nodeById, useCount);
      if (thenCmp !== undefined) {
        absorbedCmpIds.add(thenCmp.id);
      }
    }
  }

  /** Selects sharing a cond fused into one multi-output else_outputs decider. */
  const sharedMuxBySelectId = new Map<string, string>();
  const fullMuxByCond = new Map<string, Extract<IRNode, { kind: "select" }>[]>();
  for (const node of module.nodes) {
    if (node.kind !== "select" || absorbedSelectIds.has(node.id)) {
      continue;
    }
    if (!selectUsesFullMux(node, nodeById, useCount)) {
      continue;
    }
    const group = fullMuxByCond.get(node.cond) ?? [];
    group.push(node);
    fullMuxByCond.set(node.cond, group);
  }
  for (const [condId, group] of fullMuxByCond) {
    if (group.length < 2) {
      continue;
    }
    const muxId = `__mux_${condId}`;
    for (const select of group) {
      sharedMuxBySelectId.set(select.id, muxId);
    }
  }

  /**
   * Induction memories that absorb the sticky `__run` latch into one multi-output clock.
   * Key = induction memory id; value = sticky enable + literal δ.
   */
  const fusedRunClockByMemory = new Map<
    string,
    { sticky: { runId: string; thenId: string }; deltaLit: number }
  >();
  /** `__run` memory ids emitted on a fused host (no separate sticky entity). */
  const absorbedRunMemoryIds = new Set<string>();
  /** Signal/entity id → host entity that actually carries that signal. */
  const wireHostById = new Map<string, string>();
  for (const node of module.nodes) {
    if (node.kind !== "memory") {
      continue;
    }
    const storeValueId = storeValueByCell.get(node.cell);
    if (storeValueId === undefined) {
      continue;
    }
    const storeValue = nodeById.get(storeValueId);
    if (storeValue?.kind !== "select" || !absorbedSelectIds.has(storeValue.id)) {
      continue;
    }
    if (storeValue.else !== node.id) {
      continue;
    }
    const deltaId = memPlusDelta(storeValue.then, node.id, nodeById);
    if (deltaId === undefined) {
      continue;
    }
    const deltaLit = literalValueOf(nodeById.get(deltaId));
    if (deltaLit === undefined) {
      continue;
    }
    const sticky = stickyEnableBySelectId.get(storeValue.cond);
    if (sticky === undefined) {
      continue;
    }
    // One sticky run may fuse into at most one induction clock.
    if (absorbedRunMemoryIds.has(sticky.runId)) {
      continue;
    }
    fusedRunClockByMemory.set(node.id, { sticky, deltaLit });
    absorbedRunMemoryIds.add(sticky.runId);
    wireHostById.set(sticky.runId, node.id);
  }
  const wireHost = (id: string): string => wireHostById.get(id) ?? id;

  const entities: CircuitEntity[] = [];
  const wires: WireEdge[] = [];
  const emittedSharedMuxIds = new Set<string>();

  for (const node of module.nodes) {
    switch (node.kind) {
      case "literal":
        // Emitted later only if some kept wire still references this id.
        break;
      case "input":
        entities.push(lowerInput(node));
        break;
      case "binop": {
        if (absorbedBinopIds.has(node.id)) {
          break;
        }
        const lowered = lowerBinop(node, nodeById);
        entities.push(lowered.entity);
        for (const from of lowered.wireFrom) {
          wires.push(greenWire(from, node.id));
        }
        break;
      }
      case "cmp": {
        if (absorbedCmpIds.has(node.id)) {
          break;
        }
        const lowered = lowerCmp(node, nodeById);
        entities.push(lowered.entity);
        for (const from of lowered.wireFrom) {
          wires.push(greenWire(from, node.id));
        }
        break;
      }
      case "select": {
        if (absorbedSelectIds.has(node.id)) {
          break;
        }
        const sharedMuxId = sharedMuxBySelectId.get(node.id);
        if (sharedMuxId !== undefined) {
          if (!emittedSharedMuxIds.has(sharedMuxId)) {
            emittedSharedMuxIds.add(sharedMuxId);
            const group = fullMuxByCond.get(node.cond);
            if (group === undefined) {
              throw new Error(`internal error: missing shared mux group for '${node.cond}'`);
            }
            entities.push(lowerSharedElseOutputsMux(sharedMuxId, node.cond, group));
            wires.push(greenWire(node.cond, sharedMuxId));
            for (const select of group) {
              wires.push(greenWire(select.then, sharedMuxId), greenWire(select.else, sharedMuxId));
            }
          }
          entities.push(lowerSelectMerge(node.id));
          wires.push(greenWire(sharedMuxId, node.id));
          break;
        }
        const outputUses = module.outputs.filter((output) => output.nodeId === node.id).length;
        const outputOnly = outputUses > 0 && (useCount.get(node.id) ?? 0) === outputUses;
        const expanded = lowerSelect(node, nodeById, useCount, outputOnly);
        entities.push(...expanded.entities);
        wires.push(...expanded.wires);
        break;
      }
      case "memory": {
        if (absorbedRunMemoryIds.has(node.id)) {
          // Sticky `__run` is emitted on the fused induction clock host.
          break;
        }
        const storeValueId = storeValueByCell.get(node.cell);
        if (storeValueId === undefined) {
          throw new Error(`internal error: memory cell '${node.cell}' has no store`);
        }
        const storeValue = nodeById.get(storeValueId);
        const initIsZero = literalValueOf(nodeById.get(node.init)) === 0;
        const fusedClock = fusedRunClockByMemory.get(node.id);
        if (fusedClock !== undefined) {
          const runMem = nodeById.get(fusedClock.sticky.runId);
          const runInit =
            runMem?.kind === "memory" ? (literalValueOf(nodeById.get(runMem.init)) ?? 0) : 0;
          const inductionInit = literalValueOf(nodeById.get(node.init)) ?? 0;
          const expanded = lowerFusedRunClockLatch(
            node,
            fusedClock.deltaLit,
            fusedClock.sticky,
            runInit,
            inductionInit,
            nodeById,
          );
          entities.push(...expanded.entities);
          wires.push(...expanded.wires);
          break;
        }
        if (storeValue?.kind === "select" && stickyClearSelectIds.has(storeValue.id)) {
          const expanded = lowerStickyAndLatch(node, storeValue, initIsZero, nodeById, useCount);
          entities.push(...expanded.entities);
          wires.push(...expanded.wires);
          break;
        }
        const srNode = srByMemory.get(node.id);
        if (srNode !== undefined) {
          const expanded = lowerSrLatch(node, srNode, initIsZero);
          entities.push(...expanded.entities);
          wires.push(...expanded.wires);
          break;
        }
        const deltaChoose = deltaChooseByMemory.get(node.id);
        if (deltaChoose !== undefined) {
          const expanded = lowerDeltaChooseLatch(
            node,
            deltaChoose.select,
            deltaChoose.thenDelta,
            deltaChoose.elseDelta,
            initIsZero,
            nodeById,
            useCount,
          );
          entities.push(...expanded.entities);
          wires.push(...expanded.wires);
          break;
        }
        const freeDelta = freeRunningDeltaByMemory.get(node.id);
        if (freeDelta !== undefined) {
          const expanded = lowerFreeRunningDeltaLatch(node, freeDelta, initIsZero, nodeById);
          entities.push(...expanded.entities);
          wires.push(...expanded.wires);
          break;
        }
        const expanded =
          storeValue?.kind === "select" && absorbedSelectIds.has(storeValue.id)
            ? lowerEnabledHoldLatch(
                node,
                storeValue,
                initIsZero,
                nodeById,
                stickyEnableBySelectId.get(storeValue.cond),
                wireHost,
              )
            : lowerMemory(node, storeValueId, initIsZero);
        entities.push(...expanded.entities);
        wires.push(...expanded.wires);
        break;
      }
      case "store":
        break;
      case "sr":
        if (!absorbedSrIds.has(node.id)) {
          throw new Error(`internal error: sr node '${node.id}' was not fused into a latch`);
        }
        break;
      case "signal_count": {
        const { entity, wires: countWires } = lowerSignalCount(node);
        entities.push(entity);
        wires.push(...countWires);
        break;
      }
      case "each_latch": {
        const expanded = lowerEachLatch(node);
        entities.push(...expanded.entities);
        wires.push(...expanded.wires);
        break;
      }
      case "bag_const":
        entities.push(lowerBagConst(node));
        break;
      case "bag_binop": {
        const lowered = lowerBagBinop(node);
        entities.push(lowered.entity);
        wires.push(...lowered.wires);
        break;
      }
      case "bag_filter": {
        const lowered = lowerBagFilter(node);
        entities.push(lowered.entity);
        wires.push(...lowered.wires);
        break;
      }
      case "bag_sample": {
        const lowered = lowerBagSample(node);
        entities.push(lowered.entity);
        wires.push(...lowered.wires);
        break;
      }
      case "edge": {
        const lowered = lowerEdge(node);
        entities.push(...lowered.entities);
        wires.push(...lowered.wires);
        break;
      }
      case "bag_test": {
        const lowered = lowerBagTest(node);
        entities.push(lowered.entity);
        wires.push(...lowered.wires);
        break;
      }
      case "signal_at": {
        const { entity, wires: atWires } = lowerSignalAt(node);
        entities.push(entity);
        wires.push(...atWires);
        break;
      }
      default: {
        const unreachable: never = node;
        throw new Error(`internal error: unhandled node kind '${JSON.stringify(unreachable)}'`);
      }
    }
  }

  // Materialize literals that are still referenced as wire endpoints (e.g. nonzero memory inits).
  const referenced = new Set<string>();
  for (const wire of wires) {
    referenced.add(wire.from);
    referenced.add(wire.to);
  }
  for (const output of module.outputs) {
    referenced.add(output.nodeId);
  }
  for (const node of module.nodes) {
    if (node.kind === "literal" && referenced.has(node.id)) {
      entities.push(lowerLiteral(node));
    }
  }

  const outputs = module.outputs.map((output, index) => {
    const entity = lowerOutput(output, index);
    entities.push(entity);
    wires.push(greenWire(output.nodeId, entity.id));
    return { signal: output.signal, entityId: entity.id };
  });

  const inputs = module.inputs.map((input) => ({
    signal: input.signal,
    entityId: input.nodeId,
  }));

  const known = new Set(entities.map((entity) => entity.id));
  const filteredWires = wires.filter((wire) => known.has(wire.from) && known.has(wire.to));

  annotateEntityLabels(module, entities, filteredWires);

  return { entities, wires: filteredWires, outputs, inputs };
}

/** Nodes that reference `id` (as operands / store value / etc.). */
function nodesReferencing(id: string, module: IRModule): IRNode[] {
  const users: IRNode[] = [];
  for (const node of module.nodes) {
    switch (node.kind) {
      case "literal":
      case "input":
        break;
      case "binop":
      case "cmp":
        if (node.left === id || node.right === id) {
          users.push(node);
        }
        break;
      case "select":
        if (node.cond === id || node.then === id || node.else === id) {
          users.push(node);
        }
        break;
      case "memory":
        if (node.init === id) {
          users.push(node);
        }
        break;
      case "store":
        if (node.value === id) {
          users.push(node);
        }
        break;
      case "sr":
        if (node.state === id || node.set === id || node.reset === id) {
          users.push(node);
        }
        break;
      case "signal_count":
        if (node.args.includes(id)) {
          users.push(node);
        }
        break;
      case "each_latch":
        if (node.entries.some((entry) => entry.level === id)) {
          users.push(node);
        }
        break;
      case "bag_const":
        break;
      case "bag_binop":
        if (node.left === id || node.right === id) {
          users.push(node);
        }
        break;
      case "bag_filter":
        if (node.data === id || node.mask === id) {
          users.push(node);
        }
        break;
      case "bag_sample":
        if (node.bag === id) {
          users.push(node);
        }
        break;
      case "edge":
        if (node.value === id) {
          users.push(node);
        }
        break;
      case "bag_test":
        if (node.bag === id) {
          users.push(node);
        }
        break;
      case "signal_at":
        if (node.args.includes(id)) {
          users.push(node);
        }
        break;
      default: {
        const unreachable: never = node;
        throw new Error(`internal error: unhandled node kind '${JSON.stringify(unreachable)}'`);
      }
    }
  }
  return users;
}

/** How many times each node id is referenced by other nodes / outputs (not by itself). */
function countNodeUses(module: IRModule): Map<string, number> {
  const uses = new Map<string, number>();
  const add = (id: string) => {
    uses.set(id, (uses.get(id) ?? 0) + 1);
  };
  for (const output of module.outputs) {
    add(output.nodeId);
  }
  for (const node of module.nodes) {
    switch (node.kind) {
      case "literal":
      case "input":
        break;
      case "binop":
      case "cmp":
        add(node.left);
        add(node.right);
        break;
      case "select":
        add(node.cond);
        add(node.then);
        add(node.else);
        break;
      case "memory":
        add(node.init);
        break;
      case "store":
        add(node.value);
        break;
      case "sr":
        add(node.state);
        add(node.set);
        add(node.reset);
        break;
      case "signal_count":
        for (const arg of node.args) {
          add(arg);
        }
        break;
      case "each_latch":
        for (const entry of node.entries) {
          add(entry.level);
        }
        break;
      case "bag_const":
        break;
      case "bag_binop":
        add(node.left);
        add(node.right);
        break;
      case "bag_filter":
        add(node.data);
        add(node.mask);
        break;
      case "bag_sample":
        add(node.bag);
        break;
      case "edge":
        add(node.value);
        break;
      case "bag_test":
        add(node.bag);
        break;
      case "signal_at":
        for (const arg of node.args) {
          add(arg);
        }
        break;
      default: {
        const unreachable: never = node;
        throw new Error(`internal error: unhandled node kind '${JSON.stringify(unreachable)}'`);
      }
    }
  }
  return uses;
}
