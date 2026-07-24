import type {
  AnalyzedAssign,
  AnalyzedExpr,
  AnalyzedLoopBodyStmt,
  AnalyzedProgram,
  AnalyzedStatement,
} from "./analyze.js";
import type { IRModule, IRNode, SpatialPlace } from "./ir.js";

/** Synthetic memory cell for clocked while/for sticky-run latch. */
export const RUN_CELL = "__run";

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
    case "entity_ref":
      throw new Error("internal error: entity handles cannot be lowered as signal values");
    case "entity_read":
      return pushNode(ctx, { kind: "entity_read", id: nextId(ctx), entityId: expr.entityId });
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
    case "sr":
      throw new Error(
        "internal error: sr() must be lowered via assignment, not as a bare expression",
      );
    case "signal_count": {
      const args = expr.args.map((arg) => lowerExpr(arg, env, ctx));
      return pushNode(ctx, { kind: "signal_count", id: nextId(ctx), args });
    }
    case "each_latch": {
      const entries = expr.entries.map((entry) => ({
        level: lowerExpr(entry.level, env, ctx),
        signal: entry.signal,
        buffer: entry.buffer,
        tag: entry.tag,
      }));
      return pushNode(ctx, { kind: "each_latch", id: nextId(ctx), entries });
    }
    case "bag_const":
      return pushNode(ctx, { kind: "bag_const", id: nextId(ctx), entries: expr.entries });
    case "bag_binop": {
      const left = lowerExpr(expr.left, env, ctx);
      const right = lowerExpr(expr.right, env, ctx);
      return pushNode(ctx, { kind: "bag_binop", id: nextId(ctx), op: expr.op, left, right });
    }
    case "bag_filter": {
      const data = lowerExpr(expr.data, env, ctx);
      const mask = lowerExpr(expr.mask, env, ctx);
      return pushNode(ctx, { kind: "bag_filter", id: nextId(ctx), mode: expr.mode, data, mask });
    }
    case "bag_sample": {
      const bag = lowerExpr(expr.bag, env, ctx);
      return pushNode(ctx, { kind: "bag_sample", id: nextId(ctx), bag, signal: expr.signal });
    }
    case "edge": {
      const value = lowerExpr(expr.value, env, ctx);
      return pushNode(ctx, { kind: "edge", id: nextId(ctx), value });
    }
    case "bag_test": {
      const bag = lowerExpr(expr.bag, env, ctx);
      return pushNode(ctx, {
        kind: "bag_test",
        id: nextId(ctx),
        mode: expr.mode,
        op: expr.op,
        bag,
        value: expr.value,
      });
    }
    case "signal_at": {
      const args = expr.args.map((arg) => lowerExpr(arg, env, ctx));
      return pushNode(ctx, {
        kind: "signal_at",
        id: nextId(ctx),
        index: expr.index,
        ascending: expr.ascending,
        args,
      });
    }
    default: {
      const unreachable: never = expr;
      throw new Error(`internal error: unhandled expression kind '${JSON.stringify(unreachable)}'`);
    }
  }
}

function assignMap(assigns: AnalyzedAssign[]): Map<string, AnalyzedAssign> {
  return new Map(assigns.map((assign) => [assign.name, assign]));
}

function collectAssignNames(assigns: AnalyzedAssign[], names: Set<string>): void {
  for (const assign of assigns) names.add(assign.name);
}

function collectBodyReassigned(body: AnalyzedLoopBodyStmt[], names: Set<string>): void {
  for (const statement of body) {
    if (statement.kind === "assign") {
      names.add(statement.name);
    } else {
      collectAssignNames(statement.thenAssigns, names);
      collectAssignNames(statement.elseAssigns, names);
    }
  }
}

function reassignedNames(statements: AnalyzedStatement[]): Set<string> {
  const names = new Set<string>();
  for (const statement of statements) {
    switch (statement.kind) {
      case "assign":
        names.add(statement.name);
        break;
      case "if":
        collectAssignNames(statement.thenAssigns, names);
        collectAssignNames(statement.elseAssigns, names);
        break;
      case "while":
        collectBodyReassigned(statement.body, names);
        names.add(RUN_CELL);
        break;
      case "for":
        collectBodyReassigned(statement.body, names);
        names.add(statement.name);
        names.add(RUN_CELL);
        break;
      default:
        break;
    }
  }
  return names;
}

function wrapWithEnable(
  enableId: string,
  bodyNextId: string,
  memId: string,
  ctx: LowerContext,
): string {
  return pushNode(ctx, {
    kind: "select",
    id: nextId(ctx),
    cond: enableId,
    then: bodyNextId,
    else: memId,
  });
}

/** Create `__run` memory (init=1). Called once per clocked program. */
function createRunMemory(
  memoryIdByCell: Map<string, string>,
  env: Map<string, string>,
  ctx: LowerContext,
): string {
  const oneId = pushNode(ctx, { kind: "literal", id: nextId(ctx), value: 1 });
  const memId = nextId(ctx);
  pushNode(ctx, { kind: "memory", id: memId, cell: RUN_CELL, init: oneId });
  memoryIdByCell.set(RUN_CELL, memId);
  env.set(RUN_CELL, memId);
  return memId;
}

function lowerEnable(runMemId: string, condId: string, ctx: LowerContext): string {
  return pushNode(ctx, {
    kind: "select",
    id: nextId(ctx),
    cond: runMemId,
    then: condId,
    else: getZeroNodeId(ctx),
  });
}

/**
 * `__run' = select(__run, cond, 0)` — sticky exit once cond fails while running.
 * Same truthiness as the older `select(__run, select(cond, 1, 0), 0)` form; when `cond` is
 * already a 0/1 cmp (the common loop case), CSE can share this with `enable`.
 */
function lowerRunUpdate(runMemId: string, condId: string, ctx: LowerContext): void {
  const nextRunId = pushNode(ctx, {
    kind: "select",
    id: nextId(ctx),
    cond: runMemId,
    then: condId,
    else: getZeroNodeId(ctx),
  });
  pushNode(ctx, { kind: "store", id: nextId(ctx), cell: RUN_CELL, value: nextRunId });
}

function requireMemoryId(memoryIdByCell: ReadonlyMap<string, string>, cell: string): string {
  const memId = memoryIdByCell.get(cell);
  if (memId === undefined) {
    throw new Error(`internal error: assign to '${cell}' without memory cell`);
  }
  return memId;
}

function lowerAssignStore(
  statement: Extract<AnalyzedStatement, { kind: "assign" }>,
  memoryIdByCell: ReadonlyMap<string, string>,
  env: ReadonlyMap<string, string>,
  ctx: LowerContext,
  enableId: string | undefined,
): void {
  const memId = requireMemoryId(memoryIdByCell, statement.name);
  if (statement.expr.kind === "sr") {
    const setId = lowerExpr(statement.expr.set, env, ctx);
    const resetId = lowerExpr(statement.expr.reset, env, ctx);
    const srId = pushNode(ctx, {
      kind: "sr",
      id: nextId(ctx),
      state: memId,
      set: setId,
      reset: resetId,
    });
    const storeValue = enableId !== undefined ? wrapWithEnable(enableId, srId, memId, ctx) : srId;
    pushNode(ctx, { kind: "store", id: nextId(ctx), cell: statement.name, value: storeValue });
    return;
  }
  const valueId = lowerExpr(statement.expr, env, ctx);
  const storeValue =
    enableId !== undefined ? wrapWithEnable(enableId, valueId, memId, ctx) : valueId;
  pushNode(ctx, { kind: "store", id: nextId(ctx), cell: statement.name, value: storeValue });
}

function lowerIfStore(
  statement: Extract<AnalyzedStatement, { kind: "if" }>,
  memoryIdByCell: ReadonlyMap<string, string>,
  env: ReadonlyMap<string, string>,
  ctx: LowerContext,
  enableId: string | undefined,
): void {
  const condId = lowerExpr(statement.cond, env, ctx);
  const thenByName = assignMap(statement.thenAssigns);
  const elseByName = assignMap(statement.elseAssigns);
  const cells = new Set([...thenByName.keys(), ...elseByName.keys()]);

  for (const cell of cells) {
    const memId = requireMemoryId(memoryIdByCell, cell);
    const thenAssign = thenByName.get(cell);
    const elseAssign = elseByName.get(cell);
    const thenId = thenAssign ? lowerExpr(thenAssign.expr, env, ctx) : memId;
    const elseId = elseAssign ? lowerExpr(elseAssign.expr, env, ctx) : memId;
    // Phase-2 mux first, then optional enable wrap for clocked loops.
    const muxedId = pushNode(ctx, {
      kind: "select",
      id: nextId(ctx),
      cond: condId,
      then: thenId,
      else: elseId,
    });
    const valueId =
      enableId !== undefined ? wrapWithEnable(enableId, muxedId, memId, ctx) : muxedId;
    pushNode(ctx, { kind: "store", id: nextId(ctx), cell, value: valueId });
  }
}

function lowerLoopBody(
  body: AnalyzedLoopBodyStmt[],
  memoryIdByCell: ReadonlyMap<string, string>,
  env: ReadonlyMap<string, string>,
  ctx: LowerContext,
  enableId: string,
): void {
  for (const statement of body) {
    if (statement.kind === "assign") {
      lowerAssignStore(statement, memoryIdByCell, env, ctx, enableId);
    } else {
      lowerIfStore(statement, memoryIdByCell, env, ctx, enableId);
    }
  }
}

function lowerWhile(
  statement: Extract<AnalyzedStatement, { kind: "while" }>,
  memoryIdByCell: Map<string, string>,
  env: Map<string, string>,
  ctx: LowerContext,
): void {
  const runMemId = createRunMemory(memoryIdByCell, env, ctx);
  const condId = lowerExpr(statement.cond, env, ctx);
  const enableId = lowerEnable(runMemId, condId, ctx);
  lowerLoopBody(statement.body, memoryIdByCell, env, ctx, enableId);
  lowerRunUpdate(runMemId, condId, ctx);
}

function lowerFor(
  statement: Extract<AnalyzedStatement, { kind: "for" }>,
  memoryIdByCell: Map<string, string>,
  env: Map<string, string>,
  ctx: LowerContext,
): void {
  // Induction var: analyze declares the name; lower owns memory(init=start).
  if (memoryIdByCell.has(statement.name)) {
    throw new Error(`internal error: for var '${statement.name}' already has a memory cell`);
  }
  const startId = lowerExpr(statement.start, env, ctx);
  const indMemId = nextId(ctx);
  pushNode(ctx, { kind: "memory", id: indMemId, cell: statement.name, init: startId });
  memoryIdByCell.set(statement.name, indMemId);
  env.set(statement.name, indMemId);

  const stopId = lowerExpr(statement.stop, env, ctx);
  const condId = pushNode(ctx, {
    kind: "cmp",
    id: nextId(ctx),
    op: "<=",
    left: indMemId,
    right: stopId,
  });

  const runMemId = createRunMemory(memoryIdByCell, env, ctx);
  const enableId = lowerEnable(runMemId, condId, ctx);
  lowerLoopBody(statement.body, memoryIdByCell, env, ctx, enableId);

  // On enable: i' = i + 1 (after body stores).
  const oneId = pushNode(ctx, { kind: "literal", id: nextId(ctx), value: 1 });
  const nextI = pushNode(ctx, {
    kind: "binop",
    id: nextId(ctx),
    op: "+",
    left: indMemId,
    right: oneId,
  });
  const gatedNextI = wrapWithEnable(enableId, nextI, indMemId, ctx);
  pushNode(ctx, { kind: "store", id: nextId(ctx), cell: statement.name, value: gatedNextI });

  lowerRunUpdate(runMemId, condId, ctx);
}

/**
 * Lowers an analyzed program into the IR DAG. Locals that are later reassigned become
 * `memory` cells (env binds the memory id); assignments and if/else become `store`s
 * (if uses `select` to mux then/else/hold). Clocked while/for add `__run` + enable-gated
 * stores. Unreassigned locals stay combinational SSA.
 */
export function lower(program: AnalyzedProgram): IRModule {
  const ctx: LowerContext = { nodes: [], inputs: [], nextTempId: 1, zeroNodeId: undefined };
  const env = new Map<string, string>();
  const memoryCells = reassignedNames(program.statements);
  const memoryIdByCell = new Map<string, string>();

  for (const statement of program.statements) {
    switch (statement.kind) {
      case "local": {
        if (statement.expr.kind === "entity_ref") {
          // Entity handles are compile-time placement references, not circuit signals.
          break;
        }
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
      case "assign":
        lowerAssignStore(statement, memoryIdByCell, env, ctx, undefined);
        break;
      case "if":
        lowerIfStore(statement, memoryIdByCell, env, ctx, undefined);
        break;
      case "while":
        lowerWhile(statement, memoryIdByCell, env, ctx);
        break;
      case "for":
        lowerFor(statement, memoryIdByCell, env, ctx);
        break;
      default: {
        const unreachable: never = statement;
        throw new Error(
          `internal error: unhandled statement kind '${JSON.stringify(unreachable)}'`,
        );
      }
    }
  }

  const outputs: IRModule["outputs"] = program.outputs.map((output) => ({
    signal: output.signal,
    nodeId: lowerExpr(output.expr, env, ctx),
  }));

  const places: SpatialPlace[] = program.places.map(({ id, name, x, y, logistic }) => ({
    id,
    name,
    x,
    y,
    ...(logistic !== undefined ? { logistic: { ...logistic } } : {}),
  }));
  for (const binding of program.bindings) {
    if (binding.kind !== "output_to") continue;
    const bagId = lowerExpr(binding.bag, env, ctx);
    const place = places.find((candidate) => candidate.id === binding.entityId);
    if (place === undefined) {
      throw new Error(`internal error: missing placed entity '${binding.entityId}'`);
    }
    place.circuit = {
      ...place.circuit,
      writeProducerIds: [...(place.circuit?.writeProducerIds ?? []), bagId],
    };
  }
  return {
    nodes: ctx.nodes,
    outputs,
    inputs: ctx.inputs,
    ...(places.length > 0 ? { places } : {}),
  };
}
