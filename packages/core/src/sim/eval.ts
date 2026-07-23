import type { CircuitEntity } from "../combinators.js";
import { bagGet, bagSet, emptyBag, type SignalBag, toInt32 } from "./signals.js";

type SignalRef = { type?: unknown; name?: unknown };

/** Factorio pure virtual / logic signals. */
export const SIGNAL_EACH = "signal-each";
export const SIGNAL_EVERYTHING = "signal-everything";
export const SIGNAL_ANYTHING = "signal-anything";

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

function isSpecialSignal(name: string): boolean {
  return name === SIGNAL_EACH || name === SIGNAL_EVERYTHING || name === SIGNAL_ANYTHING;
}

/** Non-zero, non-special signals present on the network (Factorio "present" ≡ nonzero). */
function presentSignals(net: SignalBag): string[] {
  const names: string[] = [];
  for (const [name, count] of net) {
    if (count !== 0 && !isSpecialSignal(name)) {
      names.push(name);
    }
  }
  return names;
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

function readOperand(
  net: SignalBag,
  signalKey: string,
  constantKey: string,
  conditions: Record<string, unknown>,
  eachValue?: number,
): number {
  const fromSignal = signalName(conditions[signalKey]);
  if (fromSignal === SIGNAL_EACH) {
    return eachValue ?? 0;
  }
  if (fromSignal !== undefined) {
    return bagGet(net, fromSignal);
  }
  const constant = asNumber(conditions[constantKey]);
  return constant !== undefined ? toInt32(constant) : 0;
}

function readConditionOperand(
  net: SignalBag,
  condition: Record<string, unknown>,
  side: "first" | "second",
  eachValue?: number,
): number {
  if (side === "first") {
    const fromSignal = signalName(condition.first_signal);
    if (fromSignal === SIGNAL_EACH) {
      return eachValue ?? 0;
    }
    if (fromSignal !== undefined) {
      return bagGet(net, fromSignal);
    }
    const constant = asNumber(condition.first_constant);
    return constant !== undefined ? toInt32(constant) : 0;
  }
  const fromSignal = signalName(condition.second_signal);
  if (fromSignal === SIGNAL_EACH) {
    return eachValue ?? 0;
  }
  if (fromSignal !== undefined) {
    return bagGet(net, fromSignal);
  }
  const constant = asNumber(condition.constant) ?? asNumber(condition.second_constant);
  return constant !== undefined ? toInt32(constant) : 0;
}

function conditionUsesEach(condition: Record<string, unknown>): boolean {
  return (
    signalName(condition.first_signal) === SIGNAL_EACH ||
    signalName(condition.second_signal) === SIGNAL_EACH
  );
}

function conditionsUseEach(conditions: unknown[]): boolean {
  for (const raw of conditions) {
    if (raw !== null && typeof raw === "object" && conditionUsesEach(raw as Record<string, unknown>)) {
      return true;
    }
  }
  return false;
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

/**
 * Arithmetic with optional EACH:
 * - ONE operand may be `signal-each` → apply op per present signal
 * - Output `signal-each` → map results per signal; otherwise sum onto the output signal
 */
export function evalArithmetic(entity: CircuitEntity, net: SignalBag): SignalBag {
  const out = emptyBag();
  const conditions = entity.control_behavior.arithmetic_conditions;
  if (conditions === null || typeof conditions !== "object") {
    return out;
  }
  const c = conditions as Record<string, unknown>;
  const op = typeof c.operation === "string" ? c.operation : "+";
  const firstName = signalName(c.first_signal);
  const secondName = signalName(c.second_signal);
  const output = signalName(c.output_signal) ?? entity.outputSignal;
  const eachOnFirst = firstName === SIGNAL_EACH;
  const eachOnSecond = secondName === SIGNAL_EACH;

  if (eachOnFirst || eachOnSecond) {
    if (eachOnFirst && eachOnSecond) {
      throw new Error("simulate: arithmetic cannot use signal-each on both operands");
    }
    let sum = 0;
    for (const name of presentSignals(net)) {
      const eachVal = bagGet(net, name);
      const left = eachOnFirst ? eachVal : readOperand(net, "first_signal", "first_constant", c);
      const right = eachOnSecond ? eachVal : readOperand(net, "second_signal", "second_constant", c);
      const result = evalArithOp(op, left, right);
      if (output === SIGNAL_EACH) {
        bagSet(out, name, result);
      } else {
        sum = toInt32(sum + result);
      }
    }
    if (output !== SIGNAL_EACH) {
      bagSet(out, output, sum);
    }
    return out;
  }

  const left = readOperand(net, "first_signal", "first_constant", c);
  const right = readOperand(net, "second_signal", "second_constant", c);
  bagSet(out, output, evalArithOp(op, left, right));
  return out;
}

function evalOneCondition(
  net: SignalBag,
  condition: Record<string, unknown>,
  eachValue?: number,
  eachName?: string,
): boolean {
  const comparator = typeof condition.comparator === "string" ? condition.comparator : "=";
  const firstName = signalName(condition.first_signal);
  const secondName = signalName(condition.second_signal);

  // Everything / Anything on the first operand (no EACH mode).
  if (eachValue === undefined && (firstName === SIGNAL_EVERYTHING || firstName === SIGNAL_ANYTHING)) {
    const signals = presentSignals(net);
    if (firstName === SIGNAL_EVERYTHING) {
      // Vacuous truth when no signals.
      if (signals.length === 0) {
        return true;
      }
      for (const name of signals) {
        const left = bagGet(net, name);
        const right = readConditionOperand(net, condition, "second");
        if (!compare(comparator, left, right)) {
          return false;
        }
      }
      return true;
    }
    // Anything: true if some present signal satisfies (false if none).
    for (const name of signals) {
      const left = bagGet(net, name);
      const right = readConditionOperand(net, condition, "second");
      if (compare(comparator, left, right)) {
        return true;
      }
    }
    return false;
  }

  // Everything / Anything as the value under EACH substitution is not used; treat as normal.
  void eachName;
  const left = readConditionOperand(net, condition, "first", eachValue);
  const right = readConditionOperand(net, condition, "second", eachValue);
  return compare(comparator, left, right);
}

/**
 * Factorio 2.x: AND binds tighter than OR.
 * `compare_type` on condition i joins it with the preceding conditions (default `"or"`).
 */
function evalDeciderConditions(
  net: SignalBag,
  conditions: unknown[],
  eachValue?: number,
  eachName?: string,
): boolean {
  let anyOrGroup = false;
  let andAccum = true;
  for (let i = 0; i < conditions.length; i += 1) {
    const raw = conditions[i];
    if (raw === null || typeof raw !== "object") {
      return false;
    }
    const condition = raw as Record<string, unknown>;
    const pass = evalOneCondition(net, condition, eachValue, eachName);
    if (i === 0) {
      andAccum = pass;
      continue;
    }
    const join = condition.compare_type;
    if (join === undefined || join === "or") {
      anyOrGroup = anyOrGroup || andAccum;
      andAccum = pass;
    } else if (join === "and") {
      andAccum = andAccum && pass;
    } else {
      throw new Error(`simulate: unsupported compare_type '${String(join)}'`);
    }
  }
  return anyOrGroup || andAccum;
}

function emitDeciderOutputs(
  outputs: unknown,
  entity: CircuitEntity,
  net: SignalBag,
  out: SignalBag,
  eachName?: string,
): void {
  if (!Array.isArray(outputs)) {
    return;
  }
  for (const raw of outputs) {
    if (raw === null || typeof raw !== "object") {
      continue;
    }
    const output = raw as Record<string, unknown>;
    const outName = signalName(output.signal) ?? entity.outputSignal;
    const copy = output.copy_count_from_input === true;
    const constant = asNumber(output.constant) ?? 1;

    if (outName === SIGNAL_EACH) {
      if (eachName === undefined) {
        continue;
      }
      const value = copy ? bagGet(net, eachName) : constant;
      bagSet(out, eachName, bagGet(out, eachName) + value);
      continue;
    }

    if (outName === SIGNAL_EVERYTHING) {
      // Emit every present signal (copy count or constant).
      for (const name of presentSignals(net)) {
        const value = copy ? bagGet(net, name) : constant;
        bagSet(out, name, bagGet(out, name) + value);
      }
      continue;
    }

    if (outName === SIGNAL_ANYTHING) {
      const signals = presentSignals(net);
      const pick = eachName ?? signals[0];
      if (pick === undefined) {
        continue;
      }
      const value = copy ? bagGet(net, pick) : constant;
      bagSet(out, pick, bagGet(out, pick) + value);
      continue;
    }

    // Specific signal. With EACH mode, copy uses the each signal's count when copying.
    if (copy) {
      const value = eachName !== undefined ? bagGet(net, eachName) : bagGet(net, outName);
      bagSet(out, outName, bagGet(out, outName) + value);
    } else {
      bagSet(out, outName, bagGet(out, outName) + constant);
    }
  }
}

/** Evaluate a decider combinator against its input network (incl. EACH / ANY / EVERYTHING). */
export function evalDecider(entity: CircuitEntity, net: SignalBag): SignalBag {
  const out = emptyBag();
  const root = entity.control_behavior.decider_conditions;
  if (root === null || typeof root !== "object") {
    return out;
  }
  const block = root as { conditions?: unknown; outputs?: unknown; else_outputs?: unknown };
  const conditions = Array.isArray(block.conditions) ? block.conditions : [];

  if (conditionsUseEach(conditions)) {
    // Per-signal evaluation: each present signal activates normal or else outputs.
    for (const name of presentSignals(net)) {
      const value = bagGet(net, name);
      const ok = evalDeciderConditions(net, conditions, value, name);
      emitDeciderOutputs(ok ? block.outputs : block.else_outputs, entity, net, out, name);
    }
    return out;
  }

  const ok = evalDeciderConditions(net, conditions);
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
