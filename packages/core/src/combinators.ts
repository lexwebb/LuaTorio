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

/** IR node ids referenced by `node`'s incoming edges, in a stable, deterministic order. */
function childIds(node: IRNode): string[] {
  switch (node.kind) {
    case "literal":
    case "input":
      return [];
    case "binop":
    case "cmp":
      return [node.left, node.right];
    case "select":
      return [node.cond, node.then, node.else];
    case "memory":
      return [node.init];
    case "store":
      return [node.value];
    default: {
      const unreachable: never = node;
      throw new Error(`internal error: unhandled node kind '${JSON.stringify(unreachable)}'`);
    }
  }
}

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

function lowerBinop(node: Extract<IRNode, { kind: "binop" }>): CircuitEntity {
  return {
    id: node.id,
    kind: "arithmetic",
    name: "arithmetic-combinator",
    outputSignal: node.id,
    control_behavior: {
      arithmetic_conditions: {
        first_signal: signalRef(node.left),
        second_signal: signalRef(node.right),
        operation: node.op,
        output_signal: signalRef(node.id),
      },
    },
  };
}

function lowerCmp(node: Extract<IRNode, { kind: "cmp" }>): CircuitEntity {
  return {
    id: node.id,
    kind: "decider",
    name: "decider-combinator",
    outputSignal: node.id,
    control_behavior: {
      decider_conditions: {
        conditions: [
          {
            first_signal: signalRef(node.left),
            comparator: COMPARATOR[node.op],
            second_signal: signalRef(node.right),
          },
        ],
        outputs: [{ signal: signalRef(node.id), constant: 1 }],
      },
    },
  };
}

/**
 * Faithful mux: gate `then` when cond ≠ 0, gate `else` when cond = 0, then add the two
 * (mutually exclusive) signals into `node.id`. Lua truthiness: only 0 is false.
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

function lowerSelect(node: Extract<IRNode, { kind: "select" }>): {
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

/** 1-tick delay register: passes `store.value` onto the memory signal (role: latch). */
function lowerMemory(
  node: Extract<IRNode, { kind: "memory" }>,
  storeValueId: string,
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

  return {
    entities: [entity],
    wires: [greenWire(node.init, node.id), greenWire(storeValueId, node.id)],
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
 * `select` expands to three (then-gate, else-gate, merge); `store` has no entity of its own
 * (it only contributes the value→memory wire via the paired `memory` lowering).
 */
export function lowerToCombinators(module: IRModule): CircuitGraph {
  const storeValueByCell = new Map<string, string>();
  for (const node of module.nodes) {
    if (node.kind === "store") {
      storeValueByCell.set(node.cell, node.value);
    }
  }

  const entities: CircuitEntity[] = [];
  const wires: WireEdge[] = [];

  function wireChildren(node: IRNode): void {
    for (const childId of childIds(node)) {
      wires.push(greenWire(childId, node.id));
    }
  }

  for (const node of module.nodes) {
    switch (node.kind) {
      case "literal":
        entities.push(lowerLiteral(node));
        break;
      case "input":
        entities.push(lowerInput(node));
        break;
      case "binop":
        entities.push(lowerBinop(node));
        wireChildren(node);
        break;
      case "cmp":
        entities.push(lowerCmp(node));
        wireChildren(node);
        break;
      case "select": {
        const expanded = lowerSelect(node);
        entities.push(...expanded.entities);
        wires.push(...expanded.wires);
        break;
      }
      case "memory": {
        const storeValue = storeValueByCell.get(node.cell);
        if (storeValue === undefined) {
          throw new Error(`internal error: memory cell '${node.cell}' has no store`);
        }
        const expanded = lowerMemory(node, storeValue);
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
