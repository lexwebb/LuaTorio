import type { IRModule, IRNode } from "./ir.js";

type ArithOp = Extract<IRNode, { kind: "binop" }>["op"];
type CmpOp = Extract<IRNode, { kind: "cmp" }>["op"];

/** Follows an alias chain to the canonical (surviving) node id. */
function resolve(id: string, alias: ReadonlyMap<string, string>): string {
  let current = id;
  while (alias.has(current)) {
    current = alias.get(current) as string;
  }
  return current;
}

function evalBinop(op: ArithOp, l: number, r: number): number {
  switch (op) {
    case "+":
      return l + r;
    case "-":
      return l - r;
    case "*":
      return l * r;
    case "/":
      return l / r;
    case "%":
      return l % r;
    default: {
      const unreachable: never = op;
      throw new Error(`internal error: unhandled arithmetic op '${JSON.stringify(unreachable)}'`);
    }
  }
}

function evalCmp(op: CmpOp, l: number, r: number): number {
  switch (op) {
    case "<":
      return l < r ? 1 : 0;
    case ">":
      return l > r ? 1 : 0;
    case "<=":
      return l <= r ? 1 : 0;
    case ">=":
      return l >= r ? 1 : 0;
    case "==":
      return l === r ? 1 : 0;
    case "~=":
      return l !== r ? 1 : 0;
    default: {
      const unreachable: never = op;
      throw new Error(`internal error: unhandled comparison op '${JSON.stringify(unreachable)}'`);
    }
  }
}

/**
 * Folds binop/cmp/select nodes whose operands are all known literals into `literal` nodes,
 * evaluating them at compile time. `select` with a literal condition is resolved by aliasing
 * its id to whichever branch is taken (the branch need not itself be a literal), rather than
 * literalizing the node.
 *
 * Relies on `module.nodes` being topologically sorted (children before parents, as produced
 * by `lower`), so a single left-to-right pass sees every child already folded/aliased.
 */
function constantFold(module: IRModule): IRModule {
  const alias = new Map<string, string>();
  const literalValueOf = new Map<string, number>();
  const nodes: IRNode[] = [];

  for (const node of module.nodes) {
    switch (node.kind) {
      case "literal":
        literalValueOf.set(node.id, node.value);
        nodes.push(node);
        break;
      case "input":
        nodes.push(node);
        break;
      case "binop": {
        const left = resolve(node.left, alias);
        const right = resolve(node.right, alias);
        const lv = literalValueOf.get(left);
        const rv = literalValueOf.get(right);
        if (lv !== undefined && rv !== undefined) {
          const value = evalBinop(node.op, lv, rv);
          literalValueOf.set(node.id, value);
          nodes.push({ kind: "literal", id: node.id, value });
        } else {
          nodes.push({ ...node, left, right });
        }
        break;
      }
      case "cmp": {
        const left = resolve(node.left, alias);
        const right = resolve(node.right, alias);
        const lv = literalValueOf.get(left);
        const rv = literalValueOf.get(right);
        if (lv !== undefined && rv !== undefined) {
          const value = evalCmp(node.op, lv, rv);
          literalValueOf.set(node.id, value);
          nodes.push({ kind: "literal", id: node.id, value });
        } else {
          nodes.push({ ...node, left, right });
        }
        break;
      }
      case "select": {
        const cond = resolve(node.cond, alias);
        const thenId = resolve(node.then, alias);
        const elseId = resolve(node.else, alias);
        const condValue = literalValueOf.get(cond);
        if (condValue !== undefined) {
          alias.set(node.id, condValue !== 0 ? thenId : elseId);
        } else {
          nodes.push({ ...node, cond, then: thenId, else: elseId });
        }
        break;
      }
      default: {
        const unreachable: never = node;
        throw new Error(`internal error: unhandled node kind '${JSON.stringify(unreachable)}'`);
      }
    }
  }

  return {
    nodes,
    outputs: module.outputs.map((output) => ({ ...output, nodeId: resolve(output.nodeId, alias) })),
    inputs: module.inputs.map((input) => ({ ...input, nodeId: resolve(input.nodeId, alias) })),
  };
}

/** Structural key for CSE: same kind+op+child ids (already-canonical), or value/signal. */
function structuralKey(node: IRNode): string {
  switch (node.kind) {
    case "literal":
      return `literal:${node.value}`;
    case "input":
      return `input:${node.signal}`;
    case "binop":
      return `binop:${node.op}:${node.left}:${node.right}`;
    case "cmp":
      return `cmp:${node.op}:${node.left}:${node.right}`;
    case "select":
      return `select:${node.cond}:${node.then}:${node.else}`;
    default: {
      const unreachable: never = node;
      throw new Error(`internal error: unhandled node kind '${JSON.stringify(unreachable)}'`);
    }
  }
}

/** Rewrites a node's child references through `resolve`, leaving `kind`/`id`/`op` untouched. */
function rewriteChildren(node: IRNode, alias: ReadonlyMap<string, string>): IRNode {
  switch (node.kind) {
    case "literal":
    case "input":
      return node;
    case "binop":
    case "cmp":
      return { ...node, left: resolve(node.left, alias), right: resolve(node.right, alias) };
    case "select":
      return {
        ...node,
        cond: resolve(node.cond, alias),
        then: resolve(node.then, alias),
        else: resolve(node.else, alias),
      };
    default: {
      const unreachable: never = node;
      throw new Error(`internal error: unhandled node kind '${JSON.stringify(unreachable)}'`);
    }
  }
}

/**
 * Common subexpression elimination: nodes with an identical structural shape (kind + op +
 * canonical child ids, or literal value / input signal) are merged into a single node, and
 * later references are aliased to the surviving (first-seen) id.
 */
function cse(module: IRModule): IRModule {
  const alias = new Map<string, string>();
  const firstIdForKey = new Map<string, string>();
  const nodes: IRNode[] = [];

  for (const node of module.nodes) {
    const rewritten = rewriteChildren(node, alias);
    const key = structuralKey(rewritten);
    const survivorId = firstIdForKey.get(key);
    if (survivorId !== undefined) {
      alias.set(node.id, survivorId);
    } else {
      firstIdForKey.set(key, node.id);
      nodes.push(rewritten);
    }
  }

  return {
    nodes,
    outputs: module.outputs.map((output) => ({ ...output, nodeId: resolve(output.nodeId, alias) })),
    inputs: module.inputs.map((input) => ({ ...input, nodeId: resolve(input.nodeId, alias) })),
  };
}

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
 * Dead code elimination: keeps only nodes reachable from `module.outputs`, plus any node
 * directly listed in `module.inputs` (external inputs are preserved even if unused, so
 * later passes/tooling can still see them).
 */
function dce(module: IRModule): IRModule {
  const nodeById = new Map(module.nodes.map((node) => [node.id, node]));
  const keep = new Set<string>();
  const stack = [
    ...module.outputs.map((output) => output.nodeId),
    ...module.inputs.map((input) => input.nodeId),
  ];

  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (keep.has(id)) {
      continue;
    }
    keep.add(id);
    const node = nodeById.get(id);
    if (node !== undefined) {
      stack.push(...childIds(node));
    }
  }

  return {
    nodes: module.nodes.filter((node) => keep.has(node.id)),
    outputs: module.outputs,
    inputs: module.inputs,
  };
}

/**
 * Optimizes an IR module by running, in order: constant folding, common subexpression
 * elimination, then dead code elimination. Each pass rewrites node/output/input references
 * so the result is a self-consistent `IRModule` (every id referenced by a node, output, or
 * input exists in `nodes`).
 */
export function optimize(module: IRModule): IRModule {
  return dce(cse(constantFold(module)));
}
