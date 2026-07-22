import type { IRModule, IRNode } from "./ir.js";

type CmpOp = Extract<IRNode, { kind: "cmp" }>["op"];

/** The three Factorio combinator families a v1 IR node can lower to (#8). */
export type CombinatorKind = "constant" | "arithmetic" | "decider";

/**
 * An unpositioned circuit entity: *what* combinator to place and how its `control_behavior`
 * is configured, but not *where* (layout/positions are #9) or how it's serialized into a
 * blueprint string (encoding is #10).
 *
 * `control_behavior` is a best-effort, Factorio 2.0-shaped record (`arithmetic_conditions` /
 * `decider_conditions`, or a placeholder for constant-combinator boundary markers — see
 * `lowerNode` below). The exact schema (wire-color filters, multi-condition sections, etc.)
 * is refined once the blueprint emitter (#10) is built against a real decode/encode
 * round-trip; for now the shapes here are chosen to be sensible and internally consistent.
 */
export interface CircuitEntity {
  /** IR node id, or a synthetic `__oN` id for output boundary markers (see `lowerToCombinators`). */
  id: string;
  kind: CombinatorKind;
  /** Factorio entity name, e.g. `"arithmetic-combinator"`. */
  name: string;
  control_behavior: Record<string, unknown>;
  /** Output signal name this entity produces (a temp signal like `__t3`, or a user signal). */
  outputSignal: string;
}

export interface WireEdge {
  /** Producer entity id. */
  from: string;
  /** Consumer entity id. */
  to: string;
  /** Always green in v1 — red/green wire allocation is deferred (parent design, "bundles" phase). */
  color: "green";
}

export interface CircuitGraph {
  entities: CircuitEntity[];
  wires: WireEdge[];
  outputs: Array<{ signal: string; entityId: string }>;
  inputs: Array<{ signal: string; entityId: string }>;
}

/**
 * v1 has no signal-type registry yet (parent design: "A future type checker may validate
 * names against a signal registry"), so every signal reference — temp (`__tN`) or
 * user-chosen (`signal-A`, `iron-plate`, ...) — is best-effort typed as `"virtual"` here.
 */
function signalRef(name: string): { type: "virtual"; name: string } {
  return { type: "virtual", name };
}

/** IR comparison operators to Factorio decider-combinator comparator strings. */
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
    default: {
      const unreachable: never = node;
      throw new Error(`internal error: unhandled node kind '${JSON.stringify(unreachable)}'`);
    }
  }
}

/**
 * Lowers a single IR node to its `CircuitEntity`, per the parent design's lowering table.
 *
 * `literal` and `binop`/`cmp` map straightforwardly to real, placeable combinators. `input`
 * is a *boundary placeholder*: a real `input()` reads its signal from an externally-wired
 * circuit network (layout planner, #9), it isn't a fixed-value constant combinator — so it
 * carries no filters, and exists only so the graph has a concrete node to wire from.
 */
function lowerNode(node: IRNode): CircuitEntity {
  switch (node.kind) {
    case "literal":
      return {
        id: node.id,
        kind: "constant",
        name: "constant-combinator",
        outputSignal: node.id,
        control_behavior: {
          // Factorio 2.0 constant combinators group filters into "sections"; v1 always emits
          // exactly one section with one filter carrying this node's fixed value.
          sections: {
            sections: [
              { index: 1, filters: [{ index: 1, count: node.value, ...signalRef(node.id) }] },
            ],
          },
        },
      };
    case "input":
      return {
        id: node.id,
        kind: "constant",
        name: "constant-combinator",
        outputSignal: node.signal,
        control_behavior: {
          // No filters: this is a placeholder marker, not a real fixed-value combinator (see
          // doc comment above).
          sections: { sections: [] },
        },
      };
    case "binop":
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
    case "cmp":
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
            // Decider outputs only fire on a true condition, so "else output 0" falls out
            // for free (the signal is simply absent from the wire) — matching the parent
            // table's "if A > B output 1 else 0".
            outputs: [{ signal: signalRef(node.id), constant: 1 }],
          },
        },
      };
    case "select":
      return {
        id: node.id,
        kind: "decider",
        name: "decider-combinator",
        outputSignal: node.id,
        control_behavior: {
          // NOTE (mux simplification): a single decider combinator only emits when its
          // condition is *true* — there's no built-in "else" — so this models only the
          // `then` branch (cond > 0 => pass `then`'s value through under this node's output
          // signal). A faithful mux needs two decider entities feeding the same output
          // signal on a shared wire (mutually exclusive true/false conditions); expanding
          // this single logical node into that real shape is deferred to the schema
          // refinement in #10, once positions/wiring exist to place the second entity.
          decider_conditions: {
            conditions: [{ first_signal: signalRef(node.cond), comparator: ">", constant: 0 }],
            outputs: [{ signal: signalRef(node.id), copy_count_from_input: true }],
          },
        },
      };
    default: {
      const unreachable: never = node;
      throw new Error(`internal error: unhandled node kind '${JSON.stringify(unreachable)}'`);
    }
  }
}

/**
 * Builds the boundary marker entity for one `module.outputs` entry. Mirrors the `input`
 * placeholder above: a real constant combinator can't read another signal's value, so this
 * models `output(sig, val)`'s "reads value signal, exposes as named output" as a graph-level
 * marker wired from the value's producing entity, not a literal placeable combinator. The
 * layout/emitter (#9/#10) resolves it into whatever real entity exposes the value under
 * `signal` (e.g. an arithmetic combinator that renames the signal).
 *
 * Uses a synthetic `__oN` id (1-based, in `module.outputs` order) since an output entry has
 * no IR node id of its own — it just references the value node's id.
 */
function lowerOutput(output: IRModule["outputs"][number], index: number): CircuitEntity {
  return {
    id: `__o${index + 1}`,
    kind: "constant",
    name: "constant-combinator",
    outputSignal: output.signal,
    control_behavior: {
      sections: { sections: [] },
    },
  };
}

/**
 * Lowers an `IRModule` to an unpositioned circuit graph: one `CircuitEntity` per IR node
 * (plus one boundary marker per `output()`), and a `WireEdge` for every IR edge (child ->
 * parent) and every output's value edge (producer -> output marker). No coordinates are
 * assigned yet (#9); wires don't carry connector info yet either (#10).
 */
export function lowerToCombinators(module: IRModule): CircuitGraph {
  const entities = module.nodes.map(lowerNode);
  const wires: WireEdge[] = [];

  for (const node of module.nodes) {
    for (const childId of childIds(node)) {
      wires.push({ from: childId, to: node.id, color: "green" });
    }
  }

  const outputs = module.outputs.map((output, index) => {
    const entity = lowerOutput(output, index);
    entities.push(entity);
    wires.push({ from: output.nodeId, to: entity.id, color: "green" });
    return { signal: output.signal, entityId: entity.id };
  });

  const inputs = module.inputs.map((input) => ({
    signal: input.signal,
    // Input nodes are their own boundary placeholder entity (see `lowerNode`), so the entity
    // id is just the node id — no separate marker needed, unlike outputs.
    entityId: input.nodeId,
  }));

  return { entities, wires, outputs, inputs };
}
