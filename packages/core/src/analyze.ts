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

export type AnalyzedStatement = {
  kind: "local" | "assign";
  name: string;
  expr: AnalyzedExpr;
  line: number;
  column: number;
};

export interface AnalyzedProgram {
  /** Ordered locals and assignments — enough for IR lowering */
  statements: AnalyzedStatement[];
  outputs: Array<{ signal: string; expr: AnalyzedExpr; line: number; column: number }>;
  inputs: Array<{ signal: string; line: number; column: number }>;
}

const ARITH_OPS: ReadonlySet<string> = new Set(["+", "-", "*", "/", "%"]);
const CMP_OPS: ReadonlySet<string> = new Set(["<", ">", "<=", ">=", "==", "~="]);

interface Loc {
  loc?: { start: { line: number; column: number } } | undefined;
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

function rejectTick(calleeName: string | undefined, line: number, column: number): void {
  if (calleeName === "tick") {
    throw new SemanticError(
      "unsupported construct: tick(); planned for v2 phase 3 (tick scheduler)",
      line,
      column,
      "v2",
    );
  }
}

/**
 * Walks a luaparse `Chunk` and enforces the language subset (v1 + v2 phase 1 reassignment),
 * returning a validated, minimally-typed program model. Throws `SemanticError` (with
 * line/column and, where the construct is on the roadmap, a `plannedVersion`) for anything
 * outside the supported subset.
 */
export function analyze(ast: Chunk): AnalyzedProgram {
  const declared = new Set<string>();
  const reassigned = new Set<string>();
  const statements: AnalyzedStatement[] = [];
  const outputs: AnalyzedProgram["outputs"] = [];
  const inputs: AnalyzedProgram["inputs"] = [];

  for (const statement of ast.body) {
    analyzeStatement(statement, declared, reassigned, statements, outputs, inputs);
  }

  if (outputs.length === 0) {
    const { line, column } = locOf(ast);
    throw new SemanticError("program must contain at least one output() call", line, column);
  }

  return { statements, outputs, inputs };
}

function analyzeStatement(
  statement: Statement,
  declared: Set<string>,
  reassigned: Set<string>,
  statements: AnalyzedStatement[],
  outputs: AnalyzedProgram["outputs"],
  inputs: AnalyzedProgram["inputs"],
): void {
  const { line, column } = locOf(statement);

  switch (statement.type) {
    case "LocalStatement":
      analyzeLocalStatement(statement, declared, statements, inputs);
      return;
    case "CallStatement":
      analyzeCallStatement(statement, declared, outputs, inputs);
      return;
    case "AssignmentStatement":
      analyzeAssignmentStatement(statement, declared, reassigned, statements, inputs);
      return;
    case "WhileStatement":
      throw new SemanticError(
        "unsupported construct: while loop; planned for v2 phase 3 (tick scheduler)",
        line,
        column,
        "v2",
      );
    case "RepeatStatement":
      throw new SemanticError(
        "unsupported construct: repeat loop; planned for v2 phase 3 (tick scheduler)",
        line,
        column,
        "v2",
      );
    case "ForNumericStatement":
    case "ForGenericStatement":
      throw new SemanticError(
        "unsupported construct: for loop; planned for v2 phase 3 (tick scheduler)",
        line,
        column,
        "v2",
      );
    case "FunctionDeclaration":
      throw new SemanticError("unsupported construct: function declaration", line, column, "v3");
    case "IfStatement":
      throw new SemanticError(
        "unsupported construct: if/else statement; use the `a and b or c` and/or idiom for conditional values, or wait for v2 phase 2",
        line,
        column,
        "v2",
      );
    default:
      throw new SemanticError(`unsupported construct: ${statement.type}`, line, column);
  }
}

function analyzeAssignmentStatement(
  statement: Extract<Statement, { type: "AssignmentStatement" }>,
  declared: Set<string>,
  reassigned: Set<string>,
  statements: AnalyzedStatement[],
  inputs: AnalyzedProgram["inputs"],
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
  if (!declared.has(name)) {
    throw new SemanticError(`undefined variable '${name}'`, line, column);
  }
  if (reassigned.has(name)) {
    throw new SemanticError(
      `variable '${name}' already has a next-state assignment; only one reassignment per variable is supported in v2 phase 1`,
      line,
      column,
    );
  }

  const expr = analyzeExpr(initExpr, declared, inputs);
  reassigned.add(name);
  statements.push({ kind: "assign", name, expr, line, column });
}

function analyzeLocalStatement(
  statement: LocalStatement,
  declared: Set<string>,
  statements: AnalyzedStatement[],
  inputs: AnalyzedProgram["inputs"],
): void {
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

  if (declared.has(name)) {
    throw new SemanticError(
      `variable '${name}' is already defined; redeclaration is not supported in v1`,
      line,
      column,
      "v2",
    );
  }

  const expr = analyzeExpr(initExpr, declared, inputs);
  declared.add(name);
  statements.push({ kind: "local", name, expr, line, column });
}

function analyzeCallStatement(
  statement: CallStatement,
  declared: Set<string>,
  outputs: AnalyzedProgram["outputs"],
  inputs: AnalyzedProgram["inputs"],
): void {
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
  rejectTick(calleeName, line, column);
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

  const expr = analyzeExpr(valueArg, declared, inputs);
  outputs.push({ signal: signalArg.value, expr, line, column });
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

  rejectTick(calleeName, line, column);

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
