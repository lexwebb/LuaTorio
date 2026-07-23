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

function lowerCmp(
  node: Extract<IRNode, { kind: "cmp" }>,
  nodeById: ReadonlyMap<string, IRNode>,
): { entity: CircuitEntity; wireFrom: string[] } {
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

/** Full 3-entity mux: then-gate + else-gate + merge. */
function lowerSelectFullMux(node: Extract<IRNode, { kind: "select" }>): {
  entities: CircuitEntity[];
  wires: WireEdge[];
} {
  const thenGateId = `${node.id}__then`;
  const elseGateId = `${node.id}__else`;
  const thenGate = lowerSelectGate(thenGateId, node.cond, node.then, "!=", 0);
  const elseGate = lowerSelectGate(elseGateId, node.cond, node.else, "=", 0);

  const merge: CircuitEntity = {
    id: node.id,
    kind: "arithmetic",
    name: "arithmetic-combinator",
    outputSignal: node.id,
    control_behavior: {
      arithmetic_conditions: {
        first_signal: signalRef(node.then),
        second_signal: signalRef(node.else),
        operation: "+",
        output_signal: signalRef(node.id),
      },
    },
  };

  return {
    entities: [thenGate, elseGate, merge],
    wires: [
      greenWire(node.cond, thenGateId),
      greenWire(node.then, thenGateId),
      greenWire(node.cond, elseGateId),
      greenWire(node.else, elseGateId),
      greenWire(thenGateId, node.id),
      greenWire(elseGateId, node.id),
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

/**
 * Specialize common `select` shapes to cut the 3-entity mux tax:
 * - `select(c, lit, 0)` / `select(c, 0, lit)` → 1 decider (constant when cond matches)
 * - `select(c, bool, 0)` / `select(c, 0, bool)` → 1 AND-decider → constant 1
 * - `select(c, x, 0)` / `select(c, 0, x)` → gate + rename (2)
 * - `select(c, x, x)` → rename (1)
 * - otherwise → full 3-entity mux
 */
function lowerSelect(
  node: Extract<IRNode, { kind: "select" }>,
  nodeById: ReadonlyMap<string, IRNode>,
): {
  entities: CircuitEntity[];
  wires: WireEdge[];
} {
  const thenNode = nodeById.get(node.then);
  const elseNode = nodeById.get(node.else);
  const thenLit = literalValueOf(thenNode);
  const elseLit = literalValueOf(elseNode);

  if (node.then === node.else) {
    return {
      entities: [lowerRename(node.id, node.then)],
      wires: [greenWire(node.then, node.id)],
    };
  }

  if (elseLit === 0 && thenLit !== undefined) {
    return lowerConstWhen(node.id, node.cond, "!=", thenLit);
  }
  if (thenLit === 0 && elseLit !== undefined) {
    return lowerConstWhen(node.id, node.cond, "=", elseLit);
  }

  if (elseLit === 0 && isBooleanValued(thenNode)) {
    return lowerTruthAndToOne(node.id, node.cond, node.then, "!=");
  }
  if (thenLit === 0 && isBooleanValued(elseNode)) {
    return lowerTruthAndToOne(node.id, node.cond, node.else, "=");
  }

  if (elseLit === 0) {
    return lowerGateAndRename(node.id, node.cond, node.then, "!=");
  }
  if (thenLit === 0) {
    return lowerGateAndRename(node.id, node.cond, node.else, "=");
  }

  return lowerSelectFullMux(node);
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
 * Fuse `store(mem, select(en, next, mem))` into an enable/hold latch.
 *
 * Default: then-gate + else-gate + latch merging `next + mem` (saves the separate select merge).
 * When `next = mem + δ`: gate only δ, latch `Q + gated_δ` with Q feedback (drops the else-gate).
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

  const thenGateId = `${select.id}__then`;
  const elseGateId = `${select.id}__else`;
  const thenGate = lowerSelectGate(thenGateId, select.cond, select.then, "!=", 0);
  const elseGate = lowerSelectGate(elseGateId, select.cond, select.else, "=", 0);

  const wires: WireEdge[] = [
    greenWire(select.cond, thenGateId),
    greenWire(select.then, thenGateId),
    greenWire(select.cond, elseGateId),
    greenWire(select.else, elseGateId),
    greenWire(thenGateId, memory.id),
    greenWire(elseGateId, memory.id),
  ];
  if (!initIsZero) {
    wires.push(greenWire(memory.init, memory.id));
  }

  return {
    entities: [thenGate, elseGate, lowerLatch(memory.id, select.then, select.else)],
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
  const useCount = countNodeUses(module);
  for (const node of module.nodes) {
    if (node.kind !== "memory") {
      continue;
    }
    const storeValueId = storeValueByCell.get(node.cell);
    if (storeValueId === undefined) {
      continue;
    }
    const storeValue = nodeById.get(storeValueId);
    if (storeValue?.kind !== "select" || storeValue.else !== node.id) {
      continue;
    }
    absorbedSelectIds.add(storeValue.id);
    // Elide `mem+δ` only when this select is its sole user.
    if (
      memPlusDelta(storeValue.then, node.id, nodeById) !== undefined &&
      (useCount.get(storeValue.then) ?? 0) <= 1
    ) {
      absorbedBinopIds.add(storeValue.then);
    }
  }

  const entities: CircuitEntity[] = [];
  const wires: WireEdge[] = [];

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
        const expanded = lowerSelect(node, nodeById);
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
