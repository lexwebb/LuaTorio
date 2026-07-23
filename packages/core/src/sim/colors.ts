import { bagGet, bagSet, emptyBag, type SignalBag, toInt32 } from "./signals.js";

/** Per-color input bags at a combinator (Factorio red ≠ green). */
export interface ColoredInputs {
  red: SignalBag;
  green: SignalBag;
}

/** Flat bag (tests / legacy) or split red/green (#40). */
export type EvalNet = SignalBag | ColoredInputs;

export function isColoredInputs(net: EvalNet): net is ColoredInputs {
  return !(net instanceof Map);
}

/** Flat bag → green only (red empty). Default operand select (both) still sees the full bag. */
export function toColored(net: EvalNet): ColoredInputs {
  if (isColoredInputs(net)) {
    return net;
  }
  return { red: emptyBag(), green: net };
}

/** Sum two bags (int32). */
export function mergeBags(a: SignalBag, b: SignalBag): SignalBag {
  const out = emptyBag();
  for (const [name, count] of a) {
    bagSet(out, name, count);
  }
  for (const [name, count] of b) {
    bagSet(out, name, toInt32(bagGet(out, name) + count));
  }
  return out;
}

/**
 * Resolve `CircuitNetworkSelection` (`{ red?, green? }`, each defaulting to true)
 * into a single bag. Missing / non-object selection ⇒ both colors.
 */
export function selectNetworks(inputs: ColoredInputs, selection: unknown): SignalBag {
  if (selection === null || selection === undefined || typeof selection !== "object") {
    return mergeBags(inputs.red, inputs.green);
  }
  const sel = selection as { red?: unknown; green?: unknown };
  const useRed = sel.red !== false;
  const useGreen = sel.green !== false;
  if (useRed && useGreen) {
    return mergeBags(inputs.red, inputs.green);
  }
  if (useRed) {
    return inputs.red;
  }
  if (useGreen) {
    return inputs.green;
  }
  return emptyBag();
}
