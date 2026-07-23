import type { Blueprint, Comparator, Entity } from "@jensforstmann/factorio-blueprint-tools";
import {
  COMPARATOR,
  createEmptyBlueprint,
  encodePlan,
} from "@jensforstmann/factorio-blueprint-tools";
import type { CircuitEntity } from "./combinators.js";
import type { SpatialPlace } from "./ir.js";
import type { FactorioWire, LaidOutCircuit, PlacedEntity } from "./layout.js";
import { isEmptyConstant } from "./sim/eval.js";

export interface EmitOptions {
  /** Sets the blueprint's `label` (shown in-game and in the blueprint library). */
  name?: string;
  /** When true, `blueprint` holds the JSON-stringified plan object instead of an encoded blueprint string. */
  json?: boolean;
  /** Non-combinator entities with source-authoritative absolute positions. */
  places?: SpatialPlace[];
}

export interface EmitResult {
  blueprint: string;
  stats: {
    combinators: number;
    places: number;
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

/** 2-tile spacing — match `layout.ts` when re-packing after stripping I/O pads. */
const X_SPACING = 2;

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

function toLibraryPlace(place: SpatialPlace, entity_number: number): Entity {
  return {
    entity_number,
    name: place.name,
    position: { x: place.x, y: place.y },
  };
}

function isIoPlaceholder(entity: CircuitEntity, laidOut: LaidOutCircuit): boolean {
  if (!isEmptyConstant(entity)) {
    return false;
  }
  return (
    laidOut.inputs.some((port) => port.entityId === entity.id) ||
    laidOut.outputs.some((port) => port.entityId === entity.id)
  );
}

/**
 * Drop empty I/O pad constants from the blueprint and re-pack entity numbers / positions.
 * Sim keeps the full graph (inject/read still need markers). If every entity is a pad
 * (identity `output(input(...))`), keep them so the blueprint stays placeable.
 */
function withoutIoPlaceholders(laidOut: LaidOutCircuit): LaidOutCircuit {
  const kept = laidOut.entities.filter((entity) => !isIoPlaceholder(entity, laidOut));
  if (kept.length === 0 || kept.length === laidOut.entities.length) {
    return laidOut;
  }

  const oldNumberToNew = new Map(kept.map((entity, index) => [entity.entity_number, index + 1]));
  const entities: PlacedEntity[] = kept.map((entity, index) => ({
    ...entity,
    entity_number: index + 1,
    position: { x: index * X_SPACING, y: 0 },
  }));

  const wires: FactorioWire[] = [];
  for (const wire of laidOut.wires) {
    const from = oldNumberToNew.get(wire[0]);
    const to = oldNumberToNew.get(wire[2]);
    if (from === undefined || to === undefined) {
      continue;
    }
    wires.push([from, wire[1], to, wire[3]]);
  }

  return { entities, wires, inputs: laidOut.inputs, outputs: laidOut.outputs };
}

/** Builds a Factorio `Blueprint` plan object from a `LaidOutCircuit` (no encoding yet). */
function buildPlan(
  laidOut: LaidOutCircuit,
  name: string | undefined,
  places: SpatialPlace[],
): Blueprint {
  const plan = createEmptyBlueprint();
  plan.blueprint.entities = [
    ...laidOut.entities.map(toLibraryEntity),
    ...places.map((place, index) => toLibraryPlace(place, laidOut.entities.length + index + 1)),
  ];
  plan.blueprint.wires = laidOut.wires;
  if (name !== undefined) {
    plan.blueprint.label = name;
  }
  return plan;
}

/**
 * Emits a `LaidOutCircuit` (#9) as a Factorio blueprint string (or, with `options.json`, the
 * plan object serialized as JSON instead of the deflate+base64-encoded string format).
 * Empty I/O placeholder constants are omitted from the blueprint and from `stats`.
 */
export function emitBlueprint(laidOut: LaidOutCircuit, options?: EmitOptions): EmitResult {
  const stripped = withoutIoPlaceholders(laidOut);
  const places = options?.places ?? [];
  const plan = buildPlan(stripped, options?.name, places);
  return {
    blueprint: options?.json ? JSON.stringify(plan) : encodePlan(plan),
    stats: {
      combinators: stripped.entities.length,
      places: places.length,
      wires: stripped.wires.length,
    },
  };
}
