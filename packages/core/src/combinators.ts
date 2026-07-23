import type { IRModule, IRNode } from "./ir.js";

type CmpOp = Extract<IRNode, { kind: "cmp" }>["op"];

/** The three Factorio combinator families a v1/v2 IR node can lower to. */
export type CombinatorKind = "constant" | "arithmetic" | "decider";

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
  /** IR node id, synthetic `__oN` output marker, or mux-side id like `__t4__else`. */
  id: string;
  kind: CombinatorKind;
  /** Factorio entity name, e.g. `"arithmetic-combinator"`. */
  name: string;
  control_behavior: Record<string, unknown>;
  /** Output signal name this entity produces (a temp signal like `__t3`, or a user signal). */
  outputSignal: string;
  role?: CircuitRole;
}

export interface WireEdge {
  /** Producer entity id. */
  from: string;
  /** Consumer entity id. */
  to: string;
  /** Always green in v1/v2 phase 1 — red/green allocation is deferred to v4. */
  color: "green";
}

export interface CircuitGraph {
  entities: CircuitEntity[];
  wires: WireEdge[];
  outputs: Array<{ signal: string; entityId: string }>;
  inputs: Array<{ signal: string; entityId: string }>;
}

function signalRef(name: string): { type: "virtual"; name: string } {
  return { type: "virtual", name };
}

function greenWire(from: string, to: string): WireEdge {
  return { from, to, color: "green" };
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
    outputSignal: node.signal,
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

/** Gate `branchId` under `cond`, then rename onto `nodeId` (2 entities). */
function lowerGateAndRename(
  nodeId: string,
  condId: string,
  branchId: string,
  comparator: "=" | "!=",
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  const gateId = `${nodeId}__gate`;
  const gate = lowerSelectGate(gateId, condId, branchId, comparator, 0);
  return {
    entities: [gate, lowerRename(nodeId, branchId)],
    wires: [greenWire(condId, gateId), greenWire(branchId, gateId), greenWire(gateId, nodeId)],
  };
}

/**
 * Gate `branchId` with an inlined sole-use cmp, then rename onto `nodeId`.
 * `whenCmpPasses`: `select(cmp, x, 0)`; else `select(cmp, 0, x)` via `else_outputs`.
 */
function lowerGateByCmpAndRename(
  nodeId: string,
  cmp: Extract<IRNode, { kind: "cmp" }>,
  branchId: string,
  nodeById: ReadonlyMap<string, IRNode>,
  whenCmpPasses: boolean,
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  const gateId = `${nodeId}__gate`;
  const { condition, wireFrom } = cmpCondition(cmp, nodeById);
  const copy = { signal: signalRef(branchId), copy_count_from_input: true };
  const gate: CircuitEntity = {
    id: gateId,
    kind: "decider",
    name: "decider-combinator",
    outputSignal: branchId,
    role: "mux-side",
    control_behavior: {
      decider_conditions: whenCmpPasses
        ? { conditions: [condition], outputs: [copy] }
        : { conditions: [condition], outputs: [], else_outputs: [copy] },
    },
  };
  return {
    entities: [gate, lowerRename(nodeId, branchId)],
    wires: [
      ...wireFrom.map((from) => greenWire(from, gateId)),
      greenWire(branchId, gateId),
      greenWire(gateId, nodeId),
    ],
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

function isBooleanOrSelect(
  node: Extract<IRNode, { kind: "select" }>,
  nodeById: ReadonlyMap<string, IRNode>,
): boolean {
  return (
    node.cond === node.then &&
    isBooleanValued(nodeById.get(node.then)) &&
    isBooleanValued(nodeById.get(node.else))
  );
}

/** True when lowerSelect would emit else_outputs mux + merge (not a cheaper specialization). */
function selectUsesFullMux(
  node: Extract<IRNode, { kind: "select" }>,
  nodeById: ReadonlyMap<string, IRNode>,
): boolean {
  if (node.then === node.else) {
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

function lowerSelectMerge(id: string, thenSignal: string, elseSignal: string): CircuitEntity {
  return {
    id,
    kind: "arithmetic",
    name: "arithmetic-combinator",
    outputSignal: id,
    control_behavior: {
      arithmetic_conditions: {
        first_signal: signalRef(thenSignal),
        second_signal: signalRef(elseSignal),
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
      lowerSelectMerge(node.id, node.then, node.else),
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
    entities: [mux, lowerSelectMerge(node.id, node.then, node.else)],
    wires: [
      ...wireFrom.map((from) => greenWire(from, muxId)),
      greenWire(node.then, muxId),
      greenWire(node.else, muxId),
      greenWire(muxId, node.id),
    ],
  };
}

function literalValueOf(node: IRNode | undefined): number | undefined {
  return node?.kind === "literal" ? node.value : undefined;
}

/** Nodes known to carry only 0 or 1 (cmp results / 0-1 literals). */
function isBooleanValued(node: IRNode | undefined): boolean {
  if (node === undefined) {
    return false;
  }
  if (node.kind === "cmp") {
    return true;
  }
  if (node.kind === "literal") {
    return node.value === 0 || node.value === 1;
  }
  return false;
}

/** Sole-use `cmp` usable as an inlined select condition (not shared elsewhere). */
function soleUseCmp(
  condId: string,
  nodeById: ReadonlyMap<string, IRNode>,
  useCount: ReadonlyMap<string, number>,
): Extract<IRNode, { kind: "cmp" }> | undefined {
  if ((useCount.get(condId) ?? 0) > 1) {
    return undefined;
  }
  const cond = nodeById.get(condId);
  return cond?.kind === "cmp" ? cond : undefined;
}

/**
 * Cmp that `lowerSelect` will inline (sole-use; not unused; not inverted truth-and).
 * Absorption of cmp entities must use this same predicate.
 */
function fusedCmpForSelect(
  node: Extract<IRNode, { kind: "select" }>,
  nodeById: ReadonlyMap<string, IRNode>,
  useCount: ReadonlyMap<string, number>,
): Extract<IRNode, { kind: "cmp" }> | undefined {
  if (node.then === node.else) {
    return undefined;
  }
  const fused = soleUseCmp(node.cond, nodeById, useCount);
  if (fused === undefined) {
    return undefined;
  }
  // Inverted truth-and still needs a 0/1 cond signal.
  if (
    literalValueOf(nodeById.get(node.then)) === 0 &&
    isBooleanValued(nodeById.get(node.else))
  ) {
    return undefined;
  }
  return fused;
}

/**
 * Specialize common `select` shapes to cut the 3-entity mux tax:
 * - `select(c, lit, 0)` / `select(c, 0, lit)` → 1 decider (constant when cond matches)
 * - `select(c, bool, 0)` / `select(c, 0, bool)` → 1 AND-decider → constant 1
 * - `select(a, a, b)` when a,b boolean → 1 OR-decider → constant 1
 * - `select(c, x, 0)` / `select(c, 0, x)` → gate + rename (2)
 * - `select(c, x, x)` → rename (1)
 * - otherwise → else_outputs mux + merge (2)
 * When `c` is a sole-use cmp, its condition is inlined and the cmp entity is omitted.
 */
function lowerSelect(
  node: Extract<IRNode, { kind: "select" }>,
  nodeById: ReadonlyMap<string, IRNode>,
  useCount: ReadonlyMap<string, number>,
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
    return fusedCmp
      ? lowerTruthAndFromCmp(node.id, fusedCmp, node.then, nodeById)
      : lowerTruthAndToOne(node.id, node.cond, node.then, "!=");
  }
  if (thenLit === 0 && isBooleanValued(elseNode)) {
    return lowerTruthAndToOne(node.id, node.cond, node.else, "=");
  }

  if (elseLit === 0) {
    return fusedCmp
      ? lowerGateByCmpAndRename(node.id, fusedCmp, node.then, nodeById, true)
      : lowerGateAndRename(node.id, node.cond, node.then, "!=");
  }
  if (thenLit === 0) {
    return fusedCmp
      ? lowerGateByCmpAndRename(node.id, fusedCmp, node.else, nodeById, false)
      : lowerGateAndRename(node.id, node.cond, node.else, "=");
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

  return fusedCmp
    ? lowerSelectFullMuxFromCmp(node, fusedCmp, nodeById)
    : lowerSelectFullMux(node);
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

/** If `thenId` is `memoryId + δ` (either operand order), return δ. */
function memPlusDelta(
  thenId: string,
  memoryId: string,
  nodeById: ReadonlyMap<string, IRNode>,
): string | undefined {
  const thenNode = nodeById.get(thenId);
  if (thenNode?.kind !== "binop" || thenNode.op !== "+") {
    return undefined;
  }
  if (thenNode.left === memoryId) {
    return thenNode.right;
  }
  if (thenNode.right === memoryId) {
    return thenNode.left;
  }
  return undefined;
}

function lowerLatch(
  id: string,
  firstSignal: string,
  secondSignal: string,
): CircuitEntity {
  return {
    id,
    kind: "arithmetic",
    name: "arithmetic-combinator",
    outputSignal: id,
    role: "latch",
    control_behavior: {
      arithmetic_conditions: {
        first_signal: signalRef(firstSignal),
        second_signal: signalRef(secondSignal),
        operation: "+",
        output_signal: signalRef(id),
      },
    },
  };
}

/**
 * Incremental enable-hold when `next = mem + δ`: gate only δ, latch `Q + gated_δ`
 * with Q feedback (no else-gate). Literal δ is emitted under a unique signal so it
 * cannot collide with a nonzero init on the latch net (e.g. `for i = 1, n` / `i+1`).
 */
function lowerIncrementalHoldLatch(
  memory: Extract<IRNode, { kind: "memory" }>,
  select: Extract<IRNode, { kind: "select" }>,
  deltaId: string,
  initIsZero: boolean,
  nodeById: ReadonlyMap<string, IRNode>,
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  const deltaGateId = `${select.id}__d`;
  const deltaLit = literalValueOf(nodeById.get(deltaId));

  let deltaGate: CircuitEntity;
  let gatedDeltaSignal: string;
  if (deltaLit !== undefined) {
    gatedDeltaSignal = deltaGateId;
    deltaGate = {
      id: deltaGateId,
      kind: "decider",
      name: "decider-combinator",
      outputSignal: deltaGateId,
      role: "mux-side",
      control_behavior: {
        decider_conditions: {
          conditions: [{ first_signal: signalRef(select.cond), comparator: "!=", constant: 0 }],
          outputs: [{ signal: signalRef(deltaGateId), constant: deltaLit }],
        },
      },
    };
  } else {
    gatedDeltaSignal = deltaId;
    deltaGate = lowerSelectGate(deltaGateId, select.cond, deltaId, "!=", 0);
  }

  const wires: WireEdge[] = [greenWire(select.cond, deltaGateId)];
  if (deltaLit === undefined) {
    wires.push(greenWire(deltaId, deltaGateId));
  }
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

/**
 * `store(mem, select(mem, bool, 0))` with the select unused elsewhere — one decider latch
 * (cookbook sticky/SR-shaped: Q' = Q ∧ cond as constant 1). Init wires when nonzero.
 */
function isStickyClearSelect(
  select: Extract<IRNode, { kind: "select" }>,
  memoryId: string,
  nodeById: ReadonlyMap<string, IRNode>,
): boolean {
  return (
    select.cond === memoryId &&
    literalValueOf(nodeById.get(select.else)) === 0 &&
    isBooleanValued(nodeById.get(select.then))
  );
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
    thenCond = {
      first_signal: signalRef(select.then),
      comparator: "!=",
      constant: 0,
      compare_type: "and",
    };
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
            conditions: [
              { first_signal: signalRef(memory.id), comparator: "!=", constant: 0 },
              thenCond,
            ],
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
 * Fuse `store(mem, select(en, next, mem))` into an enable/hold latch.
 *
 * When `next = mem + δ`: gate only δ, latch `Q + gated_δ` with Q feedback.
 * Otherwise: one decider with else_outputs (next vs mem) + latch merge (−1 vs two gates).
 */
function lowerEnabledHoldLatch(
  memory: Extract<IRNode, { kind: "memory" }>,
  select: Extract<IRNode, { kind: "select" }>,
  initIsZero: boolean,
  nodeById: ReadonlyMap<string, IRNode>,
): { entities: CircuitEntity[]; wires: WireEdge[] } {
  const deltaId = memPlusDelta(select.then, memory.id, nodeById);
  if (deltaId !== undefined) {
    return lowerIncrementalHoldLatch(memory, select, deltaId, initIsZero, nodeById);
  }

  const muxId = `${select.id}__mux`;
  const wires: WireEdge[] = [
    greenWire(select.cond, muxId),
    greenWire(select.then, muxId),
    greenWire(select.else, muxId),
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
 */
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
  for (const node of module.nodes) {
    if (node.kind !== "memory") {
      continue;
    }
    const storeValueId = storeValueByCell.get(node.cell);
    if (storeValueId === undefined) {
      continue;
    }
    const storeValue = nodeById.get(storeValueId);
    if (storeValue?.kind !== "select") {
      continue;
    }
    if (storeValue.else === node.id) {
      absorbedSelectIds.add(storeValue.id);
      // Elide `mem+δ` only when this select is its sole user.
      if (
        memPlusDelta(storeValue.then, node.id, nodeById) !== undefined &&
        (useCount.get(storeValue.then) ?? 0) <= 1
      ) {
        absorbedBinopIds.add(storeValue.then);
      }
      continue;
    }
    // Sticky clear only when this select is solely the store value (not also an enable).
    if (
      isStickyClearSelect(storeValue, node.id, nodeById) &&
      (useCount.get(storeValue.id) ?? 0) <= 1
    ) {
      absorbedSelectIds.add(storeValue.id);
      stickyClearSelectIds.add(storeValue.id);
      const thenCmp = soleUseCmp(storeValue.then, nodeById, useCount);
      if (thenCmp !== undefined) {
        absorbedCmpIds.add(thenCmp.id);
      }
    }
  }
  for (const node of module.nodes) {
    if (node.kind !== "select" || absorbedSelectIds.has(node.id)) {
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
  }

  /** Selects sharing a cond fused into one multi-output else_outputs decider. */
  const sharedMuxBySelectId = new Map<string, string>();
  const fullMuxByCond = new Map<string, Extract<IRNode, { kind: "select" }>[]>();
  for (const node of module.nodes) {
    if (node.kind !== "select" || absorbedSelectIds.has(node.id)) {
      continue;
    }
    if (!selectUsesFullMux(node, nodeById)) {
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
          entities.push(lowerSelectMerge(node.id, node.then, node.else));
          wires.push(greenWire(sharedMuxId, node.id));
          break;
        }
        const expanded = lowerSelect(node, nodeById, useCount);
        entities.push(...expanded.entities);
        wires.push(...expanded.wires);
        break;
      }
      case "memory": {
        const storeValueId = storeValueByCell.get(node.cell);
        if (storeValueId === undefined) {
          throw new Error(`internal error: memory cell '${node.cell}' has no store`);
        }
        const storeValue = nodeById.get(storeValueId);
        const initIsZero = literalValueOf(nodeById.get(node.init)) === 0;
        if (storeValue?.kind === "select" && stickyClearSelectIds.has(storeValue.id)) {
          const expanded = lowerStickyAndLatch(node, storeValue, initIsZero, nodeById, useCount);
          entities.push(...expanded.entities);
          wires.push(...expanded.wires);
          break;
        }
        const expanded =
          storeValue?.kind === "select" && absorbedSelectIds.has(storeValue.id)
            ? lowerEnabledHoldLatch(node, storeValue, initIsZero, nodeById)
            : lowerMemory(node, storeValueId, initIsZero);
        entities.push(...expanded.entities);
        wires.push(...expanded.wires);
        break;
      }
      case "store":
        break;
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

  return { entities, wires: filteredWires, outputs, inputs };
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
      default: {
        const unreachable: never = node;
        throw new Error(`internal error: unhandled node kind '${JSON.stringify(unreachable)}'`);
      }
    }
  }
  return uses;
}
