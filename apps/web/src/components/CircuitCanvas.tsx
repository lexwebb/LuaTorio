import {
  type LaidOutCircuit,
  type PlacedEntity,
  type SpatialPlace,
  signalLabelMap,
} from "@luatorio/core";
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
  /** Absolute-coordinate `place()` entities (ignored by simulate). */
  places?: SpatialPlace[];
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

function placeGlyph(name: SpatialPlace["name"]): string {
  switch (name) {
    case "wooden-chest":
      return "▣";
    case "logistic-chest-passive-provider":
    case "logistic-chest-active-provider":
    case "logistic-chest-storage":
    case "logistic-chest-buffer":
    case "logistic-chest-requester":
      return "▤";
    case "small-lamp":
      return "◉";
    case "medium-electric-pole":
      return "⋔";
    default:
      return "□";
  }
}

function placeShortLabel(name: SpatialPlace["name"]): string {
  switch (name) {
    case "wooden-chest":
      return "chest";
    case "logistic-chest-passive-provider":
    case "logistic-chest-active-provider":
    case "logistic-chest-storage":
    case "logistic-chest-buffer":
    case "logistic-chest-requester":
      return "logistics";
    case "small-lamp":
      return "lamp";
    case "medium-electric-pole":
      return "pole";
    default:
      return name;
  }
}

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

/**
 * Pan/zoom circuit canvas. Entity buttons are plain HTML inside the transformed world
 * (not SVG foreignObject), so clicks stay reliable. Inspector docks under the viewport.
 */
export function CircuitCanvas({
  laidOut,
  places = [],
  selectedId,
  onSelect,
  entityBags,
  activeIds,
}: CircuitCanvasProps) {
  const { width, height, minX, minY, byNumber } = useMemo(() => {
    let maxX = 0;
    let maxY = 0;
    let nextMinX = 0;
    let nextMinY = 0;
    const map = new Map<number, PlacedEntity>();
    for (const entity of laidOut.entities) {
      map.set(entity.entity_number, entity);
      maxX = Math.max(maxX, entity.position.x);
      maxY = Math.max(maxY, entity.position.y);
      nextMinX = Math.min(nextMinX, entity.position.x);
      nextMinY = Math.min(nextMinY, entity.position.y);
    }
    for (const place of places) {
      maxX = Math.max(maxX, place.x);
      maxY = Math.max(maxY, place.y);
      nextMinX = Math.min(nextMinX, place.x);
      nextMinY = Math.min(nextMinY, place.y);
    }
    return {
      width: PAD * 2 + (maxX - nextMinX + 1) * TILE + 8,
      height: PAD * 2 + (maxY - nextMinY + 1) * TILE + 48,
      minX: nextMinX,
      minY: nextMinY,
      byNumber: map,
    };
  }, [laidOut, places]);

  const toScreen = useCallback(
    (tileX: number, tileY: number) => ({
      x: PAD + (tileX - minX) * TILE,
      y: PAD + (tileY - minY) * TILE,
    }),
    [minX, minY],
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
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
    ignore: boolean;
  } | null>(null);

  const updateView = useCallback((next: ViewState | ((prev: ViewState) => ViewState)) => {
    setView((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      viewRef.current = resolved;
      return resolved;
    });
  }, []);

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
    if (selectedId === undefined) {
      return;
    }
    inspectorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

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
    const onEntity =
      event.target instanceof Element &&
      (event.target.closest(".circuit-entity-button") !== null ||
        event.target.closest(".circuit-place-marker") !== null);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewRef.current.x,
      originY: viewRef.current.y,
      moved: false,
      captured: false,
      ignore: onEntity,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId || drag.ignore) {
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
      updateView({
        ...viewRef.current,
        x: drag.originX + dx,
        y: drag.originY + dy,
      });
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
    // Background click clears selection; entity buttons handle their own onClick.
    if (!drag.moved && !drag.ignore) {
      onSelect(undefined);
    }
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

  const labels = useMemo(() => signalLabelMap(laidOut), [laidOut]);
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
          {places.length > 0 ? " · place() markers are not simulated" : ""}
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
            role="presentation"
          >
            <title>Circuit wires</title>
            {laidOut.wires.map((wire) => {
              const [a, ca, b, cb] = wire;
              const from = byNumber.get(a);
              const to = byNumber.get(b);
              if (from === undefined || to === undefined) {
                return null;
              }
              const isRed = ca === 1 || ca === 3;
              const fromScreen = toScreen(from.position.x, from.position.y);
              const toScreenPos = toScreen(to.position.x, to.position.y);
              const x1 = fromScreen.x + TILE / 2;
              const y1 = fromScreen.y + TILE / 2;
              const x2 = toScreenPos.x + TILE / 2;
              const y2 = toScreenPos.y + TILE / 2;
              return (
                <path
                  key={`${a}:${ca}-${b}:${cb}`}
                  d={wirePath(x1, y1, x2, y2, a + b + ca + cb, a === b)}
                  className={
                    isRed ? "circuit-wire circuit-wire-red" : "circuit-wire circuit-wire-green"
                  }
                  fill="none"
                />
              );
            })}
          </svg>

          {laidOut.entities.map((entity) => {
            const { x, y } = toScreen(entity.position.x, entity.position.y);
            const active = entity.id === selectedId;
            const pulsing = activeIds?.has(entity.id) === true;
            return (
              <button
                key={entity.id}
                type="button"
                className={`circuit-entity-button${active ? " is-selected" : ""}${
                  pulsing ? " is-active-tick" : ""
                }`}
                style={{ left: x, top: y, width: TILE, height: TILE }}
                title={entity.label !== undefined ? `${entity.label} · ${entity.id}` : entity.id}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(entity.id);
                }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <img src={iconSrc(entity)} alt="" width={TILE - 20} height={TILE - 20} />
                <span className="circuit-entity-caption">
                  <span className="circuit-entity-caption-role">
                    {entity.label ?? entity.role ?? entity.kind}
                  </span>
                  <span className="circuit-entity-caption-id">{entity.kind}</span>
                </span>
              </button>
            );
          })}

          {places.map((place) => {
            const { x, y } = toScreen(place.x, place.y);
            return (
              <div
                key={place.id}
                className="circuit-place-marker"
                style={{ left: x, top: y, width: TILE, height: TILE }}
                title={`${place.name} @ (${place.x}, ${place.y}) — not simulated`}
              >
                <span className="circuit-place-glyph" aria-hidden="true">
                  {placeGlyph(place.name)}
                </span>
                <span className="circuit-entity-caption">
                  <span className="circuit-entity-caption-role">{placeShortLabel(place.name)}</span>
                  <span className="circuit-entity-caption-id">
                    ({place.x},{place.y})
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div ref={inspectorRef} className="circuit-inspector-dock">
        {selected !== undefined ? (
          <CombinatorInspector
            entity={selected}
            laidOut={laidOut}
            entityBags={entityBags}
            labels={labels}
            onClose={() => onSelect(undefined)}
          />
        ) : (
          <p className="sim-muted">
            Click a combinator — labels are Lua names (i, run, signal-L); __t… are internal wires.
            {places.length > 0
              ? " Place markers show absolute tile positions and are ignored by simulate()."
              : ""}
          </p>
        )}
      </div>
    </div>
  );
}
