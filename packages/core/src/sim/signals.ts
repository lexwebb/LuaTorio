/** Sparse signal → count bag. Absent signals are treated as 0. */
export type SignalBag = Map<string, number>;

/** Factorio arithmetic uses signed 32-bit ints; prefer `|0` / trunc over BigInt. */
export function toInt32(n: number): number {
  return n | 0;
}

export function emptyBag(): SignalBag {
  return new Map();
}

export function bagGet(bag: SignalBag, name: string): number {
  return bag.get(name) ?? 0;
}

export function bagSet(bag: SignalBag, name: string, count: number): void {
  const v = toInt32(count);
  if (v === 0) {
    bag.delete(name);
  } else {
    bag.set(name, v);
  }
}

/** Mutating add: `into[name] += delta` (int32). */
export function bagAdd(into: SignalBag, name: string, delta: number): void {
  bagSet(into, name, bagGet(into, name) + toInt32(delta));
}

/** Sum `from` into `into`. */
export function bagMerge(into: SignalBag, from: SignalBag): void {
  for (const [name, count] of from) {
    bagAdd(into, name, count);
  }
}

export function bagClone(bag: SignalBag): SignalBag {
  return new Map(bag);
}

/** Convert a bag to a plain object (for test traces / JSON). Zeroes omitted. */
export function bagToRecord(bag: SignalBag): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, count] of bag) {
    if (count !== 0) {
      out[name] = count;
    }
  }
  return out;
}
