type ArithOp = "+" | "-" | "*" | "/" | "%";
type CmpOp = "<" | ">" | "<=" | ">=" | "==" | "~=";

/**
 * v1 IR DAG node. `id` doubles as the temp signal name (`__t1`, `__t2`, …) that the node's
 * value is carried on once combinators are emitted (#8). Child references are node ids
 * (strings), not nested nodes, so the module is a flat, shareable DAG.
 */
export type IRNode =
  | { kind: "literal"; id: string; value: number }
  | { kind: "input"; id: string; signal: string }
  | { kind: "binop"; id: string; op: ArithOp; left: string; right: string }
  | { kind: "cmp"; id: string; op: CmpOp; left: string; right: string }
  | { kind: "select"; id: string; cond: string; then: string; else: string };

export interface IRModule {
  /** Flat node list; `id === temp signal name`. */
  nodes: IRNode[];
  outputs: Array<{ signal: string; nodeId: string }>;
  inputs: Array<{ signal: string; nodeId: string }>;
}
