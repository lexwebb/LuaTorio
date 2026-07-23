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
  | { kind: "sr"; id: string; state: string; set: string; reset: string };

export interface IRModule {
  /** Flat node list; `id === temp signal name`. */
  nodes: IRNode[];
  outputs: Array<{ signal: string; nodeId: string }>;
  inputs: Array<{ signal: string; nodeId: string }>;
}
