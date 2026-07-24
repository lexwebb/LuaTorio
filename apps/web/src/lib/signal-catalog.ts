/** Curated Factorio signal / place-entity names for playground string completions. */

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";

/** Virtual letter/digit signals plus specials used in examples. */
export const SIGNAL_NAMES: readonly string[] = [
  ...[...LETTERS].map((ch) => `signal-${ch}`),
  ...[...DIGITS].map((ch) => `signal-${ch}`),
  "signal-S",
  "signal-R",
  "signal-Q",
  "signal-L",
  "signal-N",
  "signal-P",
  "signal-X",
  "level-A",
  "level-B",
  "priority-1",
  "priority-2",
  "priority-3",
  "iron-plate",
];

/** Deduped signal catalog (specials may overlap letter list). */
export const SIGNAL_CATALOG: readonly string[] = [...new Set(SIGNAL_NAMES)].sort((a, b) =>
  a.localeCompare(b),
);

/** Matches packages/core PlaceableEntity allowlist. */
export const PLACE_ENTITIES: readonly string[] = [
  "wooden-chest",
  "iron-chest",
  "steel-chest",
  "small-lamp",
  "small-electric-pole",
  "medium-electric-pole",
  "big-electric-pole",
  "substation",
  "logistic-chest-passive-provider",
  "logistic-chest-active-provider",
  "logistic-chest-storage",
  "logistic-chest-buffer",
  "logistic-chest-requester",
  "assembling-machine-1",
  "assembling-machine-2",
  "assembling-machine-3",
  "foundry",
  "roboport",
] as const;
