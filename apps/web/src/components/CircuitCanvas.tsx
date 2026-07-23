import type { LaidOutCircuit, PlacedEntity } from "@luatorio/core";
import { useMemo, useState } from "react";

export interface CircuitCanvasProps {
  laidOut: LaidOutCircuit;
}

const TILE = 48;
const PAD = 40;

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

/**
 * SVG mockup of the laid-out circuit: entities at layout positions, wires as colored paths.
 * Icons are vendored Factorio wiki game images (see public/factorio-icons/NOTICE).
 */
export function CircuitCanvas({ laidOut }: CircuitCanvasProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>();

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
      width: PAD * 2 + (maxX + 1) * TILE,
      height: PAD * 2 + (maxY + 1) * TILE + 24,
      byNumber: map,
    };
  }, [laidOut]);

  const selected = laidOut.entities.find((entity) => entity.id === selectedId);

  return (
    <div className="circuit-canvas-wrap">
      <svg
        className="circuit-canvas"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Laid-out circuit network"
      >
        <title>Circuit layout</title>
        {laidOut.wires.map((wire) => {
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
            <line
              key={`${a}:${ca}-${b}:${cb}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={
                isRed ? "circuit-wire circuit-wire-red" : "circuit-wire circuit-wire-green"
              }
            />
          );
        })}
        {laidOut.entities.map((entity) => {
          const x = PAD + entity.position.x * TILE;
          const y = PAD + entity.position.y * TILE;
          const active = entity.id === selectedId;
          return (
            <foreignObject key={entity.id} x={x} y={y} width={TILE} height={TILE}>
              <button
                type="button"
                className={`circuit-entity-button${active ? " is-selected" : ""}`}
                onClick={() => setSelectedId(entity.id)}
                title={`${entity.id} (${entity.kind}${entity.role ? `, ${entity.role}` : ""})`}
              >
                <img src={iconSrc(entity)} alt="" width={TILE - 16} height={TILE - 16} />
              </button>
            </foreignObject>
          );
        })}
      </svg>
      {selected !== undefined ? (
        <div className="circuit-selection">
          <strong>{selected.id}</strong>
          <span>
            {selected.kind}
            {selected.role !== undefined ? ` · ${selected.role}` : ""}
          </span>
          <span className="circuit-selection-signal">{selected.outputSignal}</span>
        </div>
      ) : (
        <p className="sim-muted">Click a combinator to inspect it.</p>
      )}
    </div>
  );
}
