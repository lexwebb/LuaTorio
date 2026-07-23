import type { CircuitEntity } from "../combinators.js";
import { bagGet, bagSet, emptyBag, type SignalBag, toInt32 } from "./signals.js";

type SignalRef = { type?: unknown; name?: unknown };

function signalName(ref: unknown): string | undefined {
  if (ref === null || typeof ref !== "object") {
    return undefined;
  }
  const name = (ref as SignalRef).name;
  return typeof name === "string" ? name : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOperand(
  net: SignalBag,
  signalKey: string,
  constantKey: string,
  conditions: Record<string, unknown>,
): number {
  const fromSignal = signalName(conditions[signalKey]);
  if (fromSignal !== undefined) {
    return bagGet(net, fromSignal);
  }
  const constant = asNumber(conditions[constantKey]);
  return constant !== undefined ? toInt32(constant) : 0;
}

function evalArithOp(op: string, left: number, right: number): number {
  switch (op) {
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
      throw new Error(`simulate: unsupported arithmetic operation '${op}'`);
  }
}

function compare(comparator: string, left: number, right: number): boolean {
  switch (comparator) {
    case "<":
      return left < right;
    case ">":
      return left > right;
    case "<=":
      return left <= right;
    case ">=":
      return left >= right;
    case "=":
      return left === right;
    case "!=":
    case "≠":
      return left !== right;
    default:
      throw new Error(`simulate: unsupported comparator '${comparator}'`);
  }
}

function readConditionOperand(
  net: SignalBag,
  condition: Record<string, unknown>,
  side: "first" | "second",
): number {
  if (side === "first") {
    const fromSignal = signalName(condition.first_signal);
    if (fromSignal !== undefined) {
      return bagGet(net, fromSignal);
    }
    const constant = asNumber(condition.first_constant);
    return constant !== undefined ? toInt32(constant) : 0;
  }
  const fromSignal = signalName(condition.second_signal);
  if (fromSignal !== undefined) {
    return bagGet(net, fromSignal);
  }
  // combinators.ts uses `constant` for the right-hand literal on cmp/decider gates.
  const constant = asNumber(condition.constant) ?? asNumber(condition.second_constant);
  return constant !== undefined ? toInt32(constant) : 0;
}

/** Emit section filters for a non-empty constant combinator. Empty sections → empty bag. */
export function evalConstant(entity: CircuitEntity): SignalBag {
  const out = emptyBag();
  const sectionsRoot = entity.control_behavior.sections;
  if (sectionsRoot === null || typeof sectionsRoot !== "object") {
    return out;
  }
  const sections = (sectionsRoot as { sections?: unknown }).sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    return out;
  }
  for (const section of sections) {
    if (section === null || typeof section !== "object") {
      continue;
    }
    const filters = (section as { filters?: unknown }).filters;
    if (!Array.isArray(filters)) {
      continue;
    }
    for (const filter of filters) {
      if (filter === null || typeof filter !== "object") {
        continue;
      }
      const name = signalName(filter);
      const count = asNumber((filter as { count?: unknown }).count);
      if (name !== undefined && count !== undefined) {
        bagSet(out, name, bagGet(out, name) + toInt32(count));
      }
    }
  }
  return out;
}

/** Evaluate an arithmetic combinator against its input network. */
export function evalArithmetic(entity: CircuitEntity, net: SignalBag): SignalBag {
  const out = emptyBag();
  const conditions = entity.control_behavior.arithmetic_conditions;
  if (conditions === null || typeof conditions !== "object") {
    return out;
  }
  const c = conditions as Record<string, unknown>;
  const op = typeof c.operation === "string" ? c.operation : "+";
  const left = readOperand(net, "first_signal", "first_constant", c);
  const right = readOperand(net, "second_signal", "second_constant", c);
  const output = signalName(c.output_signal) ?? entity.outputSignal;
  bagSet(out, output, evalArithOp(op, left, right));
  return out;
}

function emitDeciderOutputs(
  outputs: unknown,
  entity: CircuitEntity,
  net: SignalBag,
  out: SignalBag,
): void {
  if (!Array.isArray(outputs)) {
    return;
  }
  for (const raw of outputs) {
    if (raw === null || typeof raw !== "object") {
      continue;
    }
    const output = raw as Record<string, unknown>;
    const name = signalName(output.signal) ?? entity.outputSignal;
    if (output.copy_count_from_input === true) {
      bagSet(out, name, bagGet(net, name));
    } else {
      const constant = asNumber(output.constant) ?? 1;
      bagSet(out, name, constant);
    }
  }
}

/** Evaluate a decider combinator (AND of conditions) against its input network. */
export function evalDecider(entity: CircuitEntity, net: SignalBag): SignalBag {
  const out = emptyBag();
  const root = entity.control_behavior.decider_conditions;
  if (root === null || typeof root !== "object") {
    return out;
  }
  const block = root as { conditions?: unknown; outputs?: unknown; else_outputs?: unknown };
  const conditions = Array.isArray(block.conditions) ? block.conditions : [];
  let ok = true;
  for (let i = 0; i < conditions.length; i += 1) {
    const raw = conditions[i];
    if (raw === null || typeof raw !== "object") {
      ok = false;
      break;
    }
    const condition = raw as Record<string, unknown>;
    if (i > 0) {
      const join = condition.compare_type;
      // Only AND is emitted today; treat missing join as AND.
      if (join !== undefined && join !== "and") {
        throw new Error(`simulate: unsupported compare_type '${String(join)}'`);
      }
    }
    const comparator = typeof condition.comparator === "string" ? condition.comparator : "=";
    const left = readConditionOperand(net, condition, "first");
    const right = readConditionOperand(net, condition, "second");
    if (!compare(comparator, left, right)) {
      ok = false;
      break;
    }
  }

  // Factorio 2.x: `outputs` when conditions pass, `else_outputs` when they fail.
  emitDeciderOutputs(ok ? block.outputs : block.else_outputs, entity, net, out);
  return out;
}

/** Evaluate any non-latch entity given its current input network. */
export function evalEntity(entity: CircuitEntity, net: SignalBag): SignalBag {
  switch (entity.kind) {
    case "constant":
      return evalConstant(entity);
    case "arithmetic":
      return evalArithmetic(entity, net);
    case "decider":
      return evalDecider(entity, net);
    default: {
      const unreachable: never = entity.kind;
      throw new Error(`simulate: unhandled entity kind '${String(unreachable)}'`);
    }
  }
}

/** True when a constant entity has no section filters (I/O placeholder). */
export function isEmptyConstant(entity: CircuitEntity): boolean {
  if (entity.kind !== "constant") {
    return false;
  }
  const bag = evalConstant(entity);
  return bag.size === 0;
}
