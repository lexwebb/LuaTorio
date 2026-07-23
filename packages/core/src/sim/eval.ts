import type { CircuitEntity } from "../combinators.js";
import { type ColoredInputs, type EvalNet, selectNetworks, toColored } from "./colors.js";
import { bagAdd, bagGet, bagSet, emptyBag, type SignalBag, toInt32 } from "./signals.js";

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
  const fromSignal = signalName(
    side === "first" ? condition.first_signal : condition.second_signal,
  );
  if (fromSignal === SIGNAL_EACH) {
    return eachValue ?? 0;
  }
  if (fromSignal !== undefined) {
    return bagGet(net, fromSignal);
  }
  const constant =
    side === "first"
      ? asNumber(condition.first_constant)
      : (asNumber(condition.constant) ?? asNumber(condition.second_constant));
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
    if (
      raw !== null &&
      typeof raw === "object" &&
      conditionUsesEach(raw as Record<string, unknown>)
    ) {
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
 * - Per-operand `*_signal_networks` select red / green / both (#40)
 */
export function evalArithmetic(entity: CircuitEntity, net: EvalNet): SignalBag {
  const out = emptyBag();
  const conditions = entity.control_behavior.arithmetic_conditions;
  if (conditions === null || typeof conditions !== "object") {
    return out;
  }
  const c = conditions as Record<string, unknown>;
  const inputs = toColored(net);
  const firstNet = selectNetworks(inputs, c.first_signal_networks);
  const secondNet = selectNetworks(inputs, c.second_signal_networks);
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
    const eachNet = eachOnFirst ? firstNet : secondNet;
    let sum = 0;
    for (const name of presentSignals(eachNet)) {
      const eachVal = bagGet(eachNet, name);
      const left = eachOnFirst
        ? eachVal
        : readOperand(firstNet, "first_signal", "first_constant", c);
      const right = eachOnSecond
        ? eachVal
        : readOperand(secondNet, "second_signal", "second_constant", c);
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

  const left = readOperand(firstNet, "first_signal", "first_constant", c);
  const right = readOperand(secondNet, "second_signal", "second_constant", c);
  bagSet(out, output, evalArithOp(op, left, right));
  return out;
}

function evalOneCondition(
  inputs: ColoredInputs,
  condition: Record<string, unknown>,
  eachValue?: number,
  eachName?: string,
): boolean {
  const comparator = typeof condition.comparator === "string" ? condition.comparator : "=";
  const firstNet = selectNetworks(inputs, condition.first_signal_networks);
  const secondNet = selectNetworks(inputs, condition.second_signal_networks);
  const firstName = signalName(condition.first_signal);

  // Everything / Anything on the first operand (only outside EACH mode).
  // Empty net: Everything is vacuously true (Array.every); Anything is false (Array.some).
  if (
    eachValue === undefined &&
    (firstName === SIGNAL_EVERYTHING || firstName === SIGNAL_ANYTHING)
  ) {
    const signals = presentSignals(firstNet);
    const right = readConditionOperand(secondNet, condition, "second");
    const passes = (name: string): boolean => compare(comparator, bagGet(firstNet, name), right);
    return firstName === SIGNAL_EVERYTHING ? signals.every(passes) : signals.some(passes);
  }

  // EACH mode: eachValue is taken from the EACH operand's selected networks.
  const left =
    signalName(condition.first_signal) === SIGNAL_EACH && eachValue !== undefined
      ? eachValue
      : readConditionOperand(firstNet, condition, "first", eachValue);
  const right =
    signalName(condition.second_signal) === SIGNAL_EACH && eachValue !== undefined
      ? eachValue
      : readConditionOperand(secondNet, condition, "second", eachValue);
  void eachName;
  return compare(comparator, left, right);
}

/**
 * Factorio 2.x: AND binds tighter than OR.
 * `compare_type` on condition i joins it with the preceding conditions (default `"or"`).
 */
function evalDeciderConditions(
  inputs: ColoredInputs,
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
    const pass = evalOneCondition(inputs, condition, eachValue, eachName);
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

function emitCount(copy: boolean, constant: number, net: SignalBag, fromName: string): number {
  return copy ? bagGet(net, fromName) : constant;
}

function emitDeciderOutputs(
  outputs: unknown,
  entity: CircuitEntity,
  inputs: ColoredInputs,
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
    const copyNet = selectNetworks(inputs, output.networks);

    if (outName === SIGNAL_EACH) {
      if (eachName === undefined) {
        continue;
      }
      bagAdd(out, eachName, emitCount(copy, constant, copyNet, eachName));
      continue;
    }

    if (outName === SIGNAL_EVERYTHING) {
      for (const name of presentSignals(copyNet)) {
        bagAdd(out, name, emitCount(copy, constant, copyNet, name));
      }
      continue;
    }

    if (outName === SIGNAL_ANYTHING) {
      const pick = eachName ?? presentSignals(copyNet)[0];
      if (pick === undefined) {
        continue;
      }
      bagAdd(out, pick, emitCount(copy, constant, copyNet, pick));
      continue;
    }

    // Specific signal: in EACH mode, copy uses that signal's count.
    const value = copy ? bagGet(copyNet, eachName !== undefined ? eachName : outName) : constant;
    bagAdd(out, outName, value);
  }
}

/** Union of signals present on either color (for EACH iteration when mixed networks). */
function eachPresentUnion(inputs: ColoredInputs, conditions: unknown[]): SignalBag {
  // Prefer the first EACH operand's networks if we can find one; else both.
  for (const raw of conditions) {
    if (raw === null || typeof raw !== "object") {
      continue;
    }
    const condition = raw as Record<string, unknown>;
    if (signalName(condition.first_signal) === SIGNAL_EACH) {
      return selectNetworks(inputs, condition.first_signal_networks);
    }
    if (signalName(condition.second_signal) === SIGNAL_EACH) {
      return selectNetworks(inputs, condition.second_signal_networks);
    }
  }
  return selectNetworks(inputs, undefined);
}

/** Evaluate a decider combinator against its input network (incl. EACH / ANY / EVERYTHING). */
export function evalDecider(entity: CircuitEntity, net: EvalNet): SignalBag {
  const out = emptyBag();
  const root = entity.control_behavior.decider_conditions;
  if (root === null || typeof root !== "object") {
    return out;
  }
  const block = root as { conditions?: unknown; outputs?: unknown; else_outputs?: unknown };
  const conditions = Array.isArray(block.conditions) ? block.conditions : [];
  const inputs = toColored(net);

  if (conditionsUseEach(conditions)) {
    // Per-signal evaluation: each present signal activates normal or else outputs.
    const eachNet = eachPresentUnion(inputs, conditions);
    for (const name of presentSignals(eachNet)) {
      const ok = evalDeciderConditions(inputs, conditions, bagGet(eachNet, name), name);
      emitDeciderOutputs(ok ? block.outputs : block.else_outputs, entity, inputs, out, name);
    }
    return out;
  }

  const ok = evalDeciderConditions(inputs, conditions);
  emitDeciderOutputs(ok ? block.outputs : block.else_outputs, entity, inputs, out);
  return out;
}

/**
 * Selector `select` mode: sort present signals by value, pick by index.
 * `select_max` true/undefined = descending; a lone candidate always passes (wiki).
 */
function evalSelectorSelect(
  cb: Record<string, unknown>,
  inputs: ColoredInputs,
  bag: SignalBag,
  out: SignalBag,
): void {
  const indexSignal = signalName(cb.index_signal);
  const index =
    indexSignal !== undefined
      ? bagGet(selectNetworks(inputs, cb.index_signal_networks ?? cb.networks), indexSignal)
      : (asNumber(cb.index_constant) ?? 0);
  const selectMax = cb.select_max !== false;
  const candidates = presentSignals(bag).filter(
    (name) => indexSignal === undefined || name !== indexSignal,
  );

  let picked: string | undefined;
  if (candidates.length === 1) {
    picked = candidates[0];
  } else if (candidates.length > 1) {
    candidates.sort((a, b) => {
      const va = bagGet(bag, a);
      const vb = bagGet(bag, b);
      if (va !== vb) {
        return selectMax ? vb - va : va - vb;
      }
      return a.localeCompare(b);
    });
    if (index >= 0 && index < candidates.length) {
      picked = candidates[index];
    }
  }

  if (picked !== undefined) {
    bagSet(out, picked, bagGet(bag, picked));
  }
}

/** Selector combinator: `count` (present → count_signal) or `select` (rank/index pick). */
export function evalSelector(entity: CircuitEntity, net: EvalNet): SignalBag {
  const out = emptyBag();
  const cb = entity.control_behavior as Record<string, unknown>;
  const inputs = toColored(net);
  const bag = selectNetworks(
    inputs,
    cb.networks ?? cb.signal_networks ?? cb.first_signal_networks,
  );
  const operation = typeof cb.operation === "string" ? cb.operation : "select";

  switch (operation) {
    case "count": {
      const countSignal = signalName(cb.count_signal) ?? entity.outputSignal;
      bagSet(out, countSignal, presentSignals(bag).length);
      return out;
    }
    case "select":
      evalSelectorSelect(cb, inputs, bag, out);
      return out;
    default:
      throw new Error(`simulate: unsupported selector operation '${operation}'`);
  }
}

/** Evaluate any non-latch entity given its current input network(s). */
export function evalEntity(entity: CircuitEntity, net: EvalNet): SignalBag {
  switch (entity.kind) {
    case "constant":
      return evalConstant(entity);
    case "arithmetic":
      return evalArithmetic(entity, net);
    case "decider":
      return evalDecider(entity, net);
    case "selector":
      return evalSelector(entity, net);
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
