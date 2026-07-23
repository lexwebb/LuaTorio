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
  /** Locals initialized with a bag expression — wire values, not scalar memory. */
  bagLocals: Set<string>;
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
    bagLocals: new Set<string>(),
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

  const cond = analyzeExpr(statement.condition, ctx.declared, ctx.inputs, ctx.bagLocals);
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

  const start = analyzeExpr(statement.start, ctx.declared, ctx.inputs, ctx.bagLocals);
  const stop = analyzeExpr(statement.end, ctx.declared, ctx.inputs, ctx.bagLocals);
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
  if (bagLocals.has(target.name)) {
    throw new SemanticError(
      `bag local '${target.name}' cannot be reassigned; bag state is combinator-owned`,
      line,
      column,
    );
  }

  const expr = analyzeExpr(initExpr, declared, inputs, bagLocals);
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
        analyzeBranchAssign(statement, ctx.declared, ctx.inputs, ctx.bagLocals, inductionVar),
      );
      continue;
    }
    if (statement.type === "IfStatement") {
      const { line, column } = locOf(statement);
      const { cond, thenAssigns, elseAssigns } = analyzeIfClauses(statement, ctx, inductionVar);
      assigns.push(
        ...desugarConditionalAssigns(cond, thenAssigns, elseAssigns, line, column),
      );
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

  const cond = analyzeExpr(first.condition, ctx.declared, ctx.inputs, ctx.bagLocals);
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
  markReassigned(name, ctx.reassigned, line, column);

  const expr = analyzeExpr(initExpr, ctx.declared, ctx.inputs, ctx.bagLocals);
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

  const expr = analyzeExpr(initExpr, ctx.declared, ctx.inputs, ctx.bagLocals);
  if (isBagExpr(expr, ctx.bagLocals)) {
    ctx.bagLocals.add(name);
  } else {
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

  const expr = analyzeExpr(valueArg, ctx.declared, ctx.inputs, ctx.bagLocals);
  if (!isBagExpr(expr, ctx.bagLocals)) {
    forbidBagInScalar(expr, ctx.bagLocals, line, column);
  }
  ctx.outputs.push({ signal: signalArg.value, expr, line, column });
}

function analyzeExpr(
  expr: Expression,
  declared: Set<string>,
  inputs: AnalyzedProgram["inputs"],
  bagLocals: ReadonlySet<string> = new Set(),
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
      return analyzeBinaryExpr(expr, declared, inputs, bagLocals);
    case "LogicalExpression":
      return {
        kind: "logical",
        op: expr.operator,
        left: analyzeExpr(expr.left, declared, inputs, bagLocals),
        right: analyzeExpr(expr.right, declared, inputs, bagLocals),
        line,
        column,
      };
    case "CallExpression":
      return analyzeCallExpr(expr, declared, inputs, bagLocals);
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
  bagLocals: ReadonlySet<string> = new Set(),
): AnalyzedExpr {
  const { line, column } = locOf(expr);

  if (!ARITH_OPS.has(expr.operator) && !CMP_OPS.has(expr.operator)) {
    throw new SemanticError(`unsupported operator '${expr.operator}'`, line, column);
  }

  const left = analyzeExpr(expr.left, declared, inputs, bagLocals);
  const right = analyzeExpr(expr.right, declared, inputs, bagLocals);

  if (ARITH_OPS.has(expr.operator)) {
    return { kind: "binop", op: expr.operator as ArithOp, left, right, line, column };
  }
  return { kind: "cmp", op: expr.operator as CmpOp, left, right, line, column };
}

function analyzeCallExpr(
  expr: CallExpression,
  declared: Set<string>,
  inputs: AnalyzedProgram["inputs"],
  bagLocals: ReadonlySet<string> = new Set(),
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

  rejectTickInExpression(calleeName, line, column);

  if (calleeName === "sr") {
    if (expr.arguments.length !== 3) {
      throw new SemanticError("sr(state, set, reset) requires exactly 3 arguments", line, column);
    }
    const state = analyzeExpr(expr.arguments[0]!, declared, inputs, bagLocals);
    const set = analyzeExpr(expr.arguments[1]!, declared, inputs, bagLocals);
    const reset = analyzeExpr(expr.arguments[2]!, declared, inputs, bagLocals);
    return { kind: "sr", state, set, reset, line, column };
  }

  if (calleeName === "signal_count") {
    if (expr.arguments.length === 0) {
      throw new SemanticError("signal_count(...) requires at least 1 argument", line, column);
    }
    return {
      kind: "signal_count",
      args: expr.arguments.map((arg) => analyzeExpr(arg, declared, inputs, bagLocals)),
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
        .map((arg) => analyzeExpr(arg, declared, inputs, bagLocals)),
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
      const level = analyzeExpr(levelArg, declared, inputs, bagLocals);
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
      throw new SemanticError("bag_arith(op, left, right) requires exactly 3 arguments", line, column);
    }
    const opArg = expr.arguments[0]!;
    if (opArg.type !== "StringLiteral" || !ARITH_OPS.has(opArg.value)) {
      throw new SemanticError(
        'bag_arith op must be one of "+", "-", "*", "/", or "%"',
        locOf(opArg).line,
        locOf(opArg).column,
      );
    }
    const left = analyzeExpr(expr.arguments[1]!, declared, inputs, bagLocals);
    const right = analyzeExpr(expr.arguments[2]!, declared, inputs, bagLocals);
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
    const data = analyzeExpr(expr.arguments[1]!, declared, inputs, bagLocals);
    const mask = analyzeExpr(expr.arguments[2]!, declared, inputs, bagLocals);
    if (!isBagExpr(data, bagLocals)) {
      throw new SemanticError("bag_filter data operand must be a bag expression", line, column);
    }
    if (!isBagExpr(mask, bagLocals)) {
      throw new SemanticError("bag_filter mask operand must be a bag expression", line, column);
    }
    return { kind: "bag_filter", mode: modeArg.value, data, mask, line, column };
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
