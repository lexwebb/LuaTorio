import type {
  AnalyzedExpr,
  AnalyzedLoopBodyStmt,
  AnalyzedProgram,
  AnalyzedStatement,
} from "../analyze.js";
import { analyze } from "../analyze.js";
import { RUN_CELL } from "../lower.js";
import { parse } from "../parse.js";
import { toInt32 } from "./signals.js";

export interface ReferenceOptions {
  ticks: number;
  inputs?: Record<string, number> | ((tick: number) => Record<string, number>);
}

export interface ReferenceResult {
  ticks: Array<{ outputs: Record<string, number> }>;
}

function resolveInputs(inputs: ReferenceOptions["inputs"], tick: number): Record<string, number> {
  if (inputs === undefined) {
    return {};
  }
  return typeof inputs === "function" ? inputs(tick) : inputs;
}

function truthy(n: number): boolean {
  return n !== 0;
}

function evalCatalogLatch(
  expr: Extract<AnalyzedExpr, { kind: "catalog_latch" }>,
  held: Set<string>,
  env: ReadonlyMap<string, number>,
  inputs: Record<string, number>,
): Map<string, number> {
  const bag = new Map<string, number>();
  const nextHeld = new Set<string>();
  for (const entry of expr.entries) {
    const stock = evalExpr(entry.stock, env, inputs);
    const set = stock === 0;
    const hold = stock < entry.buffer && held.has(entry.recipe);
    if (set || hold) {
      bag.set(entry.recipe, 1);
      nextHeld.add(entry.recipe);
    }
  }
  held.clear();
  for (const recipe of nextHeld) {
    held.add(recipe);
  }
  return bag;
}

function evalExpr(
  expr: AnalyzedExpr,
  env: ReadonlyMap<string, number>,
  inputs: Record<string, number>,
): number {
  switch (expr.kind) {
    case "literal":
      return toInt32(expr.value);
    case "input":
      return toInt32(inputs[expr.signal] ?? 0);
    case "catalog_latch":
      throw new Error("reference: catalog_latch is a signal bag, not a scalar");
    case "ref": {
      const value = env.get(expr.name);
      if (value === undefined) {
        throw new Error(`reference: unbound local '${expr.name}'`);
      }
      return value;
    }
    case "binop": {
      const left = evalExpr(expr.left, env, inputs);
      const right = evalExpr(expr.right, env, inputs);
      switch (expr.op) {
        case "+":
          return toInt32(left + right);
        case "-":
          return toInt32(left - right);
        case "*":
          return toInt32(left * right);
        case "/":
          return right === 0 ? 0 : toInt32(Math.trunc(left / right));
        case "%":
          return right === 0 ? 0 : toInt32(left % right);
        default:
          throw new Error(`reference: bad binop '${String((expr as { op: string }).op)}'`);
      }
    }
    case "cmp": {
      const left = evalExpr(expr.left, env, inputs);
      const right = evalExpr(expr.right, env, inputs);
      switch (expr.op) {
        case "<":
          return left < right ? 1 : 0;
        case ">":
          return left > right ? 1 : 0;
        case "<=":
          return left <= right ? 1 : 0;
        case ">=":
          return left >= right ? 1 : 0;
        case "==":
          return left === right ? 1 : 0;
        case "~=":
          return left !== right ? 1 : 0;
        default:
          throw new Error(`reference: bad cmp '${String((expr as { op: string }).op)}'`);
      }
    }
    case "logical": {
      const left = evalExpr(expr.left, env, inputs);
      if (expr.op === "and") {
        return truthy(left) ? evalExpr(expr.right, env, inputs) : 0;
      }
      return truthy(left) ? left : evalExpr(expr.right, env, inputs);
    }
    case "select": {
      const cond = evalExpr(expr.cond, env, inputs);
      return truthy(cond) ? evalExpr(expr.then, env, inputs) : evalExpr(expr.else, env, inputs);
    }
    case "sr": {
      const state = evalExpr(expr.state, env, inputs);
      const set = evalExpr(expr.set, env, inputs);
      const reset = evalExpr(expr.reset, env, inputs);
      if (truthy(reset)) {
        return 0;
      }
      return truthy(state) || truthy(set) ? 1 : 0;
    }
    case "signal_count":
      return expr.args.filter((arg) => evalExpr(arg, env, inputs) !== 0).length;
    case "signal_at": {
      const scored = expr.args
        .map((arg, index) => ({ index, value: evalExpr(arg, env, inputs) }))
        .filter((entry) => entry.value !== 0);
      if (scored.length === 0) {
        return 0;
      }
      // Factorio: a lone candidate always passes (wiki / evalSelectorSelect).
      if (scored.length === 1) {
        return scored[0]!.value;
      }
      scored.sort((a, b) => {
        if (a.value !== b.value) {
          return expr.ascending ? a.value - b.value : b.value - a.value;
        }
        return a.index - b.index;
      });
      return scored[expr.index]?.value ?? 0;
    }
    default: {
      const unreachable: never = expr;
      throw new Error(`reference: bad expr '${JSON.stringify(unreachable)}'`);
    }
  }
}

function collectReassigned(statements: AnalyzedStatement[]): Set<string> {
  const names = new Set<string>();
  for (const statement of statements) {
    switch (statement.kind) {
      case "assign":
        names.add(statement.name);
        break;
      case "if":
        for (const a of statement.thenAssigns) names.add(a.name);
        for (const a of statement.elseAssigns) names.add(a.name);
        break;
      case "while":
        for (const s of statement.body) {
          if (s.kind === "assign") names.add(s.name);
          else {
            for (const a of s.thenAssigns) names.add(a.name);
            for (const a of s.elseAssigns) names.add(a.name);
          }
        }
        names.add(RUN_CELL);
        break;
      case "for":
        for (const s of statement.body) {
          if (s.kind === "assign") names.add(s.name);
          else {
            for (const a of s.thenAssigns) names.add(a.name);
            for (const a of s.elseAssigns) names.add(a.name);
          }
        }
        names.add(statement.name);
        names.add(RUN_CELL);
        break;
      default:
        break;
    }
  }
  return names;
}

/**
 * Body stores are concurrent (all RHS see pre-tick env), matching `lower.ts`.
 */
function applyLoopBody(
  body: AnalyzedLoopBodyStmt[],
  env: Map<string, number>,
  inputs: Record<string, number>,
  enable: boolean,
): void {
  if (!enable) {
    return;
  }
  const snapshot = new Map(env);
  const pending = new Map<string, number>();

  for (const statement of body) {
    if (statement.kind === "assign") {
      pending.set(statement.name, evalExpr(statement.expr, snapshot, inputs));
    } else {
      const cond = truthy(evalExpr(statement.cond, snapshot, inputs));
      const thenBy = new Map(statement.thenAssigns.map((a) => [a.name, a]));
      const elseBy = new Map(statement.elseAssigns.map((a) => [a.name, a]));
      for (const name of new Set([...thenBy.keys(), ...elseBy.keys()])) {
        const branch = cond ? thenBy.get(name) : elseBy.get(name);
        pending.set(
          name,
          branch ? evalExpr(branch.expr, snapshot, inputs) : (snapshot.get(name) as number),
        );
      }
    }
  }

  for (const [name, value] of pending) {
    env.set(name, value);
  }
}

/**
 * One clocked-loop step matching `lower.ts`:
 * `enable = __run ∧ cond` (cond on pre-body state); body gated by enable;
 * `__run' = select(__run, cond, 0)`; for also `i' = enable ? i+1 : i`.
 */
function stepWhile(
  statement: Extract<AnalyzedStatement, { kind: "while" }>,
  env: Map<string, number>,
  inputs: Record<string, number>,
): void {
  const run = env.get(RUN_CELL) ?? 0;
  const cond = evalExpr(statement.cond, env, inputs);
  const enable = truthy(run) && truthy(cond);
  applyLoopBody(statement.body, env, inputs, enable);
  env.set(RUN_CELL, truthy(run) ? toInt32(cond) : 0);
}

function stepFor(
  statement: Extract<AnalyzedStatement, { kind: "for" }>,
  env: Map<string, number>,
  inputs: Record<string, number>,
): void {
  const run = env.get(RUN_CELL) ?? 0;
  const i = env.get(statement.name) as number;
  const stop = evalExpr(statement.stop, env, inputs);
  const cond = i <= stop ? 1 : 0;
  const enable = truthy(run) && truthy(cond);
  applyLoopBody(statement.body, env, inputs, enable);
  if (enable) {
    env.set(statement.name, toInt32(i + 1));
  }
  env.set(RUN_CELL, truthy(run) ? cond : 0);
}

/**
 * Interpret supported Lua (parse → analyze) with the same tick semantics as compiler desugar:
 * free-running assigns/`if` update every tick; clocked while/for take one enabled body step
 * per tick while `__run ∧ cond`.
 */
export function reference(source: string, opts: ReferenceOptions): ReferenceResult;
export function reference(program: AnalyzedProgram, opts: ReferenceOptions): ReferenceResult;
export function reference(
  sourceOrProgram: string | AnalyzedProgram,
  opts: ReferenceOptions,
): ReferenceResult {
  const program =
    typeof sourceOrProgram === "string" ? analyze(parse(sourceOrProgram)) : sourceOrProgram;

  const reassigned = collectReassigned(program.statements);
  const env = new Map<string, number>();
  const bagEnv = new Map<string, Map<string, number>>();
  const catalogHeld = new Map<string, Set<string>>();
  let clocked: AnalyzedStatement | undefined;
  const initInputs = resolveInputs(opts.inputs, 0);

  for (const statement of program.statements) {
    switch (statement.kind) {
      case "local":
        if (statement.expr.kind === "catalog_latch") {
          // Sticky held set starts empty; first tick evaluates the bag (like Factorio Q=0).
          catalogHeld.set(statement.name, new Set());
          bagEnv.set(statement.name, new Map());
        } else {
          env.set(statement.name, evalExpr(statement.expr, env, initInputs));
        }
        break;
      case "for":
        env.set(statement.name, evalExpr(statement.start, env, initInputs));
        env.set(RUN_CELL, 1);
        clocked = statement;
        break;
      case "while":
        env.set(RUN_CELL, 1);
        clocked = statement;
        break;
      case "assign":
      case "if":
        break;
      default: {
        const unreachable: never = statement;
        throw new Error(`reference: bad statement '${JSON.stringify(unreachable)}'`);
      }
    }
  }

  for (const name of reassigned) {
    if (!env.has(name) && name !== RUN_CELL) {
      env.set(name, 0);
    }
  }

  const ticks: ReferenceResult["ticks"] = [];

  for (let tick = 0; tick < opts.ticks; tick += 1) {
    const inputs = resolveInputs(opts.inputs, tick);

    for (const statement of program.statements) {
      if (statement.kind === "local" && !reassigned.has(statement.name)) {
        if (statement.expr.kind === "catalog_latch") {
          const held = catalogHeld.get(statement.name) ?? new Set<string>();
          catalogHeld.set(statement.name, held);
          bagEnv.set(statement.name, evalCatalogLatch(statement.expr, held, env, inputs));
        } else {
          env.set(statement.name, evalExpr(statement.expr, env, inputs));
        }
      }
    }

    if (clocked?.kind === "while") {
      stepWhile(clocked, env, inputs);
    } else if (clocked?.kind === "for") {
      stepFor(clocked, env, inputs);
    } else {
      const snapshot = new Map(env);
      const updates = new Map<string, number>();
      for (const statement of program.statements) {
        if (statement.kind === "assign") {
          updates.set(statement.name, evalExpr(statement.expr, snapshot, inputs));
        } else if (statement.kind === "if") {
          const cond = truthy(evalExpr(statement.cond, snapshot, inputs));
          const thenBy = new Map(statement.thenAssigns.map((a) => [a.name, a]));
          const elseBy = new Map(statement.elseAssigns.map((a) => [a.name, a]));
          for (const name of new Set([...thenBy.keys(), ...elseBy.keys()])) {
            const branch = cond ? thenBy.get(name) : elseBy.get(name);
            updates.set(
              name,
              branch ? evalExpr(branch.expr, snapshot, inputs) : (snapshot.get(name) as number),
            );
          }
        }
      }
      for (const [name, value] of updates) {
        env.set(name, value);
      }
    }

    const outputs: Record<string, number> = {};
    for (const output of program.outputs) {
      if (output.expr.kind === "catalog_latch") {
        const heldKey = `__inline_out_${output.signal}`;
        const held = catalogHeld.get(heldKey) ?? new Set<string>();
        catalogHeld.set(heldKey, held);
        const bag = evalCatalogLatch(output.expr, held, env, inputs);
        outputs[output.signal] = bag.get(output.signal) ?? 0;
      } else if (output.expr.kind === "ref" && bagEnv.has(output.expr.name)) {
        outputs[output.signal] = bagEnv.get(output.expr.name)?.get(output.signal) ?? 0;
      } else {
        outputs[output.signal] = evalExpr(output.expr, env, inputs);
      }
    }
    ticks.push({ outputs });
  }

  return { ticks };
}
