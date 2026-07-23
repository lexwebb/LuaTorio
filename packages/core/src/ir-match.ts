/**
 * Pure IR shape matchers shared by emit absorption and specialization (#54).
 *
 * Keep this module free of combinator/entity construction — only bind IR ids and
 * literals so the absorb pre-pass and emit dispatch cannot drift.
 */
import type { IRNode } from "./ir.js";

export type SelectNode = Extract<IRNode, { kind: "select" }>;
export type CmpNode = Extract<IRNode, { kind: "cmp" }>;
export type MemoryNode = Extract<IRNode, { kind: "memory" }>;
export type SrNode = Extract<IRNode, { kind: "sr" }>;

export function literalValueOf(node: IRNode | undefined): number | undefined {
  return node?.kind === "literal" ? node.value : undefined;
}

/** Nodes known to carry only 0 or 1 (cmp results / 0-1 literals). */
export function isBooleanValued(node: IRNode | undefined): boolean {
  if (node === undefined) {
    return false;
  }
  if (node.kind === "cmp") {
    return true;
  }
  if (node.kind === "literal") {
    return node.value === 0 || node.value === 1;
  }
  return false;
}

export function useAtMost(useCount: ReadonlyMap<string, number>, id: string, max: number): boolean {
  return (useCount.get(id) ?? 0) <= max;
}

/** Sole-use `cmp` usable as an inlined select condition (not shared elsewhere). */
export function soleUseCmp(
  condId: string,
  nodeById: ReadonlyMap<string, IRNode>,
  useCount: ReadonlyMap<string, number>,
): CmpNode | undefined {
  if (!useAtMost(useCount, condId, 1)) {
    return undefined;
  }
  const cond = nodeById.get(condId);
  return cond?.kind === "cmp" ? cond : undefined;
}

/**
 * Cmp that select emit will inline (sole-use; not unused; not inverted truth-and).
 * Absorption of cmp entities must use this same predicate.
 */
export function fusedCmpForSelect(
  node: SelectNode,
  nodeById: ReadonlyMap<string, IRNode>,
  useCount: ReadonlyMap<string, number>,
): CmpNode | undefined {
  if (node.then === node.else) {
    return undefined;
  }
  const fused = soleUseCmp(node.cond, nodeById, useCount);
  if (fused === undefined) {
    return undefined;
  }
  // Inverted truth-and still needs a 0/1 cond signal.
  if (literalValueOf(nodeById.get(node.then)) === 0 && isBooleanValued(nodeById.get(node.else))) {
    return undefined;
  }
  return fused;
}

/** `select(a, a, b)` with both arms boolean — Lua `a or b`. */
export function isBooleanOrSelect(
  node: SelectNode,
  nodeById: ReadonlyMap<string, IRNode>,
): boolean {
  return (
    node.cond === node.then &&
    isBooleanValued(nodeById.get(node.then)) &&
    isBooleanValued(nodeById.get(node.else))
  );
}

/**
 * Lua `c and x or y` → nested `select(select(c,x,0), g, y)`.
 * Gate `g` must be used only as this outer's cond+then (useCount === 2).
 */
export function matchAndOrMux(
  node: SelectNode,
  nodeById: ReadonlyMap<string, IRNode>,
  useCount: ReadonlyMap<string, number>,
): { inner: SelectNode; x: string; y: string } | undefined {
  if (node.cond !== node.then) {
    return undefined;
  }
  if ((useCount.get(node.cond) ?? 0) !== 2) {
    return undefined;
  }
  const inner = nodeById.get(node.cond);
  if (inner?.kind !== "select") {
    return undefined;
  }
  if (literalValueOf(nodeById.get(inner.else)) !== 0) {
    return undefined;
  }
  return { inner, x: inner.then, y: node.else };
}

/** If `exprId` is `memoryId + δ` (either operand order), return δ. */
export function memPlusDelta(
  exprId: string,
  memoryId: string,
  nodeById: ReadonlyMap<string, IRNode>,
): string | undefined {
  const expr = nodeById.get(exprId);
  if (expr?.kind !== "binop" || expr.op !== "+") {
    return undefined;
  }
  if (expr.left === memoryId) {
    return expr.right;
  }
  if (expr.right === memoryId) {
    return expr.left;
  }
  return undefined;
}

/** If `expr` is `memory ± lit`, return the signed delta. */
export function memDeltaLiteral(
  exprId: string,
  memoryId: string,
  nodeById: ReadonlyMap<string, IRNode>,
): number | undefined {
  const expr = nodeById.get(exprId);
  if (expr?.kind !== "binop") {
    return undefined;
  }
  if (expr.op === "+") {
    const deltaId = memPlusDelta(exprId, memoryId, nodeById);
    return deltaId !== undefined ? literalValueOf(nodeById.get(deltaId)) : undefined;
  }
  if (expr.op === "-" && expr.left === memoryId) {
    const lit = literalValueOf(nodeById.get(expr.right));
    return lit !== undefined ? -lit : undefined;
  }
  return undefined;
}

/**
 * `select(mem, bool, 0)` — sticky-clear / SR-shaped hold (cookbook Q' = Q ∧ cond).
 * Caller still decides sole-use vs shared-enable from the user graph.
 */
export function isStickyClearSelect(
  select: SelectNode,
  memoryId: string,
  nodeById: ReadonlyMap<string, IRNode>,
): boolean {
  return (
    select.cond === memoryId &&
    literalValueOf(nodeById.get(select.else)) === 0 &&
    isBooleanValued(nodeById.get(select.then))
  );
}

/** `select(en, next, mem)` enable/hold store value. */
export function matchEnableHold(
  select: SelectNode,
  memoryId: string,
): { select: SelectNode; nextId: string } | undefined {
  if (select.else !== memoryId) {
    return undefined;
  }
  return { select, nextId: select.then };
}

/**
 * Structural classification of a memory cell's store value (no user-graph filters).
 * Sticky shared-enable / fused-run-clock need additional passes in the emitter.
 */
export type MemoryStoreMatch =
  | { kind: "free-delta"; deltaId: string; binopId: string }
  | { kind: "sr"; sr: SrNode }
  | {
      kind: "enable-hold";
      select: SelectNode;
      /** Present when `next = mem + δ` (δ may be non-literal). */
      deltaId?: string;
    }
  | { kind: "sticky-clear"; select: SelectNode }
  | {
      kind: "delta-choose";
      select: SelectNode;
      thenDelta: number;
      elseDelta: number;
    }
  | { kind: "plain"; valueId: string };

export function matchMemoryStore(
  memory: MemoryNode,
  storeValueId: string,
  nodeById: ReadonlyMap<string, IRNode>,
  useCount: ReadonlyMap<string, number>,
): MemoryStoreMatch {
  const storeValue = nodeById.get(storeValueId);
  if (storeValue === undefined) {
    return { kind: "plain", valueId: storeValueId };
  }

  if (storeValue.kind === "binop") {
    const deltaId = memPlusDelta(storeValue.id, memory.id, nodeById);
    if (deltaId !== undefined && useAtMost(useCount, storeValue.id, 1)) {
      return { kind: "free-delta", deltaId, binopId: storeValue.id };
    }
    return { kind: "plain", valueId: storeValueId };
  }

  if (storeValue.kind === "sr" && storeValue.state === memory.id) {
    if (useAtMost(useCount, storeValue.id, 1)) {
      return { kind: "sr", sr: storeValue };
    }
    return { kind: "plain", valueId: storeValueId };
  }

  if (storeValue.kind !== "select") {
    return { kind: "plain", valueId: storeValueId };
  }

  const enableHold = matchEnableHold(storeValue, memory.id);
  if (enableHold !== undefined) {
    const deltaId = memPlusDelta(enableHold.nextId, memory.id, nodeById);
    return deltaId !== undefined
      ? { kind: "enable-hold", select: storeValue, deltaId }
      : { kind: "enable-hold", select: storeValue };
  }

  if (isStickyClearSelect(storeValue, memory.id, nodeById)) {
    return { kind: "sticky-clear", select: storeValue };
  }

  const thenDelta = memDeltaLiteral(storeValue.then, memory.id, nodeById);
  const elseDelta = memDeltaLiteral(storeValue.else, memory.id, nodeById);
  if (
    thenDelta !== undefined &&
    elseDelta !== undefined &&
    useAtMost(useCount, storeValue.id, 1) &&
    useAtMost(useCount, storeValue.then, 1) &&
    useAtMost(useCount, storeValue.else, 1)
  ) {
    return { kind: "delta-choose", select: storeValue, thenDelta, elseDelta };
  }

  return { kind: "plain", valueId: storeValueId };
}
