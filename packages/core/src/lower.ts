import type { AnalyzedExpr, AnalyzedProgram, AnalyzedStatement } from "./analyze.js";
import type { IRModule, IRNode } from "./ir.js";

interface LowerContext {
  nodes: IRNode[];
  inputs: IRModule["inputs"];
  nextTempId: number;
  /** Memoized shared literal-0 node used as the false branch of desugared `and`. */
  zeroNodeId: string | undefined;
}

function nextId(ctx: LowerContext): string {
  const id = `__t${ctx.nextTempId}`;
  ctx.nextTempId += 1;
  return id;
}

function pushNode(ctx: LowerContext, node: IRNode): string {
  ctx.nodes.push(node);
  return node.id;
}

function getZeroNodeId(ctx: LowerContext): string {
  if (ctx.zeroNodeId !== undefined) {
    return ctx.zeroNodeId;
  }
  const id = pushNode(ctx, { kind: "literal", id: nextId(ctx), value: 0 });
  ctx.zeroNodeId = id;
  return id;
}

/**
 * Lowers a Lua `and`/`or` expression into a `select` node, since the IR has no boolean
 * operators. Circuit semantics treat non-zero as true:
 * - `a and b` -> `select(a, b, 0)` (evaluates to `b` when `a` is truthy, else `0`)
 * - `a or b`  -> `select(a, a, b)` (evaluates to `a` when `a` is truthy, else `b`)
 */
function lowerLogical(
  expr: AnalyzedExpr & { kind: "logical" },
  env: ReadonlyMap<string, string>,
  ctx: LowerContext,
): string {
  const left = lowerExpr(expr.left, env, ctx);
  const right = lowerExpr(expr.right, env, ctx);

  if (expr.op === "and") {
    const elseId = getZeroNodeId(ctx);
    const id = nextId(ctx);
    return pushNode(ctx, { kind: "select", id, cond: left, then: right, else: elseId });
  }
  const id = nextId(ctx);
  return pushNode(ctx, { kind: "select", id, cond: left, then: left, else: right });
}

function lowerExpr(
  expr: AnalyzedExpr,
  env: ReadonlyMap<string, string>,
  ctx: LowerContext,
): string {
  switch (expr.kind) {
    case "literal":
      return pushNode(ctx, { kind: "literal", id: nextId(ctx), value: expr.value });
    case "input": {
      const nodeId = pushNode(ctx, { kind: "input", id: nextId(ctx), signal: expr.signal });
      ctx.inputs.push({ signal: expr.signal, nodeId });
      return nodeId;
    }
    case "ref": {
      const nodeId = env.get(expr.name);
      if (nodeId === undefined) {
        throw new Error(`internal error: unresolved reference to local '${expr.name}'`);
      }
      return nodeId;
    }
    case "binop": {
      const left = lowerExpr(expr.left, env, ctx);
      const right = lowerExpr(expr.right, env, ctx);
      return pushNode(ctx, { kind: "binop", id: nextId(ctx), op: expr.op, left, right });
    }
    case "cmp": {
      const left = lowerExpr(expr.left, env, ctx);
      const right = lowerExpr(expr.right, env, ctx);
      return pushNode(ctx, { kind: "cmp", id: nextId(ctx), op: expr.op, left, right });
    }
    case "logical":
      return lowerLogical(expr, env, ctx);
    case "select": {
      const cond = lowerExpr(expr.cond, env, ctx);
      const thenId = lowerExpr(expr.then, env, ctx);
      const elseId = lowerExpr(expr.else, env, ctx);
      return pushNode(ctx, { kind: "select", id: nextId(ctx), cond, then: thenId, else: elseId });
    }
    default: {
      const unreachable: never = expr;
      throw new Error(`internal error: unhandled expression kind '${JSON.stringify(unreachable)}'`);
    }
  }
}

function reassignedNames(statements: AnalyzedStatement[]): Set<string> {
  const names = new Set<string>();
  for (const statement of statements) {
    if (statement.kind === "assign") {
      names.add(statement.name);
    }
  }
  return names;
}

/**
 * Lowers an analyzed program into the IR DAG. Locals that are later reassigned become
 * `memory` cells (env binds the memory id); the assignment becomes a `store`. Unreassigned
 * locals stay combinational SSA (env binds the initializer node id).
 */
export function lower(program: AnalyzedProgram): IRModule {
  const ctx: LowerContext = { nodes: [], inputs: [], nextTempId: 1, zeroNodeId: undefined };
  const env = new Map<string, string>();
  const memoryCells = reassignedNames(program.statements);
  /** cell name → memory node id (filled when the local is lowered). */
  const memoryIdByCell = new Map<string, string>();

  for (const statement of program.statements) {
    switch (statement.kind) {
      case "local": {
        const initId = lowerExpr(statement.expr, env, ctx);
        if (memoryCells.has(statement.name)) {
          const memId = nextId(ctx);
          pushNode(ctx, { kind: "memory", id: memId, cell: statement.name, init: initId });
          memoryIdByCell.set(statement.name, memId);
          env.set(statement.name, memId);
        } else {
          env.set(statement.name, initId);
        }
        break;
      }
      case "assign": {
        if (!memoryIdByCell.has(statement.name)) {
          throw new Error(`internal error: assign to '${statement.name}' without memory cell`);
        }
        const valueId = lowerExpr(statement.expr, env, ctx);
        pushNode(ctx, { kind: "store", id: nextId(ctx), cell: statement.name, value: valueId });
        break;
      }
    }
  }

  const outputs: IRModule["outputs"] = program.outputs.map((output) => ({
    signal: output.signal,
    nodeId: lowerExpr(output.expr, env, ctx),
  }));

  return { nodes: ctx.nodes, outputs, inputs: ctx.inputs };
}
