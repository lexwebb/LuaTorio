import type { Blueprint, Comparator, Entity } from "@jensforstmann/factorio-blueprint-tools";
import {
  COMPARATOR,
  createEmptyBlueprint,
  encodePlan,
} from "@jensforstmann/factorio-blueprint-tools";
import type { LaidOutCircuit, PlacedEntity } from "./layout.js";

export interface EmitOptions {
  /** Sets the blueprint's `label` (shown in-game and in the blueprint library). */
  name?: string;
  /** When true, `blueprint` holds the JSON-stringified plan object instead of an encoded blueprint string. */
  json?: boolean;
}

export interface EmitResult {
  blueprint: string;
  stats: {
    combinators: number;
    wires: number;
  };
}

/**
 * `combinators.ts` builds `decider_conditions.conditions[].comparator` using plain ASCII
 * operator strings (see `COMPARATOR` in combinators.ts); the blueprint-tools library's
 * `Comparator` type instead expects Factorio's actual blueprint-string symbols (`≥`, `≤`,
 * `≠`) for the three non-ASCII cases. This maps our internal strings to the library's.
 */
const LIBRARY_COMPARATOR: Record<string, Comparator> = {
  ">": COMPARATOR.greaterThan,
  "<": COMPARATOR.lessThan,
  "=": COMPARATOR.equal,
  ">=": COMPARATOR.greaterThanEqual,
  "<=": COMPARATOR.lessThanEqual,
  "!=": COMPARATOR.notEqual,
};

interface DeciderCondition {
  comparator?: unknown;
  [key: string]: unknown;
}

interface DeciderConditions {
  conditions: DeciderCondition[];
  outputs: unknown[];
  [key: string]: unknown;
}

/** Rewrites a `decider_conditions` block's condition comparators into library-shaped symbols. */
function toLibraryDeciderConditions(deciderConditions: DeciderConditions): DeciderConditions {
  return {
    ...deciderConditions,
    conditions: deciderConditions.conditions.map((condition) => {
      const { comparator } = condition;
      if (typeof comparator !== "string" || !(comparator in LIBRARY_COMPARATOR)) {
        return condition;
      }
      return { ...condition, comparator: LIBRARY_COMPARATOR[comparator] };
    }),
  };
}

/**
 * Converts a `CircuitEntity.control_behavior` (built by `combinators.ts` against our own
 * best-effort shapes) into the library's `Entity["control_behavior"]` shape. Only
 * `decider_conditions` needs rewriting (comparator symbols); `sections` and
 * `arithmetic_conditions` are already structurally compatible.
 */
function toLibraryControlBehavior(
  controlBehavior: Record<string, unknown>,
): NonNullable<Entity["control_behavior"]> {
  const deciderConditions = controlBehavior.decider_conditions;
  if (deciderConditions === undefined) {
    return controlBehavior as NonNullable<Entity["control_behavior"]>;
  }
  return {
    ...controlBehavior,
    decider_conditions: toLibraryDeciderConditions(deciderConditions as DeciderConditions),
  } as NonNullable<Entity["control_behavior"]>;
}

function toLibraryEntity(placed: PlacedEntity): Entity {
  return {
    entity_number: placed.entity_number,
    name: placed.name,
    position: placed.position,
    control_behavior: toLibraryControlBehavior(placed.control_behavior),
  };
}

/** Builds a Factorio `Blueprint` plan object from a `LaidOutCircuit` (no encoding yet). */
function buildPlan(laidOut: LaidOutCircuit, name: string | undefined): Blueprint {
  const plan = createEmptyBlueprint();
  plan.blueprint.entities = laidOut.entities.map(toLibraryEntity);
  plan.blueprint.wires = laidOut.wires;
  if (name !== undefined) {
    plan.blueprint.label = name;
  }
  return plan;
}

/**
 * Emits a `LaidOutCircuit` (#9) as a Factorio blueprint string (or, with `options.json`, the
 * plan object serialized as JSON instead of the deflate+base64-encoded string format).
 */
export function emitBlueprint(laidOut: LaidOutCircuit, options?: EmitOptions): EmitResult {
  const plan = buildPlan(laidOut, options?.name);
  return {
    blueprint: options?.json ? JSON.stringify(plan) : encodePlan(plan),
    stats: {
      combinators: laidOut.entities.length,
      wires: laidOut.wires.length,
    },
  };
}
