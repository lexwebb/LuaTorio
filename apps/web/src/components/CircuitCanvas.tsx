import type { LaidOutCircuit, PlacedEntity } from "@luatorio/core";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CombinatorInspector } from "./CombinatorInspector.js";

export interface CircuitCanvasProps {
  laidOut: LaidOutCircuit;
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  /** Per-entity output bags at the scrubbed tick. */
  entityBags?: Record<string, Record<string, number>>;
  /** Entity ids that changed output this tick (optional highlight). */
  activeIds?: ReadonlySet<string>;
}

const TILE = 64;
const PAD = 56;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3.5;
const DRAG_THRESHOLD_PX = 4;

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

function wirePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  index: number,
  self: boolean,
): string {
  if (self) {
    const r = 18 + (index % 3) * 5;
    return `M ${x1} ${y1} C ${x1 + r} ${y1 - r}, ${x1 + r} ${y1 + r}, ${x1} ${y1}`;
  }
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const bulge = ((index % 7) - 3) * 12;
  const cx = mx - (dy / len) * bulge;
  const cy = my + (dx / len) * bulge;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

interface ViewState {
  x: number;
  y: number;
  scale: number;
}

function entityScreenBox(entity: PlacedEntity): { x: number; y: number; w: number; h: number } {
  return {
    x: PAD + entity.position.x * TILE,
    y: PAD + entity.position.y * TILE,
    w: TILE,
    h: TILE,
  };
}

/**
 * Pan/zoom SVG circuit canvas with Factorio-style combinator inspector.
 * Selection uses world-coordinate hit tests (not foreignObject HTML), so CSS scale stays clickable.
 */
export function CircuitCanvas({
  laidOut,
  selectedId,
  onSelect,
  entityBags,
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
      height: PAD * 2 + (maxY + 1) * TILE + 48,
      byNumber: map,
    };
  }, [laidOut]);

  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ViewState>({ x: 0, y: 0, scale: 1 });
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
    captured: boolean;
  } | null>(null);

  const updateView = useCallback((next: ViewState | ((prev: ViewState) => ViewState)) => {
    setView((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      viewRef.current = resolved;
      return resolved;
    });
  }, []);

  const clientToWorld = useCallback((clientX: number, clientY: number) => {
    const el = stageRef.current;
    const v = viewRef.current;
    if (el === null) {
      return { x: 0, y: 0 };
    }
    const rect = el.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    return {
      x: (mx - v.x) / v.scale,
      y: (my - v.y) / v.scale,
    };
  }, []);

  const hitEntityId = useCallback(
    (worldX: number, worldY: number): string | undefined => {
      for (let i = laidOut.entities.length - 1; i >= 0; i -= 1) {
        const entity = laidOut.entities[i];
        if (entity === undefined) {
          continue;
        }
        const box = entityScreenBox(entity);
        if (
          worldX >= box.x &&
          worldX <= box.x + box.w &&
          worldY >= box.y &&
          worldY <= box.y + box.h
        ) {
          return entity.id;
        }
      }
      return undefined;
    },
    [laidOut.entities],
  );

  const fitView = useCallback(() => {
    const el = stageRef.current;
    if (el === null) {
      return;
    }
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    if (vw <= 0 || vh <= 0) {
      return;
    }
    const pad = 24;
    const scale = Math.min(
      1.25,
      Math.max(MIN_SCALE, Math.min((vw - pad) / width, (vh - pad) / height)),
    );
    updateView({
      scale,
      x: (vw - width * scale) / 2,
      y: (vh - height * scale) / 2,
    });
  }, [width, height, updateView]);

  useEffect(() => {
    fitView();
  }, [fitView]);

  useEffect(() => {
    const el = stageRef.current;
    if (el === null) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      updateView((prev) => {
        const zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * zoomFactor));
        const worldX = (mx - prev.x) / prev.scale;
        const worldY = (my - prev.y) / prev.scale;
        return {
          scale: nextScale,
          x: mx - worldX * nextScale,
          y: my - worldY * nextScale,
        };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [updateView]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewRef.current.x,
      originY: viewRef.current.y,
      moved: false,
      captured: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      drag.moved = true;
      if (!drag.captured) {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.captured = true;
      }
    }
    if (drag.moved) {
      updateView((prev) => ({ ...prev, x: drag.originX + dx, y: drag.originY + dy }));
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    if (drag.captured) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.moved) {
      return;
    }
    const world = clientToWorld(event.clientX, event.clientY);
    onSelect(hitEntityId(world.x, world.y));
  };

  const zoomBy = (factor: number) => {
    const el = stageRef.current;
    if (el === null) {
      return;
    }
    const mx = el.clientWidth / 2;
    const my = el.clientHeight / 2;
    updateView((prev) => {
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor));
      const worldX = (mx - prev.x) / prev.scale;
      const worldY = (my - prev.y) / prev.scale;
      return {
        scale: nextScale,
        x: mx - worldX * nextScale,
        y: my - worldY * nextScale,
      };
    });
  };

  const selected = laidOut.entities.find((entity) => entity.id === selectedId);

  return (
    <div className="circuit-canvas-wrap">
      <div className="circuit-viewport-chrome">
        <div className="circuit-zoom-controls">
          <button
            type="button"
            className="toolbar-button"
            onClick={() => zoomBy(1 / 1.25)}
            title="Zoom out"
          >
            −
          </button>
          <button type="button" className="toolbar-button" onClick={fitView} title="Fit to view">
            {Math.round(view.scale * 100)}%
          </button>
          <button
            type="button"
            className="toolbar-button"
            onClick={() => zoomBy(1.25)}
            title="Zoom in"
          >
            +
          </button>
        </div>
        <span className="sim-muted circuit-viewport-hint">
          Scroll to zoom · drag to pan · click combinator
        </span>
      </div>

      <div
        ref={stageRef}
        className="circuit-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="circuit-viewport-world"
          style={{
            width,
            height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          <svg
            className="circuit-canvas"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Laid-out circuit network"
          >
            <title>Circuit layout (layered)</title>
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
              const wireKey = `${a}:${ca}-${b}:${cb}`;
              return (
                <path
                  key={wireKey}
                  d={wirePath(x1, y1, x2, y2, a + b + ca + cb, a === b)}
                  className={
                    isRed ? "circuit-wire circuit-wire-red" : "circuit-wire circuit-wire-green"
                  }
                  fill="none"
                  pointerEvents="none"
                />
              );
            })}
            {laidOut.entities.map((entity) => {
              const box = entityScreenBox(entity);
              const active = entity.id === selectedId;
              const pulsing = activeIds?.has(entity.id) === true;
              const inset = 10;
              return (
                <g key={entity.id} className="circuit-entity">
                  <rect
                    x={box.x}
                    y={box.y}
                    width={box.w}
                    height={box.h}
                    rx={4}
                    className={`circuit-entity-hit${active ? " is-selected" : ""}${
                      pulsing ? " is-active-tick" : ""
                    }`}
                  />
                  <image
                    href={iconSrc(entity)}
                    x={box.x + inset}
                    y={box.y + inset}
                    width={box.w - inset * 2}
                    height={box.h - inset * 2}
                    style={{ imageRendering: "pixelated" }}
                    pointerEvents="none"
                  />
                  <title>{`${entity.id} (${entity.role ?? entity.kind})`}</title>
                  <text
                    x={box.x + box.w / 2}
                    y={box.y + box.h + 12}
                    textAnchor="middle"
                    className="circuit-entity-label"
                    pointerEvents="none"
                  >
                    {entity.role ?? entity.kind}
                  </text>
                  <text
                    x={box.x + box.w / 2}
                    y={box.y + box.h + 24}
                    textAnchor="middle"
                    className="circuit-entity-label circuit-entity-id"
                    pointerEvents="none"
                  >
                    {entity.outputSignal}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {selected !== undefined ? (
        <CombinatorInspector
          entity={selected}
          laidOut={laidOut}
          entityBags={entityBags}
          onClose={() => onSelect(undefined)}
        />
      ) : (
        <p className="sim-muted">Click a combinator to open its Factorio-style detail panel.</p>
      )}
    </div>
  );
}
