type ArithOp = "+" | "-" | "*" | "/" | "%";
type CmpOp = "<" | ">" | "<=" | ">=" | "==" | "~=";

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
}
