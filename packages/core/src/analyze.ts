import type {
  BinaryExpression,
  CallExpression,
  CallStatement,
  Chunk,
  Expression,
  Identifier,
  IndexExpression,
  LocalStatement,
  MemberExpression,
  Statement,
} from "luaparse";

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
    };

export type AnalyzedAssign = {
  name: string;
  expr: AnalyzedExpr;
  line: number;
  column: number;
};

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
}

const ARITH_OPS: ReadonlySet<string> = new Set(["+", "-", "*", "/", "%"]);
const CMP_OPS: ReadonlySet<string> = new Set(["<", ">", "<=", ">=", "==", "~="]);

interface Loc {
  loc?: { start: { line: number; column: number } } | undefined;
}

interface AnalyzeContext {
  declared: Set<string>;
  reassigned: Set<string>;
  statements: AnalyzedStatement[];
  outputs: AnalyzedProgram["outputs"];
  inputs: AnalyzedProgram["inputs"];
  /** True after a top-level while/for (clocked mode). */
  seenLoop: boolean;
  /** True after a top-level assign or if (free-running stores). */
  seenFreeRunningStore: boolean;
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
  const ctx: AnalyzeContext = {
    declared: new Set<string>(),
    reassigned: new Set<string>(),
    statements: [],
    outputs: [],
    inputs: [],
    seenLoop: false,
    seenFreeRunningStore: false,
  };

  for (const statement of ast.body) {
    analyzeStatement(statement, ctx);
  }

  if (ctx.outputs.length === 0) {
    const { line, column } = locOf(ast);
    throw new SemanticError("program must contain at least one output() call", line, column);
  }

  return { statements: ctx.statements, outputs: ctx.outputs, inputs: ctx.inputs };
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

  const cond = analyzeExpr(statement.condition, ctx.declared, ctx.inputs);
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

  const start = analyzeExpr(statement.start, ctx.declared, ctx.inputs);
  const stop = analyzeExpr(statement.end, ctx.declared, ctx.inputs);

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
      const assign = analyzeBranchAssign(statement, ctx.declared, ctx.inputs, inductionVar);
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
  inductionVar?: string,
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

  return {
    name: target.name,
    expr: analyzeExpr(initExpr, declared, inputs),
    line,
    column,
  };
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

  if (statement.clauses.some((clause) => clause.type === "ElseifClause")) {
    throw new SemanticError(
      "unsupported construct: elseif; use nested if/else or and/or in v2 phase 2",
      line,
      column,
    );
  }

  if (statement.clauses.length > 2) {
    throw new SemanticError(
      "if statement may have at most one else clause in v2 phase 2",
      line,
      column,
    );
  }

  const elseClause = statement.clauses[1];
  if (elseClause && elseClause.type !== "ElseClause") {
    throw new SemanticError("unexpected clause after if", line, column);
  }

  const cond = analyzeExpr(first.condition, ctx.declared, ctx.inputs);
  const thenAssigns = first.body.map((bodyStmt) =>
    analyzeBranchAssign(bodyStmt, ctx.declared, ctx.inputs, inductionVar),
  );
  const elseAssigns = elseClause
    ? elseClause.body.map((bodyStmt) =>
        analyzeBranchAssign(bodyStmt, ctx.declared, ctx.inputs, inductionVar),
      )
    : [];

  if (thenAssigns.length === 0 && elseAssigns.length === 0) {
    throw new SemanticError("if/else must assign at least one variable", line, column);
  }

  // One assign per name within a branch; names across branches share one next-state slot.
  const thenNames = new Set<string>();
  for (const assign of thenAssigns) {
    if (thenNames.has(assign.name)) {
      throw new SemanticError(
        `variable '${assign.name}' is assigned more than once in the then branch`,
        assign.line,
        assign.column,
      );
    }
    thenNames.add(assign.name);
  }
  const elseNames = new Set<string>();
  for (const assign of elseAssigns) {
    if (elseNames.has(assign.name)) {
      throw new SemanticError(
        `variable '${assign.name}' is assigned more than once in the else branch`,
        assign.line,
        assign.column,
      );
    }
    elseNames.add(assign.name);
  }

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
  markReassigned(name, ctx.reassigned, line, column);

  const expr = analyzeExpr(initExpr, ctx.declared, ctx.inputs);
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

  const expr = analyzeExpr(initExpr, ctx.declared, ctx.inputs);
  ctx.declared.add(name);
  ctx.statements.push({ kind: "local", name, expr, line, column });
}

function analyzeCallStatement(statement: CallStatement, ctx: AnalyzeContext): void {
  const { line, column } = locOf(statement);
  const call = statement.expression;

  if (call.type !== "CallExpression") {
    throw new SemanticError(
      'only output("signal", expr) calls are supported as statements in v1',
      line,
      column,
    );
  }

  const calleeName = describeCallee(call.base);
  rejectTickInExpression(calleeName, line, column);
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

  const expr = analyzeExpr(valueArg, ctx.declared, ctx.inputs);
  ctx.outputs.push({ signal: signalArg.value, expr, line, column });
}

function analyzeExpr(
  expr: Expression,
  declared: Set<string>,
  inputs: AnalyzedProgram["inputs"],
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
      if (!declared.has(expr.name)) {
        throw new SemanticError(`undefined variable '${expr.name}'`, line, column);
      }
      return { kind: "ref", name: expr.name, line, column };
    }
    case "BinaryExpression":
      return analyzeBinaryExpr(expr, declared, inputs);
    case "LogicalExpression":
      return {
        kind: "logical",
        op: expr.operator,
        left: analyzeExpr(expr.left, declared, inputs),
        right: analyzeExpr(expr.right, declared, inputs),
        line,
        column,
      };
    case "CallExpression":
      return analyzeCallExpr(expr, inputs);
    case "StringLiteral":
      throw new SemanticError(
        "string literals are only allowed as input()/output() signal names in v1",
        line,
        column,
      );
    case "TableConstructorExpression":
      throw new SemanticError("unsupported construct: table constructor", line, column, "v4");
    case "FunctionDeclaration":
      throw new SemanticError("unsupported construct: function expression", line, column, "v3");
    default:
      throw new SemanticError(`unsupported construct: ${expr.type}`, line, column);
  }
}

function analyzeBinaryExpr(
  expr: BinaryExpression,
  declared: Set<string>,
  inputs: AnalyzedProgram["inputs"],
): AnalyzedExpr {
  const { line, column } = locOf(expr);

  if (!ARITH_OPS.has(expr.operator) && !CMP_OPS.has(expr.operator)) {
    throw new SemanticError(`unsupported operator '${expr.operator}'`, line, column);
  }

  const left = analyzeExpr(expr.left, declared, inputs);
  const right = analyzeExpr(expr.right, declared, inputs);

  if (ARITH_OPS.has(expr.operator)) {
    return { kind: "binop", op: expr.operator as ArithOp, left, right, line, column };
  }
  return { kind: "cmp", op: expr.operator as CmpOp, left, right, line, column };
}

function analyzeCallExpr(expr: CallExpression, inputs: AnalyzedProgram["inputs"]): AnalyzedExpr {
  const { line, column } = locOf(expr);
  const calleeName = describeCallee(expr.base);

  if (calleeName === "output") {
    throw new SemanticError(
      "output() must be a top-level statement, not used within an expression",
      line,
      column,
    );
  }

  rejectTickInExpression(calleeName, line, column);

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
