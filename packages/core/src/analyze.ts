import type {
  BinaryExpression,
  CallExpression,
  CallStatement,
  Chunk,
  Expression,
  FunctionDeclaration,
  Identifier,
  IndexExpression,
  LocalStatement,
  MemberExpression,
  Statement,
} from "luaparse";
import {
  isAssembler,
  isLogisticChest,
  isRoboport,
  PLACEABLE_ENTITIES,
  type PlaceableEntity,
  type PlaceCircuitCondition,
} from "./ir.js";

export { PLACEABLE_ENTITIES, type PlaceableEntity };

export class SemanticError extends Error {
  readonly line: number;
  readonly column: number;
  readonly plannedVersion: string | undefined;

  constructor(message: string, line: number, column: number, plannedVersion?: string) {
    super(plannedVersion ? `${message} (planned for ${plannedVersion})` : message);
    this.name = "SemanticError";
    this.line = line;
    this.column = column;
    this.plannedVersion = plannedVersion;
  }
}

type ArithOp = "+" | "-" | "*" | "/" | "%";
type CmpOp = "<" | ">" | "<=" | ">=" | "==" | "~=";
type LogicalOp = "and" | "or";

export type AnalyzedExpr =
  | { kind: "literal"; value: number; line: number; column: number }
  | { kind: "input"; signal: string; line: number; column: number }
  | { kind: "ref"; name: string; line: number; column: number }
  | { kind: "entity_ref"; entityId: string; line: number; column: number }
  | { kind: "entity_read"; entityId: string; line: number; column: number }
  | {
      kind: "binop";
      op: ArithOp;
      left: AnalyzedExpr;
      right: AnalyzedExpr;
      line: number;
      column: number;
    }
  | {
      kind: "cmp";
      op: CmpOp;
      left: AnalyzedExpr;
      right: AnalyzedExpr;
      line: number;
      column: number;
    }
  | {
      kind: "logical";
      op: LogicalOp;
      left: AnalyzedExpr;
      right: AnalyzedExpr;
      line: number;
      column: number;
    }
  // `select` mirrors the parent design's mux IR node (if/then/else-as-value). Lua has no
  // if-expression, so v1 never constructs this directly — ternaries stay as `logical` nodes
  // and IR lowering (#6) is expected to desugar `and`/`or` chains into `select` itself. Kept
  // here so #6 can share this discriminated union without a breaking change.
  | {
      kind: "select";
      cond: AnalyzedExpr;
      then: AnalyzedExpr;
      else: AnalyzedExpr;
      line: number;
      column: number;
    }
  | {
      kind: "sr";
      state: AnalyzedExpr;
      set: AnalyzedExpr;
      reset: AnalyzedExpr;
      line: number;
      column: number;
    }
  | {
      kind: "signal_count";
      args: AnalyzedExpr[];
      line: number;
      column: number;
    }
  | {
      kind: "each_latch";
      entries: Array<{
        level: AnalyzedExpr;
        signal: string;
        buffer: number;
        tag: number;
      }>;
      line: number;
      column: number;
    }
  | {
      kind: "bag_const";
      entries: Array<{ signal: string; count: number }>;
      line: number;
      column: number;
    }
  | {
      kind: "bag_binop";
      op: ArithOp;
      left: AnalyzedExpr;
      right: AnalyzedExpr;
      line: number;
      column: number;
    }
  | {
      kind: "bag_filter";
      mode: "include" | "exclude" | "limit";
      data: AnalyzedExpr;
      mask: AnalyzedExpr;
      line: number;
      column: number;
    }
  | {
      /** Named scalar channel read from a bag: `bag["signal-name"]`. */
      kind: "bag_sample";
      bag: AnalyzedExpr;
      signal: string;
      line: number;
      column: number;
    }
  | {
      kind: "edge";
      value: AnalyzedExpr;
      line: number;
      column: number;
    }
  | {
      kind: "bag_test";
      mode: "any" | "every";
      op: CmpOp;
      bag: AnalyzedExpr;
      value: number;
      line: number;
      column: number;
    }
  | {
      kind: "signal_at";
      index: number;
      ascending: boolean;
      args: AnalyzedExpr[];
      line: number;
      column: number;
    };

export type AnalyzedAssign = {
  name: string;
  expr: AnalyzedExpr;
  line: number;
  column: number;
};

export interface AnalyzedPlace {
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
  roboport?: {
    read_items_mode?: number;
  };
  line: number;
  column: number;
}

export type AnalyzedLoopBodyStmt = Extract<AnalyzedStatement, { kind: "assign" | "if" }>;

export type AnalyzedStatement =
  | {
      kind: "local";
      name: string;
      expr: AnalyzedExpr;
      line: number;
      column: number;
    }
  | {
      kind: "assign";
      name: string;
      expr: AnalyzedExpr;
      line: number;
      column: number;
    }
  | {
      kind: "if";
      cond: AnalyzedExpr;
      thenAssigns: AnalyzedAssign[];
      elseAssigns: AnalyzedAssign[];
      line: number;
      column: number;
    }
  | {
      kind: "while";
      cond: AnalyzedExpr;
      body: AnalyzedLoopBodyStmt[];
      line: number;
      column: number;
    }
  | {
      kind: "for";
      name: string;
      start: AnalyzedExpr;
      stop: AnalyzedExpr;
      body: AnalyzedLoopBodyStmt[];
      line: number;
      column: number;
    };

export interface AnalyzedProgram {
  /** Ordered locals, assignments, if mux-stores, and at most one clocked loop — enough for IR lowering */
  statements: AnalyzedStatement[];
  outputs: Array<{ signal: string; expr: AnalyzedExpr; line: number; column: number }>;
  inputs: Array<{ signal: string; line: number; column: number }>;
  /** Explicit non-combinator entities, emitted at absolute tile coordinates. */
  places: AnalyzedPlace[];
  /** Top-level machine-output bindings, lowered after local expressions. */
  bindings: Array<{ kind: "output_to"; entityId: string; bag: AnalyzedExpr }>;
}

const ARITH_OPS: ReadonlySet<string> = new Set(["+", "-", "*", "/", "%"]);
const CMP_OPS: ReadonlySet<string> = new Set(["<", ">", "<=", ">=", "==", "~="]);

interface Loc {
  loc?: { start: { line: number; column: number } } | undefined;
}

interface AnalyzeContext {
  declared: Set<string>;
  reassigned: Set<string>;
  /** Locals initialized with a bag expression — wire values, not scalar memory. */
  bagLocals: Set<string>;
  /** Locals initialized with `place()` entity handles. */
  entityLocals: Map<string, string>;
  entityPlaces: Map<string, AnalyzedPlace>;
  statements: AnalyzedStatement[];
  outputs: AnalyzedProgram["outputs"];
  inputs: AnalyzedProgram["inputs"];
  places: AnalyzedPlace[];
  bindings: AnalyzedProgram["bindings"];
  nextEntityId: number;
  /** True after a top-level while/for (clocked mode). */
  seenLoop: boolean;
  /** True after a top-level assign or if (free-running stores). */
  seenFreeRunningStore: boolean;
  functions: ReadonlyMap<string, FunctionInfo>;
  /** Names that are memory cells anywhere in the enclosing program. */
  mutableNames: ReadonlySet<string>;
}

interface FunctionInfo {
  name: string;
  parameters: string[];
  body: Statement[];
  line: number;
  column: number;
}

interface ExpressionOptions {
  functions?: ReadonlyMap<string, FunctionInfo>;
  mutableNames?: ReadonlySet<string>;
  substitutions?: ReadonlyMap<string, AnalyzedExpr>;
  inFunction?: boolean;
  entityLocals?: ReadonlyMap<string, string>;
  entityPlaces?: ReadonlyMap<string, AnalyzedPlace>;
}

function expressionOptions(ctx: AnalyzeContext): ExpressionOptions {
  return {
    functions: ctx.functions,
    mutableNames: ctx.mutableNames,
    entityLocals: ctx.entityLocals,
    entityPlaces: ctx.entityPlaces,
  };
}

function locOf(node: Loc): { line: number; column: number } {
  const start = node.loc?.start;
  return { line: start?.line ?? 0, column: start?.column ?? 0 };
}

function describeCallee(base: Expression): string | undefined {
  return base.type === "Identifier" ? base.name : undefined;
}

function describeAssignmentTarget(target: Identifier | MemberExpression | IndexExpression): string {
  return target.type === "Identifier" ? target.name : "<expression>";
}

function rejectBagWrite(
  target: Identifier | MemberExpression | IndexExpression,
  line: number,
  column: number,
): void {
  if (target.type === "MemberExpression" || target.type === "IndexExpression") {
    throw new SemanticError(
      "bag field writes are not supported in v4.0; create a new bag with bag_arith()/bag_filter()",
      line,
      column,
    );
  }
}

/** Returns the tick() CallExpression when `statement` is a bare `tick()` call. */
function asTickCall(statement: Statement): CallExpression | undefined {
  if (statement.type !== "CallStatement") {
    return undefined;
  }
  const call = statement.expression;
  if (call.type !== "CallExpression" || describeCallee(call.base) !== "tick") {
    return undefined;
  }
  return call;
}

function rejectTickInExpression(
  calleeName: string | undefined,
  line: number,
  column: number,
): void {
  if (calleeName === "tick") {
    throw new SemanticError(
      "tick() is only allowed as the last statement of a while/for body",
      line,
      column,
    );
  }
}

/**
 * Walks a luaparse `Chunk` and enforces the language subset (v1 + v2 phase 1–3),
 * returning a validated, minimally-typed program model. Throws `SemanticError` (with
 * line/column and, where the construct is on the roadmap, a `plannedVersion`) for anything
 * outside the supported subset.
 */
export function analyze(ast: Chunk): AnalyzedProgram {
  const { functions, body } = collectFunctionDeclarations(ast.body);
  const ctx: AnalyzeContext = {
    declared: new Set<string>(),
    reassigned: new Set<string>(),
    bagLocals: new Set<string>(),
    entityLocals: new Map<string, string>(),
    entityPlaces: new Map<string, AnalyzedPlace>(),
    statements: [],
    outputs: [],
    inputs: [],
    places: [],
    bindings: [],
    nextEntityId: 1,
    seenLoop: false,
    seenFreeRunningStore: false,
    functions,
    mutableNames: collectMutableNames(body),
  };

  rejectRecursiveFunctions(functions);
  validateFunctionBodies(functions, ctx.mutableNames);

  for (const statement of body) {
    analyzeStatement(statement, ctx);
  }

  if (ctx.outputs.length === 0) {
    const { line, column } = locOf(ast);
    throw new SemanticError("program must contain at least one output() call", line, column);
  }

  return {
    statements: ctx.statements,
    outputs: ctx.outputs,
    inputs: ctx.inputs,
    places: ctx.places,
    bindings: ctx.bindings,
  };
}

function collectFunctionDeclarations(statements: Statement[]): {
  functions: ReadonlyMap<string, FunctionInfo>;
  body: Statement[];
} {
  const functions = new Map<string, FunctionInfo>();
  let firstNonFunction = 0;
  while (
    firstNonFunction < statements.length &&
    statements[firstNonFunction]?.type === "FunctionDeclaration"
  ) {
    const declaration = statements[firstNonFunction] as FunctionDeclaration;
    const { line, column } = locOf(declaration);
    const identifier = declaration.identifier;
    if (!declaration.isLocal || identifier === null || identifier.type !== "Identifier") {
      throw new SemanticError(
        "function declarations must use 'local function name(...)'",
        line,
        column,
      );
    }
    if (declaration.parameters.some((parameter) => parameter.type === "VarargLiteral")) {
      throw new SemanticError("function declarations may not use varargs", line, column);
    }
    const name = identifier.name;
    if (functions.has(name)) {
      throw new SemanticError(`function '${name}' is already defined`, line, column);
    }
    const parameters = declaration.parameters.map((parameter) => {
      if (parameter.type !== "Identifier") {
        throw new SemanticError("function declarations may not use varargs", line, column);
      }
      return parameter.name;
    });
    if (new Set(parameters).size !== parameters.length) {
      throw new SemanticError(`function '${name}' has duplicate parameters`, line, column);
    }
    functions.set(name, { name, parameters, body: declaration.body, line, column });
    firstNonFunction += 1;
  }

  for (const statement of statements.slice(firstNonFunction)) {
    if (statement.type === "FunctionDeclaration") {
      const { line, column } = locOf(statement);
      throw new SemanticError(
        "function declarations must form a prefix of the program",
        line,
        column,
      );
    }
  }
  return { functions, body: statements.slice(firstNonFunction) };
}

function collectMutableNames(statements: Statement[]): Set<string> {
  const mutable = new Set<string>();
  const visit = (statement: Statement): void => {
    if (statement.type === "AssignmentStatement") {
      for (const target of statement.variables) {
        if (target.type === "Identifier") mutable.add(target.name);
      }
      return;
    }
    if (statement.type === "IfStatement") {
      for (const clause of statement.clauses) {
        for (const nested of clause.body) visit(nested);
      }
      return;
    }
    if (statement.type === "WhileStatement" || statement.type === "ForNumericStatement") {
      if (statement.type === "ForNumericStatement") mutable.add(statement.variable.name);
      for (const nested of statement.body) visit(nested);
    }
  };
  for (const statement of statements) visit(statement);
  return mutable;
}

function directFunctionCalls(
  value: unknown,
  functions: ReadonlyMap<string, FunctionInfo>,
): string[] {
  const result: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    if (
      record.type === "CallExpression" &&
      typeof record.base === "object" &&
      record.base !== null &&
      (record.base as { type?: unknown }).type === "Identifier"
    ) {
      const name = (record.base as { name: string }).name;
      if (functions.has(name)) result.push(name);
    }
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) {
        for (const entry of child) visit(entry);
      } else {
        visit(child);
      }
    }
  };
  visit(value);
  return result;
}

function rejectRecursiveFunctions(functions: ReadonlyMap<string, FunctionInfo>): void {
  const visiting: string[] = [];
  const visited = new Set<string>();
  const visit = (name: string): void => {
    const cycleAt = visiting.indexOf(name);
    if (cycleAt !== -1) {
      const path = [...visiting.slice(cycleAt), name];
      const declaration = functions.get(name)!;
      throw new SemanticError(
        `recursive function call cycle: ${path.join(" -> ")}; use while/for with memory instead of recursion`,
        declaration.line,
        declaration.column,
      );
    }
    if (visited.has(name)) return;
    visiting.push(name);
    const declaration = functions.get(name)!;
    for (const callee of directFunctionCalls(declaration.body, functions)) visit(callee);
    visiting.pop();
    visited.add(name);
  };
  for (const name of functions.keys()) visit(name);
}

function validateFunctionBodies(
  functions: ReadonlyMap<string, FunctionInfo>,
  mutableNames: ReadonlySet<string>,
): void {
  const builtinNames = new Set([
    "input",
    "output",
    "tick",
    "sr",
    "signal_count",
    "signal_at",
    "signal_at_asc",
    "each_latch",
    "bag_const",
    "bag_arith",
    "bag_filter",
    "bag_test",
    "edge",
  ]);
  for (const declaration of functions.values()) {
    const last = declaration.body.at(-1);
    if (last?.type !== "ReturnStatement" || last.arguments.length !== 1) {
      throw new SemanticError(
        `function '${declaration.name}' body must end with exactly one return expression`,
        declaration.line,
        declaration.column,
      );
    }
    const locals = new Set(declaration.parameters);
    for (const statement of declaration.body.slice(0, -1)) {
      const { line, column } = locOf(statement);
      if (statement.type !== "LocalStatement") {
        throw new SemanticError(
          `function '${declaration.name}' body may only contain local declarations followed by return`,
          line,
          column,
        );
      }
      const variable = statement.variables.length === 1 ? statement.variables[0] : undefined;
      if (variable === undefined || statement.init.length !== 1 || locals.has(variable.name)) {
        throw new SemanticError(
          "function local declarations must be unique single bindings",
          line,
          column,
        );
      }
      locals.add(variable.name);
    }

    const visit = (node: unknown): void => {
      if (typeof node !== "object" || node === null) return;
      const record = node as Record<string, unknown>;
      if (
        record.type === "CallExpression" &&
        (record.base as { type?: string } | undefined)?.type === "Identifier"
      ) {
        const { name } = record.base as { name: string };
        const { line, column } = locOf(record as Loc);
        if (name === "input" || name === "output" || name === "tick" || name === "sr") {
          throw new SemanticError(`${name}() is not allowed in a function body`, line, column);
        }
      }
      if (record.type === "Identifier") {
        const { name } = record as { name: string };
        if (
          !locals.has(name) &&
          !functions.has(name) &&
          !builtinNames.has(name) &&
          mutableNames.has(name)
        ) {
          const { line, column } = locOf(record as Loc);
          throw new SemanticError(`function may not capture mutable local '${name}'`, line, column);
        }
      }
      for (const child of Object.values(record)) {
        if (Array.isArray(child)) {
          for (const entry of child) visit(entry);
        } else {
          visit(child);
        }
      }
    };
    visit(declaration.body);
  }
}

function analyzeStatement(statement: Statement, ctx: AnalyzeContext): void {
  const { line, column } = locOf(statement);

  if (ctx.seenLoop) {
    if (statement.type === "WhileStatement" || statement.type === "ForNumericStatement") {
      throw new SemanticError("at most one top-level while or for loop is allowed", line, column);
    }
    if (statement.type === "CallStatement") {
      analyzeCallStatement(statement, ctx);
      return;
    }
    throw new SemanticError(
      "clocked programs may only have output() calls after the loop (local* → loop → output*)",
      line,
      column,
    );
  }

  switch (statement.type) {
    case "LocalStatement":
      analyzeLocalStatement(statement, ctx);
      return;
    case "CallStatement":
      analyzeCallStatement(statement, ctx);
      return;
    case "AssignmentStatement":
      analyzeAssignmentStatement(statement, ctx);
      return;
    case "IfStatement":
      analyzeIfStatement(statement, ctx);
      return;
    case "WhileStatement":
      analyzeWhileStatement(statement, ctx);
      return;
    case "ForNumericStatement":
      analyzeForNumericStatement(statement, ctx);
      return;
    case "RepeatStatement":
      throw new SemanticError("unsupported construct: repeat loop", line, column);
    case "ForGenericStatement":
      throw new SemanticError(
        "unsupported construct: generic for loop; only numeric for is supported",
        line,
        column,
      );
    case "FunctionDeclaration":
      throw new SemanticError("unsupported construct: function declaration", line, column, "v3");
    default:
      throw new SemanticError(`unsupported construct: ${statement.type}`, line, column);
  }
}

function requireClockedShape(ctx: AnalyzeContext, line: number, column: number): void {
  if (ctx.seenFreeRunningStore) {
    throw new SemanticError(
      "cannot mix free-running assignments/if with a clocked while/for loop",
      line,
      column,
    );
  }
  if (ctx.outputs.length > 0) {
    throw new SemanticError(
      "clocked programs must be local* → loop → output*; output() before the loop is not allowed",
      line,
      column,
    );
  }
}

function analyzeWhileStatement(
  statement: Extract<Statement, { type: "WhileStatement" }>,
  ctx: AnalyzeContext,
): void {
  const { line, column } = locOf(statement);
  requireClockedShape(ctx, line, column);

  const cond = analyzeExpr(
    statement.condition,
    ctx.declared,
    ctx.inputs,
    ctx.bagLocals,
    expressionOptions(ctx),
  );
  forbidBagInScalar(cond, ctx.bagLocals, line, column);
  const body = analyzeLoopBody(statement.body, ctx, { line, column });

  ctx.seenLoop = true;
  ctx.statements.push({ kind: "while", cond, body, line, column });
}

function analyzeForNumericStatement(
  statement: Extract<Statement, { type: "ForNumericStatement" }>,
  ctx: AnalyzeContext,
): void {
  const { line, column } = locOf(statement);
  requireClockedShape(ctx, line, column);

  const { step } = statement;
  if (step !== null && (step.type !== "NumericLiteral" || step.value !== 1)) {
    const stepLoc = locOf(step);
    throw new SemanticError(
      "numeric for step must be literal 1 when present",
      stepLoc.line,
      stepLoc.column,
    );
  }

  const { name } = statement.variable;
  if (ctx.declared.has(name)) {
    throw new SemanticError(
      `variable '${name}' is already defined; for induction variable must be new`,
      line,
      column,
    );
  }

  const start = analyzeExpr(
    statement.start,
    ctx.declared,
    ctx.inputs,
    ctx.bagLocals,
    expressionOptions(ctx),
  );
  const stop = analyzeExpr(
    statement.end,
    ctx.declared,
    ctx.inputs,
    ctx.bagLocals,
    expressionOptions(ctx),
  );
  forbidBagInScalar(start, ctx.bagLocals, line, column);
  forbidBagInScalar(stop, ctx.bagLocals, line, column);

  // Declare induction var for body refs; lower creates memory from `start` (no local stmt).
  ctx.declared.add(name);

  const body = analyzeLoopBody(statement.body, ctx, { line, column }, name);

  ctx.seenLoop = true;
  ctx.statements.push({ kind: "for", name, start, stop, body, line, column });
}

function analyzeLoopBody(
  body: Statement[],
  ctx: AnalyzeContext,
  loopLoc: { line: number; column: number },
  inductionVar?: string,
): AnalyzedLoopBodyStmt[] {
  const last = body.length > 0 ? body[body.length - 1] : undefined;
  if (last === undefined) {
    throw new SemanticError("while/for body must end with tick()", loopLoc.line, loopLoc.column);
  }

  const tickCall = asTickCall(last);
  if (tickCall === undefined) {
    const { line, column } = locOf(last);
    throw new SemanticError("while/for body must end with tick()", line, column);
  }
  if (tickCall.arguments.length !== 0) {
    const { line, column } = locOf(last);
    throw new SemanticError("tick() takes no arguments", line, column);
  }

  const result: AnalyzedLoopBodyStmt[] = [];
  for (const statement of body.slice(0, -1)) {
    const { line, column } = locOf(statement);

    if (asTickCall(statement) !== undefined) {
      throw new SemanticError(
        "tick() is only allowed as the last statement of a while/for body",
        line,
        column,
      );
    }

    if (statement.type === "AssignmentStatement") {
      const assign = analyzeBranchAssign(
        statement,
        ctx.declared,
        ctx.inputs,
        ctx.bagLocals,
        inductionVar,
        expressionOptions(ctx),
      );
      markReassigned(assign.name, ctx.reassigned, assign.line, assign.column);
      result.push({ kind: "assign", ...assign });
      continue;
    }

    if (statement.type === "IfStatement") {
      const { cond, thenAssigns, elseAssigns } = analyzeIfClauses(statement, ctx, inductionVar);
      markBranchNamesReassigned(thenAssigns, elseAssigns, ctx.reassigned, line, column);
      result.push({ kind: "if", cond, thenAssigns, elseAssigns, line, column });
      continue;
    }

    throw new SemanticError(
      "while/for body may only contain assignments and if/else (ending with tick())",
      line,
      column,
    );
  }

  return result;
}

function markReassigned(name: string, reassigned: Set<string>, line: number, column: number): void {
  if (reassigned.has(name)) {
    throw new SemanticError(
      `variable '${name}' already has a next-state assignment; only one reassignment per variable is supported in v2 phase 1–3`,
      line,
      column,
    );
  }
  reassigned.add(name);
}

/** Bag locals / expressions are wire values — not scalar arithmetic operands. */
function forbidBagInScalar(
  expr: AnalyzedExpr,
  bagLocals: ReadonlySet<string>,
  line: number,
  column: number,
): void {
  switch (expr.kind) {
    case "entity_ref":
      throw new SemanticError(
        "entity handles may only be passed to input_from(), output_to(), or configure()",
        line,
        column,
      );
    case "entity_read":
      throw new SemanticError(
        "entity inventory bags may only be sampled or passed to bag operations/output_to()",
        line,
        column,
      );
    case "each_latch":
      throw new SemanticError(
        "each_latch(...) produces a bag and may only appear as a local initializer, output() value, or bag_arith() operand",
        line,
        column,
      );
    case "bag_const":
    case "bag_binop":
    case "bag_filter":
      throw new SemanticError(
        "bag expression may only appear as a local initializer, output() value, or bag_arith() operand",
        line,
        column,
      );
    case "bag_sample":
      return;
    case "ref":
      if (bagLocals.has(expr.name)) {
        throw new SemanticError(
          `bag local '${expr.name}' may only be passed to output() or bag_arith()`,
          line,
          column,
        );
      }
      return;
    case "literal":
    case "input":
      return;
    case "binop":
    case "cmp":
    case "logical":
      forbidBagInScalar(expr.left, bagLocals, line, column);
      forbidBagInScalar(expr.right, bagLocals, line, column);
      return;
    case "select":
      forbidBagInScalar(expr.cond, bagLocals, line, column);
      forbidBagInScalar(expr.then, bagLocals, line, column);
      forbidBagInScalar(expr.else, bagLocals, line, column);
      return;
    case "sr":
      forbidBagInScalar(expr.state, bagLocals, line, column);
      forbidBagInScalar(expr.set, bagLocals, line, column);
      forbidBagInScalar(expr.reset, bagLocals, line, column);
      return;
    case "edge":
      forbidBagInScalar(expr.value, bagLocals, line, column);
      return;
    case "bag_test":
      return;
    case "signal_count":
    case "signal_at":
      for (const arg of expr.args) {
        forbidBagInScalar(arg, bagLocals, line, column);
      }
      return;
    default: {
      const unreachable: never = expr;
      throw new Error(`internal error: unhandled expr '${JSON.stringify(unreachable)}'`);
    }
  }
}

function isBagExpr(expr: AnalyzedExpr, bagLocals: ReadonlySet<string>): boolean {
  switch (expr.kind) {
    case "entity_read":
    case "each_latch":
    case "bag_const":
    case "bag_binop":
    case "bag_filter":
      return true;
    case "ref":
      return bagLocals.has(expr.name);
    default:
      return false;
  }
}

/** One next-state slot per name across then/else (shared hold). */
function markBranchNamesReassigned(
  thenAssigns: AnalyzedAssign[],
  elseAssigns: AnalyzedAssign[],
  reassigned: Set<string>,
  line: number,
  column: number,
): void {
  const names = new Set<string>();
  for (const assign of thenAssigns) names.add(assign.name);
  for (const assign of elseAssigns) names.add(assign.name);
  for (const name of names) {
    markReassigned(name, reassigned, line, column);
  }
}

function analyzeBranchAssign(
  statement: Statement,
  declared: Set<string>,
  inputs: AnalyzedProgram["inputs"],
  bagLocals: ReadonlySet<string>,
  inductionVar?: string,
  options: ExpressionOptions = {},
): AnalyzedAssign {
  const { line, column } = locOf(statement);
  if (statement.type !== "AssignmentStatement") {
    throw new SemanticError(
      "if/else bodies may only contain assignments to declared locals in v2 phase 2",
      line,
      column,
    );
  }

  const target = statement.variables.length === 1 ? statement.variables[0] : undefined;
  const initExpr = statement.init.length === 1 ? statement.init[0] : undefined;
  if (!target || !initExpr) {
    throw new SemanticError(
      "assignments may assign exactly one variable from one expression",
      line,
      column,
    );
  }
  if (target.type !== "Identifier") {
    rejectBagWrite(target, line, column);
    throw new SemanticError(
      `unsupported assignment target '${describeAssignmentTarget(target)}'`,
      line,
      column,
    );
  }
  if (inductionVar !== undefined && target.name === inductionVar) {
    throw new SemanticError(
      `for induction variable '${target.name}' is not assignable in the loop body`,
      line,
      column,
    );
  }
  if (!declared.has(target.name)) {
    throw new SemanticError(`undefined variable '${target.name}'`, line, column);
  }
  if (bagLocals.has(target.name)) {
    throw new SemanticError(
      `bag local '${target.name}' cannot be reassigned; bag state is combinator-owned`,
      line,
      column,
    );
  }

  const expr = analyzeExpr(initExpr, declared, inputs, bagLocals, options);
  forbidBagInScalar(expr, bagLocals, line, column);
  return {
    name: target.name,
    expr,
    line,
    column,
  };
}

function holdExpr(name: string, line: number, column: number): AnalyzedExpr {
  return { kind: "ref", name, line, column };
}

/**
 * Converts a nested conditional to assignment values. An omitted inner branch reads the
 * memory snapshot, preserving the hold semantics that `lowerIfStore` uses for an omitted
 * top-level branch.
 */
function desugarConditionalAssigns(
  cond: AnalyzedExpr,
  thenAssigns: AnalyzedAssign[],
  elseAssigns: AnalyzedAssign[],
  line: number,
  column: number,
): AnalyzedAssign[] {
  const thenByName = new Map(thenAssigns.map((assign) => [assign.name, assign]));
  const elseByName = new Map(elseAssigns.map((assign) => [assign.name, assign]));
  const result: AnalyzedAssign[] = [];

  for (const name of new Set([...thenByName.keys(), ...elseByName.keys()])) {
    const thenAssign = thenByName.get(name);
    const elseAssign = elseByName.get(name);
    result.push({
      name,
      expr: {
        kind: "select",
        cond,
        then: thenAssign?.expr ?? holdExpr(name, line, column),
        else: elseAssign?.expr ?? holdExpr(name, line, column),
        line,
        column,
      },
      line: thenAssign?.line ?? elseAssign?.line ?? line,
      column: thenAssign?.column ?? elseAssign?.column ?? column,
    });
  }

  return result;
}

function ensureUniqueBranchAssigns(assigns: AnalyzedAssign[], branch: string): void {
  const names = new Set<string>();
  for (const assign of assigns) {
    if (names.has(assign.name)) {
      throw new SemanticError(
        `variable '${assign.name}' is assigned more than once in the ${branch} branch`,
        assign.line,
        assign.column,
      );
    }
    names.add(assign.name);
  }
}

function analyzeBranchBody(
  body: Statement[],
  ctx: AnalyzeContext,
  inductionVar?: string,
): AnalyzedAssign[] {
  const assigns: AnalyzedAssign[] = [];

  for (const statement of body) {
    if (statement.type === "AssignmentStatement") {
      assigns.push(
        analyzeBranchAssign(
          statement,
          ctx.declared,
          ctx.inputs,
          ctx.bagLocals,
          inductionVar,
          expressionOptions(ctx),
        ),
      );
      continue;
    }
    if (statement.type === "IfStatement") {
      const { line, column } = locOf(statement);
      const { cond, thenAssigns, elseAssigns } = analyzeIfClauses(statement, ctx, inductionVar);
      assigns.push(...desugarConditionalAssigns(cond, thenAssigns, elseAssigns, line, column));
      continue;
    }

    const { line, column } = locOf(statement);
    throw new SemanticError(
      "if/elseif/else bodies may only contain assignments to declared locals or nested if statements in v2",
      line,
      column,
    );
  }

  ensureUniqueBranchAssigns(assigns, "if");
  return assigns;
}

function analyzeIfClauses(
  statement: Extract<Statement, { type: "IfStatement" }>,
  ctx: AnalyzeContext,
  inductionVar?: string,
): {
  cond: AnalyzedExpr;
  thenAssigns: AnalyzedAssign[];
  elseAssigns: AnalyzedAssign[];
} {
  const { line, column } = locOf(statement);

  if (statement.clauses.length === 0) {
    throw new SemanticError("if statement has no clauses", line, column);
  }

  const first = statement.clauses[0];
  if (first?.type !== "IfClause") {
    throw new SemanticError("if statement must start with an if clause", line, column);
  }

  const cond = analyzeExpr(
    first.condition,
    ctx.declared,
    ctx.inputs,
    ctx.bagLocals,
    expressionOptions(ctx),
  );
  forbidBagInScalar(cond, ctx.bagLocals, locOf(first).line, locOf(first).column);
  const thenAssigns = analyzeBranchBody(first.body, ctx, inductionVar);

  const analyzeElseClauses = (index: number): AnalyzedAssign[] => {
    const clause = statement.clauses[index];
    if (clause === undefined) return [];

    if (clause.type === "ElseClause") {
      if (index !== statement.clauses.length - 1) {
        throw new SemanticError("else clause must be last in an if statement", line, column);
      }
      return analyzeBranchBody(clause.body, ctx, inductionVar);
    }

    if (clause.type !== "ElseifClause") {
      throw new SemanticError("unexpected clause after if", line, column);
    }

    const clauseLoc = locOf(clause);
    const elseifCond = analyzeExpr(
      clause.condition,
      ctx.declared,
      ctx.inputs,
      ctx.bagLocals,
      expressionOptions(ctx),
    );
    forbidBagInScalar(elseifCond, ctx.bagLocals, clauseLoc.line, clauseLoc.column);
    return desugarConditionalAssigns(
      elseifCond,
      analyzeBranchBody(clause.body, ctx, inductionVar),
      analyzeElseClauses(index + 1),
      clauseLoc.line,
      clauseLoc.column,
    );
  };

  const elseAssigns = analyzeElseClauses(1);

  if (thenAssigns.length === 0 && elseAssigns.length === 0) {
    throw new SemanticError("if/else must assign at least one variable", line, column);
  }

  // One assign per name within a branch; names across branches share one next-state slot.
  ensureUniqueBranchAssigns(thenAssigns, "then");
  ensureUniqueBranchAssigns(elseAssigns, "else");

  return { cond, thenAssigns, elseAssigns };
}

function analyzeIfStatement(
  statement: Extract<Statement, { type: "IfStatement" }>,
  ctx: AnalyzeContext,
): void {
  const { line, column } = locOf(statement);
  const { cond, thenAssigns, elseAssigns } = analyzeIfClauses(statement, ctx);

  markBranchNamesReassigned(thenAssigns, elseAssigns, ctx.reassigned, line, column);

  ctx.seenFreeRunningStore = true;
  ctx.statements.push({
    kind: "if",
    cond,
    thenAssigns,
    elseAssigns,
    line,
    column,
  });
}

function analyzeAssignmentStatement(
  statement: Extract<Statement, { type: "AssignmentStatement" }>,
  ctx: AnalyzeContext,
): void {
  const { line, column } = locOf(statement);

  const target = statement.variables.length === 1 ? statement.variables[0] : undefined;
  const initExpr = statement.init.length === 1 ? statement.init[0] : undefined;
  if (!target || !initExpr) {
    throw new SemanticError(
      "assignments may assign exactly one variable from one expression",
      line,
      column,
    );
  }

  if (target.type !== "Identifier") {
    rejectBagWrite(target, line, column);
    throw new SemanticError(
      `unsupported assignment target '${describeAssignmentTarget(target)}'`,
      line,
      column,
    );
  }

  const { name } = target;
  if (!ctx.declared.has(name)) {
    throw new SemanticError(`undefined variable '${name}'`, line, column);
  }
  if (ctx.bagLocals.has(name)) {
    throw new SemanticError(
      `bag local '${name}' cannot be reassigned; bag state is combinator-owned`,
      line,
      column,
    );
  }
  if (ctx.entityLocals.has(name)) {
    throw new SemanticError(`entity handle '${name}' cannot be reassigned`, line, column);
  }
  markReassigned(name, ctx.reassigned, line, column);

  const expr = analyzeExpr(
    initExpr,
    ctx.declared,
    ctx.inputs,
    ctx.bagLocals,
    expressionOptions(ctx),
  );
  if (expr.kind === "sr") {
    if (expr.state.kind !== "ref" || expr.state.name !== name) {
      throw new SemanticError(
        "sr(state, set, reset) state must be the same local being assigned",
        line,
        column,
      );
    }
  }
  forbidBagInScalar(expr, ctx.bagLocals, line, column);
  ctx.seenFreeRunningStore = true;
  ctx.statements.push({ kind: "assign", name, expr, line, column });
}

function analyzeLocalStatement(statement: LocalStatement, ctx: AnalyzeContext): void {
  const { line, column } = locOf(statement);

  const variable = statement.variables.length === 1 ? statement.variables[0] : undefined;
  if (!variable) {
    throw new SemanticError(
      "local declarations may declare exactly one variable in v1",
      line,
      column,
    );
  }
  const { name } = variable;

  const initExpr = statement.init.length === 1 ? statement.init[0] : undefined;
  if (!initExpr) {
    throw new SemanticError(`local '${name}' must be initialized with an expression`, line, column);
  }

  if (ctx.declared.has(name)) {
    throw new SemanticError(
      `variable '${name}' is already defined; redeclaration is not supported in v1`,
      line,
      column,
      "v2",
    );
  }

  let expr: AnalyzedExpr;
  if (initExpr.type === "CallExpression" && describeCallee(initExpr.base) === "place") {
    const place = analyzePlaceCall(initExpr, ctx, line, column);
    ctx.entityLocals.set(name, place.id);
    expr = { kind: "entity_ref", entityId: place.id, line, column };
  } else {
    expr = analyzeExpr(initExpr, ctx.declared, ctx.inputs, ctx.bagLocals, expressionOptions(ctx));
  }
  if (isBagExpr(expr, ctx.bagLocals)) {
    ctx.bagLocals.add(name);
  } else if (expr.kind !== "entity_ref") {
    forbidBagInScalar(expr, ctx.bagLocals, line, column);
  }
  ctx.declared.add(name);
  ctx.statements.push({ kind: "local", name, expr, line, column });
}

function analyzeCallStatement(statement: CallStatement, ctx: AnalyzeContext): void {
  const { line, column } = locOf(statement);
  const call = statement.expression;

  if (call.type !== "CallExpression") {
    throw new SemanticError(
      "only output(), place(), output_to(), and configure() calls are supported as statements",
      line,
      column,
    );
  }

  const calleeName = describeCallee(call.base);
  rejectTickInExpression(calleeName, line, column);
  if (calleeName === "place") {
    analyzePlaceCall(call, ctx, line, column);
    return;
  }
  if (calleeName === "output_to") {
    analyzeOutputToCall(call, ctx, line, column);
    return;
  }
  if (calleeName === "configure") {
    analyzeConfigureCall(call, ctx, line, column);
    return;
  }
  if (calleeName !== "output") {
    const found = calleeName ? ` (found '${calleeName}()')` : "";
    throw new SemanticError(
      `only output() calls are supported as statements${found}`,
      line,
      column,
    );
  }

  if (call.arguments.length !== 2) {
    throw new SemanticError("output() requires a signal name and a value expression", line, column);
  }

  const signalArg = call.arguments[0];
  const valueArg = call.arguments[1];
  if (signalArg?.type !== "StringLiteral") {
    throw new SemanticError("output() requires a string literal signal name", line, column);
  }
  if (!valueArg) {
    throw new SemanticError("output() requires a value expression", line, column);
  }

  const expr = analyzeExpr(
    valueArg,
    ctx.declared,
    ctx.inputs,
    ctx.bagLocals,
    expressionOptions(ctx),
  );
  if (!isBagExpr(expr, ctx.bagLocals)) {
    forbidBagInScalar(expr, ctx.bagLocals, line, column);
  }
  ctx.outputs.push({ signal: signalArg.value, expr, line, column });
}

function integerLiteral(arg: Expression): number | undefined {
  if (arg.type === "NumericLiteral" && Number.isInteger(arg.value)) {
    return arg.value;
  }
  if (
    arg.type === "UnaryExpression" &&
    arg.operator === "-" &&
    arg.argument.type === "NumericLiteral" &&
    Number.isInteger(arg.argument.value)
  ) {
    return -arg.argument.value;
  }
  return undefined;
}

function analyzePlaceCall(
  call: CallExpression,
  ctx: AnalyzeContext,
  line: number,
  column: number,
): AnalyzedPlace {
  if (call.arguments.length !== 3) {
    throw new SemanticError("place(name, x, y) requires exactly 3 arguments", line, column);
  }
  const [nameArg, xArg, yArg] = call.arguments;
  if (nameArg?.type !== "StringLiteral") {
    throw new SemanticError("place() requires a string literal entity name", line, column);
  }
  if (!PLACEABLE_ENTITIES.includes(nameArg.value as PlaceableEntity)) {
    throw new SemanticError(
      `unknown place() entity '${nameArg.value}'; allowed entities: ${PLACEABLE_ENTITIES.join(", ")}`,
      line,
      column,
    );
  }
  const x = xArg === undefined ? undefined : integerLiteral(xArg);
  const y = yArg === undefined ? undefined : integerLiteral(yArg);
  if (x === undefined || y === undefined) {
    throw new SemanticError("place() x and y must be integer literals", line, column);
  }
  const place: AnalyzedPlace = {
    id: `__e${ctx.nextEntityId++}`,
    name: nameArg.value as PlaceableEntity,
    x,
    y,
    line,
    column,
  };
  ctx.places.push(place);
  ctx.entityPlaces.set(place.id, place);
  return place;
}

function entityIdFromArg(
  arg: Expression | undefined,
  ctx: AnalyzeContext,
  line: number,
  column: number,
  callee: string,
): string {
  if (arg?.type !== "Identifier") {
    throw new SemanticError(`${callee}() requires an entity handle local`, line, column);
  }
  const entityId = ctx.entityLocals.get(arg.name);
  if (entityId === undefined) {
    throw new SemanticError(`${callee}() requires an entity handle local`, line, column);
  }
  return entityId;
}

function placeById(ctx: AnalyzeContext, entityId: string): AnalyzedPlace {
  const place = ctx.places.find((candidate) => candidate.id === entityId);
  if (place === undefined) {
    throw new Error(`internal error: missing placed entity '${entityId}'`);
  }
  return place;
}

function analyzeOutputToCall(
  call: CallExpression,
  ctx: AnalyzeContext,
  line: number,
  column: number,
): void {
  if (call.arguments.length !== 2) {
    throw new SemanticError("output_to(entity, bag) requires exactly 2 arguments", line, column);
  }
  const entityId = entityIdFromArg(call.arguments[0], ctx, line, column, "output_to");
  const place = placeById(ctx, entityId);
  if (
    place.name !== "logistic-chest-requester" &&
    place.name !== "logistic-chest-buffer" &&
    !isAssembler(place.name)
  ) {
    throw new SemanticError(
      "output_to() requires a logistic-chest-requester, logistic-chest-buffer, assembling machine, or foundry",
      line,
      column,
    );
  }
  const bagArg = call.arguments[1];
  if (bagArg === undefined) {
    throw new SemanticError("output_to(entity, bag) requires a bag expression", line, column);
  }
  const bag = analyzeExpr(bagArg, ctx.declared, ctx.inputs, ctx.bagLocals, expressionOptions(ctx));
  if (!isBagExpr(bag, ctx.bagLocals)) {
    throw new SemanticError("output_to() second argument must be a bag expression", line, column);
  }
  if (isAssembler(place.name)) {
    place.assembler = { ...place.assembler, set_recipe: true };
  } else {
    place.logistic = { ...place.logistic, set_requests: true };
  }
  ctx.bindings.push({ kind: "output_to", entityId, bag });
}

const CMP_COMPARATORS: ReadonlySet<string> = new Set(["<", ">", "<=", ">=", "==", "~="]);

function analyzeCircuitConditionTable(
  expr: Expression,
  line: number,
  column: number,
): PlaceCircuitCondition {
  if (expr.type !== "TableConstructorExpression") {
    throw new SemanticError(
      "circuit_condition must be a literal table { signal, comparator, constant|other }",
      line,
      column,
    );
  }
  let first_signal: string | undefined;
  let comparator: PlaceCircuitCondition["comparator"] | undefined;
  let constant: number | undefined;
  let second_signal: string | undefined;
  for (const field of expr.fields) {
    const { line: fieldLine, column: fieldColumn } = locOf(field);
    if (field.type !== "TableKeyString") {
      throw new SemanticError(
        "circuit_condition keys must be literal names",
        fieldLine,
        fieldColumn,
      );
    }
    const key = field.key.name;
    if (key === "signal") {
      if (field.value.type !== "StringLiteral") {
        throw new SemanticError(
          "circuit_condition.signal must be a string literal",
          fieldLine,
          fieldColumn,
        );
      }
      first_signal = field.value.value;
      continue;
    }
    if (key === "comparator") {
      if (field.value.type !== "StringLiteral" || !CMP_COMPARATORS.has(field.value.value)) {
        throw new SemanticError(
          'circuit_condition.comparator must be "<", ">", "<=", ">=", "==", or "~="',
          fieldLine,
          fieldColumn,
        );
      }
      comparator = field.value.value as PlaceCircuitCondition["comparator"];
      continue;
    }
    if (key === "constant") {
      const value = integerLiteral(field.value);
      if (value === undefined) {
        throw new SemanticError(
          "circuit_condition.constant must be an integer literal",
          fieldLine,
          fieldColumn,
        );
      }
      constant = value;
      continue;
    }
    if (key === "other") {
      if (field.value.type !== "StringLiteral") {
        throw new SemanticError(
          "circuit_condition.other must be a string literal signal name",
          fieldLine,
          fieldColumn,
        );
      }
      second_signal = field.value.value;
      continue;
    }
    throw new SemanticError(`unsupported circuit_condition key '${key}'`, fieldLine, fieldColumn);
  }
  if (first_signal === undefined || comparator === undefined) {
    throw new SemanticError("circuit_condition requires signal and comparator", line, column);
  }
  if (constant !== undefined && second_signal !== undefined) {
    throw new SemanticError("circuit_condition cannot set both constant and other", line, column);
  }
  if (constant === undefined && second_signal === undefined) {
    throw new SemanticError("circuit_condition requires constant or other", line, column);
  }
  return {
    first_signal,
    comparator,
    ...(constant !== undefined ? { constant } : {}),
    ...(second_signal !== undefined ? { second_signal } : {}),
  };
}

function analyzeConfigureCall(
  call: CallExpression,
  ctx: AnalyzeContext,
  line: number,
  column: number,
): void {
  if (call.arguments.length !== 2 || call.arguments[1]?.type !== "TableConstructorExpression") {
    throw new SemanticError(
      "configure(entity, { ... }) requires an entity handle and literal table",
      line,
      column,
    );
  }
  const entityId = entityIdFromArg(call.arguments[0], ctx, line, column, "configure");
  const place = placeById(ctx, entityId);
  const logistic: NonNullable<AnalyzedPlace["logistic"]> = { ...place.logistic };
  const assembler: NonNullable<AnalyzedPlace["assembler"]> = { ...place.assembler };
  let touchedLogistic = false;
  let touchedAssembler = false;

  for (const field of call.arguments[1].fields) {
    const { line: fieldLine, column: fieldColumn } = locOf(field);
    if (field.type !== "TableKeyString") {
      throw new SemanticError("configure() keys must be literal names", fieldLine, fieldColumn);
    }
    const key = field.key.name;

    if (key === "requests") {
      if (!isLogisticChest(place.name)) {
        throw new SemanticError(
          "configure().requests is only valid on logistic chests",
          fieldLine,
          fieldColumn,
        );
      }
      const requests =
        field.value.type === "TableConstructorExpression"
          ? analyzeTableConstructor(field.value, fieldLine, fieldColumn)
          : undefined;
      if (requests?.kind !== "bag_const") {
        throw new SemanticError(
          "configure().requests must be a literal bag table",
          fieldLine,
          fieldColumn,
        );
      }
      logistic.request_filters = requests.entries;
      touchedLogistic = true;
      continue;
    }

    if (key === "recipe") {
      if (!isAssembler(place.name)) {
        throw new SemanticError(
          "configure().recipe is only valid on assembling machines / foundry",
          fieldLine,
          fieldColumn,
        );
      }
      if (field.value.type !== "StringLiteral") {
        throw new SemanticError(
          "configure().recipe must be a string literal",
          fieldLine,
          fieldColumn,
        );
      }
      assembler.recipe = field.value.value;
      touchedAssembler = true;
      continue;
    }

    if (key === "circuit_condition") {
      if (!isLogisticChest(place.name) && !isAssembler(place.name)) {
        throw new SemanticError(
          "configure().circuit_condition is only valid on logistic chests or assembling machines",
          fieldLine,
          fieldColumn,
        );
      }
      const condition = analyzeCircuitConditionTable(field.value, fieldLine, fieldColumn);
      if (isAssembler(place.name)) {
        assembler.circuit_condition = condition;
        touchedAssembler = true;
      } else {
        logistic.circuit_condition = condition;
        logistic.circuit_condition_enabled = true;
        touchedLogistic = true;
      }
      continue;
    }

    if (key === "circuit_condition_enabled") {
      if (!isLogisticChest(place.name)) {
        throw new SemanticError(
          "configure().circuit_condition_enabled is only valid on logistic chests",
          fieldLine,
          fieldColumn,
        );
      }
      if (field.value.type !== "BooleanLiteral") {
        throw new SemanticError(
          "configure().circuit_condition_enabled must be a boolean literal",
          fieldLine,
          fieldColumn,
        );
      }
      logistic.circuit_condition_enabled = field.value.value;
      touchedLogistic = true;
      continue;
    }

    if (key === "set_recipe" || key === "circuit_enabled") {
      if (!isAssembler(place.name)) {
        throw new SemanticError(
          `configure().${key} is only valid on assembling machines / foundry`,
          fieldLine,
          fieldColumn,
        );
      }
      if (field.value.type !== "BooleanLiteral") {
        throw new SemanticError(
          `configure().${key} must be a boolean literal`,
          fieldLine,
          fieldColumn,
        );
      }
      assembler[key] = field.value.value;
      touchedAssembler = true;
      continue;
    }

    if (key === "read_contents" || key === "set_requests" || key === "request_from_buffers") {
      if (key === "read_contents" && isAssembler(place.name)) {
        if (field.value.type !== "BooleanLiteral") {
          throw new SemanticError(
            "configure().read_contents must be a boolean literal",
            fieldLine,
            fieldColumn,
          );
        }
        assembler.read_contents = field.value.value;
        touchedAssembler = true;
        continue;
      }
      if (!isLogisticChest(place.name)) {
        throw new SemanticError(
          `configure().${key} is only valid on logistic chests`,
          fieldLine,
          fieldColumn,
        );
      }
      if (field.value.type !== "BooleanLiteral") {
        throw new SemanticError(
          `configure().${key} must be a boolean literal`,
          fieldLine,
          fieldColumn,
        );
      }
      logistic[key] = field.value.value;
      touchedLogistic = true;
      continue;
    }

    throw new SemanticError(`unsupported configure() key '${key}'`, fieldLine, fieldColumn);
  }

  if (touchedLogistic) {
    place.logistic = logistic;
  }
  if (touchedAssembler) {
    place.assembler = assembler;
  }
}

function analyzeExpr(
  expr: Expression,
  declared: Set<string>,
  inputs: AnalyzedProgram["inputs"],
  bagLocals: ReadonlySet<string> = new Set(),
  options: ExpressionOptions = {},
): AnalyzedExpr {
  const { line, column } = locOf(expr);

  switch (expr.type) {
    case "NumericLiteral": {
      if (!Number.isInteger(expr.value)) {
        throw new SemanticError(
          "float literals are not supported in v1; use integer literals",
          line,
          column,
        );
      }
      return { kind: "literal", value: expr.value, line, column };
    }
    case "Identifier": {
      const substitution = options.substitutions?.get(expr.name);
      if (substitution !== undefined) return substitution;
      if (options.inFunction && options.mutableNames?.has(expr.name)) {
        throw new SemanticError(
          `function may not capture mutable local '${expr.name}'`,
          line,
          column,
        );
      }
      if (!declared.has(expr.name)) {
        throw new SemanticError(`undefined variable '${expr.name}'`, line, column);
      }
      const entityId = options.entityLocals?.get(expr.name);
      if (entityId !== undefined) {
        return { kind: "entity_ref", entityId, line, column };
      }
      return { kind: "ref", name: expr.name, line, column };
    }
    case "BinaryExpression":
      return analyzeBinaryExpr(expr, declared, inputs, bagLocals, options);
    case "LogicalExpression":
      return {
        kind: "logical",
        op: expr.operator,
        left: analyzeExpr(expr.left, declared, inputs, bagLocals, options),
        right: analyzeExpr(expr.right, declared, inputs, bagLocals, options),
        line,
        column,
      };
    case "CallExpression":
      return analyzeCallExpr(expr, declared, inputs, bagLocals, options);
    case "StringLiteral":
      throw new SemanticError(
        "string literals are only allowed as input()/output() signal names in v1",
        line,
        column,
      );
    case "TableConstructorExpression":
      return analyzeTableConstructor(expr, line, column);
    case "IndexExpression":
      return analyzeBagSample(expr, declared, inputs, bagLocals, options);
    case "MemberExpression":
      throw new SemanticError(
        'bag dot access is not supported in v4.0; use bag["signal-name"]',
        line,
        column,
      );
    case "FunctionDeclaration":
      throw new SemanticError("unsupported construct: function expression", line, column, "v3");
    default:
      throw new SemanticError(`unsupported construct: ${expr.type}`, line, column);
  }
}

function analyzeTableConstructor(
  expr: Extract<Expression, { type: "TableConstructorExpression" }>,
  line: number,
  column: number,
): AnalyzedExpr {
  if (expr.fields.length === 0) {
    throw new SemanticError("bag table constructor must not be empty", line, column);
  }

  const entries: Array<{ signal: string; count: number }> = [];
  const signals = new Set<string>();
  for (const field of expr.fields) {
    const { line: fieldLine, column: fieldColumn } = locOf(field);
    if (field.type !== "TableKey" || field.key.type !== "StringLiteral") {
      throw new SemanticError(
        "bag table keys must be bracketed string literal signal names",
        fieldLine,
        fieldColumn,
      );
    }
    const count = tableIntegerLiteral(field.value);
    if (count === undefined) {
      throw new SemanticError("bag table values must be integer literals", fieldLine, fieldColumn);
    }
    if (signals.has(field.key.value)) {
      throw new SemanticError(
        `bag table duplicate signal '${field.key.value}'`,
        fieldLine,
        fieldColumn,
      );
    }
    signals.add(field.key.value);
    entries.push({ signal: field.key.value, count });
  }
  return { kind: "bag_const", entries, line, column };
}

function tableIntegerLiteral(expr: Expression): number | undefined {
  if (expr.type === "NumericLiteral" && Number.isInteger(expr.value)) {
    return expr.value;
  }
  if (
    expr.type === "UnaryExpression" &&
    expr.operator === "-" &&
    expr.argument.type === "NumericLiteral" &&
    Number.isInteger(expr.argument.value)
  ) {
    return -expr.argument.value;
  }
  return undefined;
}

function analyzeBagSample(
  expr: Extract<Expression, { type: "IndexExpression" }>,
  declared: Set<string>,
  inputs: AnalyzedProgram["inputs"],
  bagLocals: ReadonlySet<string>,
  options: ExpressionOptions,
): AnalyzedExpr {
  const { line, column } = locOf(expr);
  if (expr.index.type !== "StringLiteral") {
    throw new SemanticError(
      "bag index must be a string literal signal name",
      locOf(expr.index).line,
      locOf(expr.index).column,
    );
  }
  const bag = analyzeExpr(expr.base, declared, inputs, bagLocals, options);
  if (!isBagExpr(bag, bagLocals)) {
    throw new SemanticError("index access requires a bag expression", line, column);
  }
  return { kind: "bag_sample", bag, signal: expr.index.value, line, column };
}

function analyzeBinaryExpr(
  expr: BinaryExpression,
  declared: Set<string>,
  inputs: AnalyzedProgram["inputs"],
  bagLocals: ReadonlySet<string> = new Set(),
  options: ExpressionOptions = {},
): AnalyzedExpr {
  const { line, column } = locOf(expr);

  if (!ARITH_OPS.has(expr.operator) && !CMP_OPS.has(expr.operator)) {
    throw new SemanticError(`unsupported operator '${expr.operator}'`, line, column);
  }

  const left = analyzeExpr(expr.left, declared, inputs, bagLocals, options);
  const right = analyzeExpr(expr.right, declared, inputs, bagLocals, options);

  if (ARITH_OPS.has(expr.operator)) {
    return { kind: "binop", op: expr.operator as ArithOp, left, right, line, column };
  }
  return { kind: "cmp", op: expr.operator as CmpOp, left, right, line, column };
}

function inlineFunctionCall(
  declaration: FunctionInfo,
  call: CallExpression,
  declared: Set<string>,
  inputs: AnalyzedProgram["inputs"],
  bagLocals: ReadonlySet<string>,
  options: ExpressionOptions,
  line: number,
  column: number,
): AnalyzedExpr {
  if (call.arguments.length !== declaration.parameters.length) {
    throw new SemanticError(
      `function '${declaration.name}' requires exactly ${declaration.parameters.length} argument${declaration.parameters.length === 1 ? "" : "s"}`,
      line,
      column,
    );
  }

  const substitutions = new Map(options.substitutions);
  for (let index = 0; index < declaration.parameters.length; index += 1) {
    substitutions.set(
      declaration.parameters[index]!,
      analyzeExpr(call.arguments[index]!, declared, inputs, bagLocals, options),
    );
  }

  const functionDeclared = new Set(declared);
  const functionBags = new Set(bagLocals);
  const functionLocalNames = new Set(declaration.parameters);
  for (const parameter of declaration.parameters) {
    functionDeclared.add(parameter);
  }

  const body = declaration.body;
  const last = body.at(-1);
  if (last?.type !== "ReturnStatement") {
    throw new SemanticError(
      `function '${declaration.name}' body must end with exactly one return expression`,
      declaration.line,
      declaration.column,
    );
  }

  for (const statement of body.slice(0, -1)) {
    const { line: statementLine, column: statementColumn } = locOf(statement);
    if (statement.type !== "LocalStatement") {
      throw new SemanticError(
        `function '${declaration.name}' body may only contain local declarations followed by return`,
        statementLine,
        statementColumn,
      );
    }
    const variable = statement.variables.length === 1 ? statement.variables[0] : undefined;
    const initializer = statement.init.length === 1 ? statement.init[0] : undefined;
    if (variable === undefined || initializer === undefined) {
      throw new SemanticError(
        "function local declarations must declare one initialized variable",
        statementLine,
        statementColumn,
      );
    }
    if (functionLocalNames.has(variable.name)) {
      throw new SemanticError(
        `function local '${variable.name}' is already defined`,
        statementLine,
        statementColumn,
      );
    }
    const value = analyzeExpr(initializer, functionDeclared, inputs, functionBags, {
      ...options,
      substitutions,
      inFunction: true,
    });
    if (isBagExpr(value, functionBags)) {
      functionBags.add(variable.name);
    } else {
      forbidBagInScalar(value, functionBags, statementLine, statementColumn);
    }
    functionDeclared.add(variable.name);
    functionLocalNames.add(variable.name);
    substitutions.set(variable.name, value);
  }

  if (last.arguments.length !== 1) {
    const { line: returnLine, column: returnColumn } = locOf(last);
    throw new SemanticError(
      `function '${declaration.name}' must return exactly one expression`,
      returnLine,
      returnColumn,
    );
  }
  return analyzeExpr(last.arguments[0]!, functionDeclared, inputs, functionBags, {
    ...options,
    substitutions,
    inFunction: true,
  });
}

function analyzeCallExpr(
  expr: CallExpression,
  declared: Set<string>,
  inputs: AnalyzedProgram["inputs"],
  bagLocals: ReadonlySet<string> = new Set(),
  options: ExpressionOptions = {},
): AnalyzedExpr {
  const { line, column } = locOf(expr);
  const calleeName = describeCallee(expr.base);

  if (calleeName === "output") {
    throw new SemanticError(
      "output() must be a top-level statement, not used within an expression",
      line,
      column,
    );
  }

  if (calleeName === "place") {
    throw new SemanticError(
      "place() may only be used as a local initializer or top-level statement",
      line,
      column,
    );
  }

  if (calleeName === "input_from") {
    if (expr.arguments.length !== 1) {
      throw new SemanticError("input_from(entity) requires exactly 1 entity handle", line, column);
    }
    const handle = analyzeExpr(expr.arguments[0]!, declared, inputs, bagLocals, options);
    if (handle.kind !== "entity_ref") {
      throw new SemanticError("input_from() requires an entity handle", line, column);
    }
    const place = options.entityPlaces?.get(handle.entityId);
    if (place === undefined) {
      throw new SemanticError("input_from() requires an entity handle", line, column);
    }
    if (isRoboport(place.name)) {
      place.roboport = { ...place.roboport, read_items_mode: 1 };
    } else if (isAssembler(place.name)) {
      place.assembler = { ...place.assembler, read_contents: true };
    } else if (isLogisticChest(place.name)) {
      place.logistic = { ...place.logistic, read_contents: true };
    } else {
      throw new SemanticError(
        "input_from() requires a logistic chest, roboport, assembling machine, or foundry",
        line,
        column,
      );
    }
    return { kind: "entity_read", entityId: handle.entityId, line, column };
  }

  rejectTickInExpression(calleeName, line, column);

  if (calleeName === "input" && options.inFunction) {
    throw new SemanticError("input() is only allowed at the top level", line, column);
  }

  if (calleeName === "sr" && options.inFunction) {
    throw new SemanticError("sr() is not allowed in a function body", line, column);
  }

  const functionDeclaration = calleeName ? options.functions?.get(calleeName) : undefined;
  if (functionDeclaration !== undefined) {
    return inlineFunctionCall(
      functionDeclaration,
      expr,
      declared,
      inputs,
      bagLocals,
      options,
      line,
      column,
    );
  }

  if (calleeName === "sr") {
    if (expr.arguments.length !== 3) {
      throw new SemanticError("sr(state, set, reset) requires exactly 3 arguments", line, column);
    }
    const state = analyzeExpr(expr.arguments[0]!, declared, inputs, bagLocals, options);
    const set = analyzeExpr(expr.arguments[1]!, declared, inputs, bagLocals, options);
    const reset = analyzeExpr(expr.arguments[2]!, declared, inputs, bagLocals, options);
    return { kind: "sr", state, set, reset, line, column };
  }

  if (calleeName === "signal_count") {
    if (expr.arguments.length === 0) {
      throw new SemanticError("signal_count(...) requires at least 1 argument", line, column);
    }
    return {
      kind: "signal_count",
      args: expr.arguments.map((arg) => analyzeExpr(arg, declared, inputs, bagLocals, options)),
      line,
      column,
    };
  }

  if (calleeName === "signal_at" || calleeName === "signal_at_asc") {
    if (expr.arguments.length < 2) {
      throw new SemanticError(
        `${calleeName}(index, signal, ...) requires an index and at least one signal`,
        line,
        column,
      );
    }
    const indexArg = expr.arguments[0]!;
    if (indexArg.type !== "NumericLiteral" || !Number.isInteger(indexArg.value)) {
      throw new SemanticError(
        `${calleeName} index must be a non-negative integer literal`,
        locOf(indexArg).line,
        locOf(indexArg).column,
      );
    }
    if (indexArg.value < 0) {
      throw new SemanticError(
        `${calleeName} index must be >= 0`,
        locOf(indexArg).line,
        locOf(indexArg).column,
      );
    }
    return {
      kind: "signal_at",
      index: indexArg.value,
      ascending: calleeName === "signal_at_asc",
      args: expr.arguments
        .slice(1)
        .map((arg) => analyzeExpr(arg, declared, inputs, bagLocals, options)),
      line,
      column,
    };
  }

  if (calleeName === "each_latch") {
    if (expr.arguments.length < 3 || expr.arguments.length % 3 !== 0) {
      throw new SemanticError(
        "each_latch(level, signal, high, ...) requires one or more triples",
        line,
        column,
      );
    }
    const entries: Extract<AnalyzedExpr, { kind: "each_latch" }>["entries"] = [];
    const signals = new Set<string>();
    for (let i = 0; i < expr.arguments.length; i += 3) {
      const levelArg = expr.arguments[i]!;
      const signalArg = expr.arguments[i + 1]!;
      const highArg = expr.arguments[i + 2]!;
      if (signalArg.type !== "StringLiteral") {
        throw new SemanticError(
          "each_latch signal must be a string literal signal name",
          locOf(signalArg).line,
          locOf(signalArg).column,
        );
      }
      if (signals.has(signalArg.value)) {
        throw new SemanticError(
          `each_latch duplicate signal '${signalArg.value}'`,
          locOf(signalArg).line,
          locOf(signalArg).column,
        );
      }
      signals.add(signalArg.value);
      if (highArg.type !== "NumericLiteral" || !Number.isInteger(highArg.value)) {
        throw new SemanticError(
          "each_latch high must be a positive integer literal",
          locOf(highArg).line,
          locOf(highArg).column,
        );
      }
      if (highArg.value <= 0) {
        throw new SemanticError(
          "each_latch high must be > 0",
          locOf(highArg).line,
          locOf(highArg).column,
        );
      }
      const level = analyzeExpr(levelArg, declared, inputs, bagLocals, options);
      forbidBagInScalar(level, bagLocals, locOf(levelArg).line, locOf(levelArg).column);
      entries.push({
        level,
        signal: signalArg.value,
        buffer: highArg.value,
        tag: entries.length + 1,
      });
    }
    return { kind: "each_latch", entries, line, column };
  }

  if (calleeName === "bag_const") {
    if (expr.arguments.length < 2 || expr.arguments.length % 2 !== 0) {
      throw new SemanticError(
        "bag_const(signal, count, ...) requires one or more signal/count pairs",
        line,
        column,
      );
    }
    const entries: Extract<AnalyzedExpr, { kind: "bag_const" }>["entries"] = [];
    const signals = new Set<string>();
    for (let i = 0; i < expr.arguments.length; i += 2) {
      const signalArg = expr.arguments[i]!;
      const countArg = expr.arguments[i + 1]!;
      if (signalArg.type !== "StringLiteral") {
        throw new SemanticError(
          "bag_const signal must be a string literal signal name",
          locOf(signalArg).line,
          locOf(signalArg).column,
        );
      }
      if (countArg.type !== "NumericLiteral" || !Number.isInteger(countArg.value)) {
        throw new SemanticError(
          "bag_const count must be an integer literal",
          locOf(countArg).line,
          locOf(countArg).column,
        );
      }
      if (signals.has(signalArg.value)) {
        throw new SemanticError(
          `bag_const duplicate signal '${signalArg.value}'`,
          locOf(signalArg).line,
          locOf(signalArg).column,
        );
      }
      signals.add(signalArg.value);
      entries.push({ signal: signalArg.value, count: countArg.value });
    }
    return { kind: "bag_const", entries, line, column };
  }

  if (calleeName === "bag_arith") {
    if (expr.arguments.length !== 3) {
      throw new SemanticError(
        "bag_arith(op, left, right) requires exactly 3 arguments",
        line,
        column,
      );
    }
    const opArg = expr.arguments[0]!;
    if (opArg.type !== "StringLiteral" || !ARITH_OPS.has(opArg.value)) {
      throw new SemanticError(
        'bag_arith op must be one of "+", "-", "*", "/", or "%"',
        locOf(opArg).line,
        locOf(opArg).column,
      );
    }
    const left = analyzeExpr(expr.arguments[1]!, declared, inputs, bagLocals, options);
    const right = analyzeExpr(expr.arguments[2]!, declared, inputs, bagLocals, options);
    if (!isBagExpr(left, bagLocals)) {
      throw new SemanticError("bag_arith left operand must be a bag expression", line, column);
    }
    if (!isBagExpr(right, bagLocals)) {
      throw new SemanticError("bag_arith right operand must be a bag expression", line, column);
    }
    return { kind: "bag_binop", op: opArg.value as ArithOp, left, right, line, column };
  }

  if (calleeName === "bag_filter") {
    if (expr.arguments.length !== 3) {
      throw new SemanticError(
        "bag_filter(mode, data, mask) requires exactly 3 arguments",
        line,
        column,
      );
    }
    const modeArg = expr.arguments[0]!;
    if (
      modeArg.type !== "StringLiteral" ||
      (modeArg.value !== "include" && modeArg.value !== "exclude" && modeArg.value !== "limit")
    ) {
      throw new SemanticError(
        'bag_filter mode must be "include", "exclude", or "limit"',
        locOf(modeArg).line,
        locOf(modeArg).column,
      );
    }
    const data = analyzeExpr(expr.arguments[1]!, declared, inputs, bagLocals, options);
    const mask = analyzeExpr(expr.arguments[2]!, declared, inputs, bagLocals, options);
    if (!isBagExpr(data, bagLocals)) {
      throw new SemanticError("bag_filter data operand must be a bag expression", line, column);
    }
    if (!isBagExpr(mask, bagLocals)) {
      throw new SemanticError("bag_filter mask operand must be a bag expression", line, column);
    }
    return { kind: "bag_filter", mode: modeArg.value, data, mask, line, column };
  }

  if (calleeName === "bag_test") {
    if (expr.arguments.length !== 4) {
      throw new SemanticError(
        'bag_test("any"|"every", op, bag, threshold) requires exactly 4 arguments',
        line,
        column,
      );
    }
    const modeArg = expr.arguments[0]!;
    const opArg = expr.arguments[1]!;
    const bag = analyzeExpr(expr.arguments[2]!, declared, inputs, bagLocals, options);
    const thresholdArg = expr.arguments[3]!;
    if (
      modeArg.type !== "StringLiteral" ||
      (modeArg.value !== "any" && modeArg.value !== "every")
    ) {
      throw new SemanticError(
        'bag_test mode must be "any" or "every"',
        locOf(modeArg).line,
        locOf(modeArg).column,
      );
    }
    if (opArg.type !== "StringLiteral" || !CMP_OPS.has(opArg.value)) {
      throw new SemanticError(
        'bag_test op must be "<", ">", "<=", ">=", "==", or "~="',
        locOf(opArg).line,
        locOf(opArg).column,
      );
    }
    if (!isBagExpr(bag, bagLocals)) {
      throw new SemanticError("bag_test bag operand must be a bag expression", line, column);
    }
    if (thresholdArg.type !== "NumericLiteral" || !Number.isInteger(thresholdArg.value)) {
      throw new SemanticError(
        "bag_test threshold must be an integer literal",
        locOf(thresholdArg).line,
        locOf(thresholdArg).column,
      );
    }
    return {
      kind: "bag_test",
      mode: modeArg.value,
      op: opArg.value as CmpOp,
      bag,
      value: thresholdArg.value,
      line,
      column,
    };
  }

  if (calleeName === "edge") {
    if (expr.arguments.length !== 1) {
      throw new SemanticError("edge(value) requires exactly 1 argument", line, column);
    }
    const value = analyzeExpr(expr.arguments[0]!, declared, inputs, bagLocals, options);
    forbidBagInScalar(value, bagLocals, line, column);
    return { kind: "edge", value, line, column };
  }

  if (calleeName !== "input") {
    const found = calleeName ? ` to '${calleeName}'` : "";
    throw new SemanticError(
      `unsupported construct: function call${found}; user-defined functions`,
      line,
      column,
      "v3",
    );
  }

  const signalArg = expr.arguments.length === 1 ? expr.arguments[0] : undefined;
  if (signalArg?.type !== "StringLiteral") {
    throw new SemanticError("input() requires a string literal signal name", line, column);
  }

  inputs.push({ signal: signalArg.value, line, column });
  return { kind: "input", signal: signalArg.value, line, column };
}
