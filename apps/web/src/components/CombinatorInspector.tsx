import type { LaidOutCircuit, PlacedEntity } from "@luatorio/core";

export interface CombinatorInspectorProps {
  entity: PlacedEntity;
  laidOut: LaidOutCircuit;
  /** Output bags for every entity at the scrubbed tick (id → signal → count). */
  entityBags: Record<string, Record<string, number>> | undefined;
  onClose: () => void;
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

function signalName(ref: unknown): string | undefined {
  if (ref === null || typeof ref !== "object") {
    return undefined;
  }
  const name = (ref as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

/** Short label for a virtual / item signal (readable in a slot). */
export function signalShort(name: string): string {
  if (name === "signal-each" || name === "each") {
    return "EACH";
  }
  if (name === "signal-everything" || name === "everything") {
    return "ALL";
  }
  if (name === "signal-anything" || name === "anything") {
    return "ANY";
  }
  const virtual = /^signal-(.+)$/i.exec(name);
  if (virtual?.[1] !== undefined) {
    return virtual[1].toUpperCase();
  }
  if (name.startsWith("__")) {
    return name.slice(2, 8).toUpperCase();
  }
  return name.length <= 6 ? name.toUpperCase() : `${name.slice(0, 5)}…`;
}

function kindTitle(kind: PlacedEntity["kind"]): string {
  switch (kind) {
    case "constant":
      return "Constant combinator";
    case "arithmetic":
      return "Arithmetic combinator";
    case "decider":
      return "Decider combinator";
    case "selector":
      return "Selector combinator";
    default:
      return kind;
  }
}

function mergeBags(bags: Array<Record<string, number> | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const bag of bags) {
    if (bag === undefined) {
      continue;
    }
    for (const [name, count] of Object.entries(bag)) {
      if (count === 0) {
        continue;
      }
      out[name] = (out[name] ?? 0) + count;
    }
  }
  return out;
}

/** Merge producer output bags on wires ending at `entity`. */
export function inputBagForEntity(
  laidOut: LaidOutCircuit,
  entity: PlacedEntity,
  entityBags: Record<string, Record<string, number>> | undefined,
): Record<string, number> {
  if (entityBags === undefined) {
    return {};
  }
  const byNumber = new Map(laidOut.entities.map((e) => [e.entity_number, e]));
  const bags: Array<Record<string, number> | undefined> = [];
  for (const wire of laidOut.wires) {
    const [fromNum, , toNum] = wire;
    if (toNum !== entity.entity_number) {
      continue;
    }
    const from = byNumber.get(fromNum);
    if (from === undefined) {
      continue;
    }
    bags.push(entityBags[from.id]);
  }
  return mergeBags(bags);
}

function SignalSlot({ name, value, empty }: { name?: string; value?: number; empty?: boolean }) {
  if (empty || name === undefined) {
    return <div className="ft-slot ft-slot-empty" aria-hidden />;
  }
  const showValue = value !== undefined;
  return (
    <div className="ft-slot" title={name}>
      <span className="ft-slot-glyph">{signalShort(name)}</span>
      {showValue ? <span className="ft-slot-count">{value}</span> : null}
    </div>
  );
}

function ConstSlot({ value }: { value: number | string }) {
  return (
    <div className="ft-slot ft-slot-const" title={`constant ${value}`}>
      <span className="ft-slot-glyph">{value}</span>
    </div>
  );
}

function OpBadge({ children }: { children: string }) {
  return <span className="ft-op">{children}</span>;
}

function SignalGrid({
  label,
  bag,
  emptyHint,
}: {
  label: string;
  bag: Record<string, number>;
  emptyHint: string;
}) {
  const entries = Object.entries(bag).sort(([a], [b]) => a.localeCompare(b));
  return (
    <section className="ft-signal-panel">
      <h4 className="ft-panel-title">{label}</h4>
      {entries.length === 0 ? (
        <p className="ft-empty">{emptyHint}</p>
      ) : (
        <div className="ft-slot-grid">
          {entries.map(([name, count]) => (
            <SignalSlot key={name} name={name} value={count} />
          ))}
        </div>
      )}
    </section>
  );
}

function ArithmeticConfig({
  entity,
  inputBag,
}: {
  entity: PlacedEntity;
  inputBag: Record<string, number>;
}) {
  const c = entity.control_behavior.arithmetic_conditions as Record<string, unknown> | undefined;
  if (c === undefined) {
    return <p className="ft-empty">No arithmetic conditions configured.</p>;
  }
  const leftSig = signalName(c.first_signal);
  const rightSig = signalName(c.second_signal);
  const leftConst = c.first_constant;
  const rightConst = c.second_constant;
  const op = typeof c.operation === "string" ? c.operation : "?";
  const out = signalName(c.output_signal) ?? entity.outputSignal;
  const leftLive = leftSig !== undefined ? inputBag[leftSig] : undefined;
  const rightLive = rightSig !== undefined ? inputBag[rightSig] : undefined;

  return (
    <div className="ft-formula">
      <div className="ft-formula-side">
        <span className="ft-formula-label">Input</span>
        <div className="ft-formula-row">
          {leftSig !== undefined ? (
            <SignalSlot name={leftSig} value={leftLive} />
          ) : (
            <ConstSlot value={Number(leftConst ?? 0)} />
          )}
          <OpBadge>{op}</OpBadge>
          {rightSig !== undefined ? (
            <SignalSlot name={rightSig} value={rightLive} />
          ) : (
            <ConstSlot value={Number(rightConst ?? 0)} />
          )}
        </div>
      </div>
      <span className="ft-formula-arrow" aria-hidden>
        →
      </span>
      <div className="ft-formula-side">
        <span className="ft-formula-label">Output</span>
        <div className="ft-formula-row">
          <SignalSlot name={out} />
        </div>
      </div>
    </div>
  );
}

function DeciderConfig({
  entity,
  inputBag,
}: {
  entity: PlacedEntity;
  inputBag: Record<string, number>;
}) {
  const block = entity.control_behavior.decider_conditions as
    | { conditions?: unknown[]; outputs?: unknown[]; else_outputs?: unknown[] }
    | undefined;
  const conditions = Array.isArray(block?.conditions) ? block.conditions : [];
  const outputs = Array.isArray(block?.outputs) ? block.outputs : [];
  const elses = Array.isArray(block?.else_outputs) ? block.else_outputs : [];

  return (
    <div className="ft-decider">
      <section className="ft-decider-col">
        <h4 className="ft-panel-title">Conditions</h4>
        {conditions.length === 0 ? (
          <p className="ft-empty">No conditions</p>
        ) : (
          <ul className="ft-cond-list">
            {conditions.map((raw) => {
              if (raw === null || typeof raw !== "object") {
                return null;
              }
              const cond = raw as Record<string, unknown>;
              const left = signalName(cond.first_signal) ?? "?";
              const cmp = typeof cond.comparator === "string" ? cond.comparator : "=";
              const rightSig = signalName(cond.second_signal);
              const right = rightSig ?? (cond.constant !== undefined ? String(cond.constant) : "?");
              const join =
                cond.compare_type !== undefined ? String(cond.compare_type).toUpperCase() : null;
              const leftLive = inputBag[left];
              const rightLive = rightSig !== undefined ? inputBag[rightSig] : undefined;
              const key = `${left}${cmp}${right}:${String(cond.compare_type ?? "")}`;
              return (
                <li key={key} className="ft-cond-row">
                  {join !== null ? <span className="ft-join">{join}</span> : null}
                  <div className="ft-formula-row">
                    <SignalSlot name={left} value={leftLive} />
                    <OpBadge>{cmp}</OpBadge>
                    {rightSig !== undefined ? (
                      <SignalSlot name={rightSig} value={rightLive} />
                    ) : (
                      <ConstSlot value={right} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="ft-decider-col">
        <h4 className="ft-panel-title">Outputs</h4>
        {outputs.length === 0 && elses.length === 0 ? (
          <p className="ft-empty">No outputs</p>
        ) : (
          <ul className="ft-cond-list">
            {outputs.map((raw) => {
              if (raw === null || typeof raw !== "object") {
                return null;
              }
              const out = raw as Record<string, unknown>;
              const name = signalName(out.signal) ?? "?";
              const mode =
                out.copy_count_from_input === true
                  ? "Input count"
                  : `= ${String(out.constant ?? 1)}`;
              return (
                <li key={`then:${name}:${mode}`} className="ft-out-row">
                  <SignalSlot name={name} />
                  <span className="ft-out-mode">{mode}</span>
                </li>
              );
            })}
            {elses.map((raw) => {
              if (raw === null || typeof raw !== "object") {
                return null;
              }
              const out = raw as Record<string, unknown>;
              const name = signalName(out.signal) ?? "?";
              const mode = `= ${String(out.constant ?? 1)}`;
              return (
                <li key={`else:${name}:${mode}`} className="ft-out-row">
                  <span className="ft-else-tag">else</span>
                  <SignalSlot name={name} />
                  <span className="ft-out-mode">{mode}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function ConstantConfig({ entity }: { entity: PlacedEntity }) {
  const sections = (
    entity.control_behavior.sections as { sections?: Array<{ filters?: unknown[] }> } | undefined
  )?.sections;
  const filters = sections?.[0]?.filters ?? [];
  if (filters.length === 0) {
    return (
      <p className="ft-empty">
        Empty constant — used as an I/O placeholder (injects inputs / reads outputs).
      </p>
    );
  }
  return (
    <div className="ft-slot-grid">
      {filters.map((raw) => {
        if (raw === null || typeof raw !== "object") {
          return null;
        }
        const filter = raw as { name?: string; count?: number };
        const name = filter.name ?? "signal";
        return (
          <SignalSlot key={`${name}:${filter.count ?? 0}`} name={name} value={filter.count ?? 0} />
        );
      })}
    </div>
  );
}

function SelectorConfig({ entity }: { entity: PlacedEntity }) {
  const op = entity.control_behavior.operation;
  return (
    <div className="ft-formula-row">
      <span className="ft-out-mode">Operation</span>
      <OpBadge>{String(op ?? "?")}</OpBadge>
      <span className="ft-formula-arrow">→</span>
      <SignalSlot name={entity.outputSignal} />
    </div>
  );
}

/**
 * Factorio 2.0–inspired combinator detail: config formula + live input/output signal grids.
 */
export function CombinatorInspector({
  entity,
  laidOut,
  entityBags,
  onClose,
}: CombinatorInspectorProps) {
  const inputBag = inputBagForEntity(laidOut, entity, entityBags);
  const outputBag = entityBags?.[entity.id] ?? {};

  return (
    <aside className="ft-inspector" aria-label={`${kindTitle(entity.kind)} details`}>
      <header className="ft-inspector-head">
        <img className="ft-inspector-icon" src={iconSrc(entity)} alt="" width={40} height={40} />
        <div className="ft-inspector-titles">
          <h3>{kindTitle(entity.kind)}</h3>
          <p className="ft-inspector-meta">
            <span className="ft-meta-id">{entity.id}</span>
            {entity.role !== undefined ? <span className="ft-meta-role">{entity.role}</span> : null}
            <span className="ft-meta-drive">drives {entity.outputSignal}</span>
          </p>
        </div>
        <button type="button" className="ft-close" onClick={onClose} aria-label="Close details">
          ×
        </button>
      </header>

      <section className="ft-config-panel">
        <h4 className="ft-panel-title">Configuration</h4>
        {entity.kind === "arithmetic" ? (
          <ArithmeticConfig entity={entity} inputBag={inputBag} />
        ) : null}
        {entity.kind === "decider" ? <DeciderConfig entity={entity} inputBag={inputBag} /> : null}
        {entity.kind === "constant" ? <ConstantConfig entity={entity} /> : null}
        {entity.kind === "selector" ? <SelectorConfig entity={entity} /> : null}
      </section>

      <div className="ft-io-row">
        <SignalGrid label="Input signals" bag={inputBag} emptyHint="No signals on input wires" />
        <SignalGrid label="Output signals" bag={outputBag} emptyHint="Nothing emitted this tick" />
      </div>
    </aside>
  );
}
