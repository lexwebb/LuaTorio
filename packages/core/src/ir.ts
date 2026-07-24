type ArithOp = "+" | "-" | "*" | "/" | "%";
type CmpOp = "<" | ">" | "<=" | ">=" | "==" | "~=";

/** Entities allowed in `place(name, x, y)`. Single source of truth for analyze + emit. */
export const PLACEABLE_ENTITIES = [
  "wooden-chest",
  "iron-chest",
  "steel-chest",
  "small-lamp",
  "small-electric-pole",
  "medium-electric-pole",
  "big-electric-pole",
  "substation",
  "logistic-chest-passive-provider",
  "logistic-chest-active-provider",
  "logistic-chest-storage",
  "logistic-chest-buffer",
  "logistic-chest-requester",
  "assembling-machine-1",
  "assembling-machine-2",
  "assembling-machine-3",
  "foundry",
  "roboport",
] as const;

export type PlaceableEntity = (typeof PLACEABLE_ENTITIES)[number];

const LOGISTIC_CHEST_SET = new Set<PlaceableEntity>([
  "logistic-chest-passive-provider",
  "logistic-chest-active-provider",
  "logistic-chest-storage",
  "logistic-chest-buffer",
  "logistic-chest-requester",
]);

const ASSEMBLER_SET = new Set<PlaceableEntity>([
  "assembling-machine-1",
  "assembling-machine-2",
  "assembling-machine-3",
  "foundry",
]);

export function isLogisticChest(name: PlaceableEntity): boolean {
  return LOGISTIC_CHEST_SET.has(name);
}

export function isAssembler(name: PlaceableEntity): boolean {
  return ASSEMBLER_SET.has(name);
}

export function isRoboport(name: PlaceableEntity): boolean {
  return name === "roboport";
}

/** Literal circuit condition for chest / assembler enable (ASCII comparators). */
export interface PlaceCircuitCondition {
  first_signal: string;
  comparator: CmpOp;
  constant?: number;
  second_signal?: string;
}

/** A non-combinator entity at an absolute Factorio tile coordinate. */
export interface SpatialPlace {
  id: string;
  name: PlaceableEntity;
  x: number;
  y: number;
  logistic?: {
    read_contents?: boolean;
    set_requests?: boolean;
    request_from_buffers?: boolean;
    request_filters?: Array<{ signal: string; count: number }>;
    circuit_condition_enabled?: boolean;
    circuit_condition?: PlaceCircuitCondition;
  };
  assembler?: {
    set_recipe?: boolean;
    circuit_enabled?: boolean;
    read_contents?: boolean;
    recipe?: string;
    circuit_condition?: PlaceCircuitCondition;
  };
  /** Roboport `read_items_mode`: 0 none, 1 logistics, 2 missing_requests. */
  roboport?: {
    read_items_mode?: number;
  };
  /** Combinator entity ids to wire after layout. */
  circuit?: {
    readConsumerIds?: string[];
    writeProducerIds?: string[];
  };
}

/**
 * Signal-value IR node. `id` doubles as the temp signal name (`__t1`, `__t2`, …) that the
 * node's value is carried on once combinators are emitted. Child references are node ids
 * (strings), not nested nodes, so the module is a flat, shareable DAG.
 *
 * `memory` / `store` latch values; feedback wires appear only at the combinator layer.
 */
export type IRNode =
  | { kind: "literal"; id: string; value: number }
  | { kind: "input"; id: string; signal: string }
  /** Bag read from a placed entity; emits no combinator itself. */
  | { kind: "entity_read"; id: string; entityId: string }
  | { kind: "binop"; id: string; op: ArithOp; left: string; right: string }
  | { kind: "cmp"; id: string; op: CmpOp; left: string; right: string }
  | { kind: "select"; id: string; cond: string; then: string; else: string }
  | { kind: "memory"; id: string; cell: string; init: string }
  | { kind: "store"; id: string; cell: string; value: string }
  /** Cookbook SR: Q' = (Q ∨ set) ∧ ¬reset → 0/1. */
  | { kind: "sr"; id: string; state: string; set: string; reset: string }
  /** Count nonzero unique arg signals → one selector combinator (`operation: "count"`). */
  | { kind: "signal_count"; id: string; args: string[] }
  /**
   * EACH-tag sticky hysteresis latch (#46): constant signal tags + one multi-OR decider.
   * `level` is an IR node id; `signal` is the emit name; `tag` is unique ≥ 1.
   */
  | {
      kind: "each_latch";
      id: string;
      entries: Array<{ level: string; signal: string; buffer: number; tag: number }>;
    }
  /** Constant multi-signal bag. */
  | { kind: "bag_const"; id: string; entries: Array<{ signal: string; count: number }> }
  /** Pairwise EACH arithmetic: left on red, right on green, result on EACH. */
  | { kind: "bag_binop"; id: string; op: ArithOp; left: string; right: string }
  /** Cookbook 3–5: per-channel presence / limit filter, data on red and mask on green. */
  | {
      kind: "bag_filter";
      id: string;
      mode: "include" | "exclude" | "limit";
      data: string;
      mask: string;
    }
  /** Copy one named channel from a bag onto a scalar temp signal. */
  | { kind: "bag_sample"; id: string; bag: string; signal: string }
  /** Scalar rising edge: current input is greater than its one-tick delayed value. */
  | { kind: "edge"; id: string; value: string }
  /** Test all or any present channels in a bag against a literal threshold. */
  | { kind: "bag_test"; id: string; mode: "any" | "every"; op: CmpOp; bag: string; value: number }
  /**
   * Selector rank/index (#47): pick the Nth nonzero arg by value.
   * `ascending` → Factorio `select_max: false` (index 0 = minimum).
   */
  | {
      kind: "signal_at";
      id: string;
      index: number;
      ascending: boolean;
      args: string[];
    };

export interface IRModule {
  /** Flat node list; `id === temp signal name`. */
  nodes: IRNode[];
  outputs: Array<{ signal: string; nodeId: string }>;
  inputs: Array<{ signal: string; nodeId: string }>;
  /** Separate from the signal graph; emitted after combinator layout. */
  places?: SpatialPlace[];
}
