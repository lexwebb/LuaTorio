import type { LaidOutCircuit, PlacedEntity } from "@luatorio/core";
import { useMemo } from "react";

export interface CircuitCanvasProps {
  laidOut: LaidOutCircuit;
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  /** Live output bag for the selected entity at the scrubbed tick. */
  selectedBag?: Record<string, number>;
  /** Entity ids that changed output this tick (optional highlight). */
  activeIds?: ReadonlySet<string>;
}

const TILE = 56;
const PAD = 48;

function iconSrc(entity: PlacedEntity): string {
  const base = `${import.meta.env.BASE_URL}factorio-icons/`;
  switch (entity.kind) {
    case "constant":
      return `${base}constant-combinator.png`;
    case "arithmetic":
      return `${base}arithmetic-combinator.png`;
    case "decider":
      return `${base}decider-combinator.png`;
    case "selector":
      return `${base}selector-combinator.png`;
    default:
      return `${base}constant-combinator.png`;
  }
}

function signalName(ref: unknown): string | undefined {
  if (ref === null || typeof ref !== "object") {
    return undefined;
  }
  const name = (ref as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

/** Human-readable lines for the inspector (config, not runtime). */
export function describeControlBehavior(entity: PlacedEntity): string[] {
  const lines: string[] = [];
  lines.push(`${entity.kind}${entity.role !== undefined ? ` · ${entity.role}` : ""}`);
  lines.push(`id ${entity.id} → drives ${entity.outputSignal}`);

  if (entity.kind === "constant") {
    const sections = (
      entity.control_behavior.sections as { sections?: Array<{ filters?: unknown[] }> } | undefined
    )?.sections;
    const filters = sections?.[0]?.filters ?? [];
    if (filters.length === 0) {
      lines.push("empty constant (I/O placeholder)");
    } else {
      for (const raw of filters) {
        if (raw === null || typeof raw !== "object") {
          continue;
        }
        const filter = raw as { name?: string; count?: number };
        lines.push(`emits ${filter.name ?? "?"} = ${filter.count ?? 0}`);
      }
    }
    return lines;
  }

  if (entity.kind === "arithmetic") {
    const c = entity.control_behavior.arithmetic_conditions as Record<string, unknown> | undefined;
    if (c === undefined) {
      return lines;
    }
    const left = signalName(c.first_signal) ?? String(c.first_constant ?? "?");
    const right = signalName(c.second_signal) ?? String(c.second_constant ?? "?");
    const op = typeof c.operation === "string" ? c.operation : "?";
    const out = signalName(c.output_signal) ?? entity.outputSignal;
    lines.push(`${left} ${op} ${right} → ${out}`);
    return lines;
  }

  if (entity.kind === "decider") {
    const block = entity.control_behavior.decider_conditions as
      | { conditions?: unknown[]; outputs?: unknown[]; else_outputs?: unknown[] }
      | undefined;
    const conditions = Array.isArray(block?.conditions) ? block.conditions : [];
    for (let i = 0; i < conditions.length; i += 1) {
      const raw = conditions[i];
      if (raw === null || typeof raw !== "object") {
        continue;
      }
      const cond = raw as Record<string, unknown>;
      const join = i === 0 ? "" : ` ${String(cond.compare_type ?? "or")} `;
      const left = signalName(cond.first_signal) ?? "?";
      const cmp = typeof cond.comparator === "string" ? cond.comparator : "=";
      const right =
        signalName(cond.second_signal) ??
        (cond.constant !== undefined ? String(cond.constant) : "?");
      lines.push(`${join}${left} ${cmp} ${right}`.trim());
    }
    const outs = Array.isArray(block?.outputs) ? block.outputs : [];
    for (const raw of outs) {
      if (raw === null || typeof raw !== "object") {
        continue;
      }
      const out = raw as Record<string, unknown>;
      const name = signalName(out.signal) ?? "?";
      if (out.copy_count_from_input === true) {
        lines.push(`then: copy ${name}`);
      } else {
        lines.push(`then: ${name} = ${String(out.constant ?? 1)}`);
      }
    }
    const elses = Array.isArray(block?.else_outputs) ? block.else_outputs : [];
    for (const raw of elses) {
      if (raw === null || typeof raw !== "object") {
        continue;
      }
      const out = raw as Record<string, unknown>;
      const name = signalName(out.signal) ?? "?";
      lines.push(`else: ${name} = ${String(out.constant ?? 1)}`);
    }
    return lines;
  }

  if (entity.kind === "selector") {
    const op = entity.control_behavior.operation;
    lines.push(`selector operation: ${String(op ?? "?")}`);
    return lines;
  }

  return lines;
}

function wirePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  index: number,
  self: boolean,
): string {
  if (self) {
    const r = 14 + (index % 3) * 4;
    return `M ${x1} ${y1} C ${x1 + r} ${y1 - r}, ${x1 + r} ${y1 + r}, ${x1} ${y1}`;
  }
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  // Fan overlapping wires apart with a perpendicular bulge.
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const bulge = ((index % 7) - 3) * 10;
  const cx = mx - (dy / len) * bulge;
  const cy = my + (dx / len) * bulge;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

/**
 * SVG mockup of the laid-out circuit with curved wires and a config inspector.
 */
export function CircuitCanvas({
  laidOut,
  selectedId,
  onSelect,
  selectedBag,
  activeIds,
}: CircuitCanvasProps) {
  const { width, height, byNumber } = useMemo(() => {
    let maxX = 0;
    let maxY = 0;
    const map = new Map<number, PlacedEntity>();
    for (const entity of laidOut.entities) {
      map.set(entity.entity_number, entity);
      maxX = Math.max(maxX, entity.position.x);
      maxY = Math.max(maxY, entity.position.y);
    }
    return {
      width: PAD * 2 + (maxX + 1) * TILE + 8,
      height: PAD * 2 + (maxY + 1) * TILE + 40,
      byNumber: map,
    };
  }, [laidOut]);

  const selected = laidOut.entities.find((entity) => entity.id === selectedId);
  const configLines = selected !== undefined ? describeControlBehavior(selected) : [];

  return (
    <div className="circuit-canvas-wrap">
      <svg
        className="circuit-canvas"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Laid-out circuit network"
      >
        <title>Circuit layout (layered)</title>
        {laidOut.wires.map((wire, index) => {
          const [a, ca, b, cb] = wire;
          const from = byNumber.get(a);
          const to = byNumber.get(b);
          if (from === undefined || to === undefined) {
            return null;
          }
          const isRed = ca === 1 || ca === 3;
          const x1 = PAD + from.position.x * TILE + TILE / 2;
          const y1 = PAD + from.position.y * TILE + TILE / 2;
          const x2 = PAD + to.position.x * TILE + TILE / 2;
          const y2 = PAD + to.position.y * TILE + TILE / 2;
          return (
            <path
              key={`${a}:${ca}-${b}:${cb}-${index}`}
              d={wirePath(x1, y1, x2, y2, index, a === b)}
              className={
                isRed ? "circuit-wire circuit-wire-red" : "circuit-wire circuit-wire-green"
              }
              fill="none"
            />
          );
        })}
        {laidOut.entities.map((entity) => {
          const x = PAD + entity.position.x * TILE;
          const y = PAD + entity.position.y * TILE;
          const active = entity.id === selectedId;
          const pulsing = activeIds?.has(entity.id) === true;
          return (
            <g key={entity.id}>
              <foreignObject x={x} y={y} width={TILE} height={TILE}>
                <button
                  type="button"
                  className={`circuit-entity-button${active ? " is-selected" : ""}${
                    pulsing ? " is-active-tick" : ""
                  }`}
                  onClick={() => onSelect(entity.id)}
                  title={entity.id}
                >
                  <img src={iconSrc(entity)} alt="" width={TILE - 18} height={TILE - 18} />
                </button>
              </foreignObject>
              <text
                x={x + TILE / 2}
                y={y + TILE + 10}
                textAnchor="middle"
                className="circuit-entity-label"
              >
                {entity.role ?? entity.kind}
              </text>
              <text
                x={x + TILE / 2}
                y={y + TILE + 20}
                textAnchor="middle"
                className="circuit-entity-label circuit-entity-id"
              >
                {entity.outputSignal}
              </text>
            </g>
          );
        })}
      </svg>

      {selected !== undefined ? (
        <div className="circuit-inspector">
          <div className="circuit-inspector-head">
            <strong>{selected.id}</strong>
            <span className="circuit-selection-signal">{selected.outputSignal}</span>
          </div>
          <ul className="circuit-inspector-config">
            {configLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {selectedBag !== undefined ? (
            <div className="circuit-inspector-bag">
              <span className="circuit-inspector-bag-label">Outputs this tick</span>
              {Object.keys(selectedBag).length === 0 ? (
                <span className="sim-muted">none</span>
              ) : (
                <ul>
                  {Object.entries(selectedBag).map(([name, count]) => (
                    <li key={name}>
                      {name} = {count}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="sim-muted">Click a combinator to inspect its settings and live outputs.</p>
      )}
    </div>
  );
}
