/** Bundled `examples/*.lua` sources (see `docs/superpowers/plans/2026-07-23-web-playground.md` Task 2). */

export type ExampleGroup =
  | "Tour"
  | "Basics"
  | "Memory & control"
  | "Bags"
  | "Selectors"
  | "Placement"
  | "Other";

export interface Example {
  id: string;
  label: string;
  group: ExampleGroup;
  source: string;
}

interface ExampleMeta {
  label: string;
  group: ExampleGroup;
}

/** Friendly labels / groups for known examples; unknown files fall under Other. */
const EXAMPLE_META: Record<string, ExampleMeta> = {
  tour: { label: "Tour — function + bags + place", group: "Tour" },
  adder: { label: "Adder", group: "Basics" },
  clamp: { label: "Clamp (and/or)", group: "Basics" },
  mux: { label: "Mux", group: "Basics" },
  "comparison-chain": { label: "Comparison chain", group: "Basics" },
  or_flags: { label: "OR flags", group: "Basics" },
  clamp_fn: { label: "Clamp function", group: "Basics" },
  counter: { label: "Counter", group: "Memory & control" },
  accumulator: { label: "Accumulator", group: "Memory & control" },
  "conditional-counter": { label: "Conditional counter", group: "Memory & control" },
  elseif_nested: { label: "Elseif + nested if", group: "Memory & control" },
  while_count: { label: "While count", group: "Memory & control" },
  for_sum: { label: "For sum", group: "Memory & control" },
  sr_latch: { label: "SR latch", group: "Memory & control" },
  edge: { label: "Edge detector", group: "Memory & control" },
  each_latch: { label: "EACH latch bag", group: "Bags" },
  bag_arith: { label: "Bag arith (EACH÷EACH)", group: "Bags" },
  bag_filter: { label: "Bag filter", group: "Bags" },
  bag_wildcards: { label: "Bag ANY/EVERY", group: "Bags" },
  table_bag: { label: "Table bag syntax", group: "Bags" },
  signal_at: { label: "signal_at (Nth largest)", group: "Selectors" },
  signal_at_asc: { label: "signal_at_asc (Nth smallest)", group: "Selectors" },
  signal_count: { label: "signal_count", group: "Selectors" },
  place: { label: "place() entities", group: "Placement" },
};

const GROUP_ORDER: ExampleGroup[] = [
  "Tour",
  "Basics",
  "Memory & control",
  "Bags",
  "Selectors",
  "Placement",
  "Other",
];

// Vite inlines every matched file's raw text at build time; the glob is resolved relative to
// this file, so it reaches the repo-root `examples/` directory two levels above `apps/web`.
const modules = import.meta.glob("../../../../examples/*.lua", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const examples: Example[] = Object.entries(modules)
  .map(([path, source]) => {
    const fileName = path.split("/").pop() ?? path;
    const id = fileName.replace(/\.lua$/, "");
    const meta = EXAMPLE_META[id];
    return {
      id,
      label: meta?.label ?? id,
      group: meta?.group ?? "Other",
      source,
    };
  })
  .sort((a, b) => {
    const groupDelta = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    if (groupDelta !== 0) return groupDelta;
    return a.label.localeCompare(b.label);
  });

/** Prefer the tour example, then adder, then whatever is first after grouping. */
export function defaultExampleSource(): string {
  return (
    examples.find((example) => example.id === "tour")?.source ??
    examples.find((example) => example.id === "adder")?.source ??
    examples[0]?.source ??
    'local x = input("signal-A")\noutput("signal-B", x)'
  );
}

export function examplesByGroup(): Array<{ group: ExampleGroup; examples: Example[] }> {
  const buckets = new Map<ExampleGroup, Example[]>();
  for (const group of GROUP_ORDER) {
    buckets.set(group, []);
  }
  for (const example of examples) {
    buckets.get(example.group)?.push(example);
  }
  return GROUP_ORDER.filter((group) => (buckets.get(group)?.length ?? 0) > 0).map((group) => ({
    group,
    examples: buckets.get(group) ?? [],
  }));
}
