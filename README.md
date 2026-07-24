# LuaTorio

LuaTorio is a TypeScript compiler that translates a restricted subset of real Lua into
[Factorio](https://factorio.com) 2.0+ circuit network blueprints. Write ordinary Lua expressions
describing combinational logic; LuaTorio parses them with a real Lua parser, lowers them to a
signal-value IR, optimizes and lays out the resulting circuit, and emits a pasteable blueprint
string (or the raw blueprint JSON, for debugging).

It ships as an npm library, [`@luatorio/core`](packages/core), a CLI, `luatorio`
([`packages/cli`](packages/cli)), and a browser playground ([`apps/web`](apps/web)).

See [`docs/superpowers/specs/2026-07-22-luatorio-design.md`](docs/superpowers/specs/2026-07-22-luatorio-design.md)
for the full design spec, IR, combinator lowering, and roadmap.

## Playground

Local:

```bash
pnpm build
pnpm dev:web
```

Deployed (GitHub Pages): [https://lexwebb.github.io/LuaTorio/](https://lexwebb.github.io/LuaTorio/)

The editor shows **live diagnostics** (parse/analyze errors under the cursor) and **autocomplete**
for LuaTorio builtins plus common signal / `place()` entity **string** names inside quotes.
Signal args remain string literals — completions fill them; they are not language constants.

One-time repo setting if Pages is not live yet: **Settings → Pages → Source: GitHub Actions**.
Deploys run from [`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push to `main`.

## Install

```bash
pnpm install
```

## Quickstart

Build the workspace once so the CLI can resolve `@luatorio/core`, then compile an example:

```bash
pnpm build
node packages/cli/dist/index.js compile examples/adder.lua
```

`examples/adder.lua` adds two signals together:

```lua
local a = input("signal-A")
local b = input("signal-B")
output("signal-C", a + b)
```

Useful CLI flags:

```bash
node packages/cli/dist/index.js compile examples/adder.lua -o out.txt   # write to a file
node packages/cli/dist/index.js compile examples/adder.lua --json       # raw blueprint JSON
node packages/cli/dist/index.js compile examples/adder.lua --name "Adder"
```

Or use the library directly:

```ts
import { compile } from "@luatorio/core";

const { blueprint, stats } = compile(`output("signal-B", input("signal-A") + 1)`);
console.log(blueprint); // paste into Factorio's blueprint import dialog
console.log(stats); // { combinators: 3, places: 0, wires: 2 }
```

## What you can write today

A short path through the supported surface. Open the linked examples, or load
[`examples/tour.lua`](examples/tour.lua) in the playground for a single mixed program.

1. **Arithmetic** — [`adder.lua`](examples/adder.lua): `output("signal-C", a + b)`.
2. **Memory** — [`counter.lua`](examples/counter.lua): `x = x + 1` becomes a latch.
3. **Control** — [`elseif_nested.lua`](examples/elseif_nested.lua): `if` / `elseif` mux next-state.
4. **Helpers** — [`clamp_fn.lua`](examples/clamp_fn.lua): prefix `local function` (fully inlined).
5. **Bags** — [`bag_arith.lua`](examples/bag_arith.lua): multi-signal `bag_arith` / `bag_filter`.
6. **Table bags** — [`table_bag.lua`](examples/table_bag.lua): `{ ["signal-A"] = 10 }` and `bag["signal-A"]`.
7. **Machine I/O** — [`logistics_io.lua`](examples/logistics_io.lua): read a logistics chest and drive requester requests.

Recursion is **not supported** — use `while` / `for` with memory instead
([decision](docs/superpowers/specs/2026-07-23-v4-recursion-design.md)).

## Examples

[`examples/`](examples) contains working programs, each compiled and decoded in
`packages/core/src/golden.test.ts`:

| File | Demonstrates |
|---|---|
| [`tour.lua`](examples/tour.lua) | Mixed tour: function + table bags + `place()` |
| [`adder.lua`](examples/adder.lua) | Two inputs, arithmetic (`+`) |
| [`clamp.lua`](examples/clamp.lua) | Clamping a value into a range via `and`/`or` |
| [`clamp_fn.lua`](examples/clamp_fn.lua) | v3 reusable `local function` clamp, inlined at calls |
| [`mux.lua`](examples/mux.lua) | 2-to-1 multiplexer (`select`) via `and`/`or` |
| [`comparison-chain.lua`](examples/comparison-chain.lua) | Comparisons (`<`) chained with `and` |
| [`counter.lua`](examples/counter.lua) | v2 memory: free-running counter (`x = x + 1`) |
| [`accumulator.lua`](examples/accumulator.lua) | v2 memory: accumulate `signal-A` each tick |
| [`conditional-counter.lua`](examples/conditional-counter.lua) | v2 if/else: muxed next-state (`if c then x+1 else x-1`) |
| [`elseif_nested.lua`](examples/elseif_nested.lua) | v2 `elseif` priority and nested `if` next-state muxes |
| [`while_count.lua`](examples/while_count.lua) | v2 clocked while: count up to `signal-L` (`tick()` barrier) |
| [`for_sum.lua`](examples/for_sum.lua) | v2 clocked for: sum `1..10` one iteration per tick |
| [`sr_latch.lua`](examples/sr_latch.lua) | Cookbook SR via `sr(q, set, reset)` — one decider latch |
| [`edge.lua`](examples/edge.lua) | Rising-edge pulse via `edge(level)` |
| [`each_latch.lua`](examples/each_latch.lua) | EACH-tag sticky hysteresis bag — 1 constant + 1 decider |
| [`bag_arith.lua`](examples/bag_arith.lua) | Cookbook 1 math: pairwise `EACH / EACH` bags over red/green |
| [`bag_filter.lua`](examples/bag_filter.lua) | Cookbook 3–5: include, exclude, and per-channel limit bags |
| [`bag_wildcards.lua`](examples/bag_wildcards.lua) | `bag_test` ANYTHING / EVERYTHING predicates |
| [`table_bag.lua`](examples/table_bag.lua) | v4 constant bag table syntax and named scalar samples |
| [`signal_at.lua`](examples/signal_at.lua) | Pick Nth-largest input via `signal_at` → selector `select` |
| [`signal_at_asc.lua`](examples/signal_at_asc.lua) | Nth-smallest among present (`signal_at_asc`) — priority ranks |
| [`signal_count.lua`](examples/signal_count.lua) | Count nonzero inputs via `signal_count` → selector combinator |
| [`place.lua`](examples/place.lua) | v5 absolute chest, lamp, and power-pole placement beside a circuit |
| [`logistics_io.lua`](examples/logistics_io.lua) | v5.1 logistics-chest inventory read and requester circuit requests |

## Language Reference

Programs are a flat sequence of statements. See the
[design spec](docs/superpowers/specs/2026-07-22-luatorio-design.md) and
[v2 sequential design](docs/superpowers/specs/2026-07-23-v2-sequential-design.md) for the roadmap.
Later roadmap designs: [v3 functions](docs/superpowers/specs/2026-07-23-v3-functions-design.md),
[v4 tables as bags](docs/superpowers/specs/2026-07-23-v4-tables-as-bags-design.md), and
[v5 `place()`](docs/superpowers/specs/2026-07-23-v5-place-design.md).

Builtins are **circuit primitives** (latches, EACH bags, rank/count). Domain machines
(foundries, assemblers, …) are examples that compose those primitives — not new language APIs.

### Allowed constructs

| Construct | Notes |
|---|---|
| `local x = <expr>` | Every local must be initialized |
| `local function f(params) local x = <expr> … return <expr> end` | Prefix-only pure helper declaration; calls are fully inlined, with immutable outer-local captures |
| `x = <expr>` | Next-state assignment (at most one per variable); promotes `x` to a memory cell |
| `if` / `elseif` / `else` | Muxes next-state stores (`select`); nested `if` allowed; omitted branch holds previous value |
| `while cond do … tick() end` | Clocked loop: at most one per program; body ends with `tick()` |
| `for i = lo, hi do … tick() end` | Numeric for only; optional step must be literal `1`; `i` not assignable in body |
| `tick()` | Syntactic barrier only (no IR); required as last statement of a while/for body |
| `input("signal-name")` | Built-in; declares a circuit input, returns its value |
| `output("signal-name", expr)` | Built-in; top-level statement only, declares a circuit output |
| `place("entity", x, y)` | Top-level statement or entity-handle local; place an allowed non-combinator |
| `input_from(entity)` | Read a placed logistics chest as a bag; wires chest contents into its consumers |
| `output_to(entity, bag)` | Drive requester/buffer logistics requests from a bag |
| `configure(entity, { … })` | Set logistics read/request flags and optional literal request filters |
| `q = sr(q, set, reset)` | Cookbook SR latch: `Q' = (Q ∨ set) ∧ ¬reset` → 0/1; one decider |
| `each_latch(level, signal, high, …)` | Sticky multi-signal hysteresis bag (EACH tags); `output(signal, bag)` |
| `bag_const(signal, count, …)` | Constant multi-signal bag; signal/count pairs are literals |
| `bag_arith(op, left, right)` | Pairwise bag arithmetic (`+ - * / %`); left red, right green, output EACH |
| `bag_filter(mode, data, mask)` | Red bag filtered by green bag: `include`, `exclude`, or count `limit` |
| `{ ["signal-name"] = integer, … }` | Non-empty constant multi-signal bag (v4) |
| `bag["signal-name"]` | Scalar named-channel sample; absent channels read as `0` |
| `signal_at(index, a, b, …)` | Value of Nth-largest nonzero arg; selector `select` (`select_max`) |
| `signal_at_asc(index, a, b, …)` | Value of Nth-smallest nonzero arg; selector `select` ascending |
| `signal_count(a, b, …)` | Count nonzero args; emits one selector combinator (`operation: "count"`) |
| Arithmetic: `+ - * / %` | Lowers to arithmetic combinators |
| Comparisons: `< > <= >= == ~=` | Lowers to a decider combinator (1/0 output) |
| `a and b or c` | Standard Lua ternary idiom; desugars to a `select` (mux) |
| Integer literals | Lowers to constant combinators; floats are rejected |

**Free-running vs clocked:** Programs without a loop stay free-running (phase 1–2): top-level
assigns/`if` update every game tick. A program with `while`/`for` is clocked —
shape must be `local*` → one loop → `output*` only; free-running stores cannot mix with a
loop. One Factorio game tick = one loop iteration (`tick()` is the barrier).

**Memory (v2 phase 1):** A variable that is assigned after `local` becomes a latch. RHS reads
see the previous game-tick value; the assignment is the next-state function evaluated every
tick. Unreassigned locals stay combinational (v1 SSA).

**If/else (v2 phase 2):** Branch leaves may only assign declared locals; nested `if` and
`elseif` chains desugar into nested `select` values. An omitted branch holds via the memory id.

**Clocked loops (v2 phase 3):** `while`/`for` desugar onto flat IR with a synthetic `__run`
latch and enable-gated stores (no CFG/phi). `repeat` and generic `for` are rejected.

**Functions (v3):** `local function` declarations must be a program prefix. Their bodies contain
only immutable `local` declarations followed by one `return` expression. They cannot use I/O,
assignments, control flow, `tick()`, `sr()`, or capture mutable locals. Functions may call other
declared helpers, but recursion is **not supported** (use `while`/`for` + memory); every call is
expanded into the existing scalar/bag expression graph. See
[recursion decision](docs/superpowers/specs/2026-07-23-v4-recursion-design.md).

**Table bags (v4):** A table literal is only a constant bag when it is non-empty and every entry
uses a bracketed string-literal signal name with an integer literal count, such as
`{ ["iron-plate"] = 10, ["signal-A"] = -1 }`. Tables are immutable: arrays, identifier keys,
dot access, computed keys, nested values, duplicates, and field writes are rejected.
`bag["signal-name"]` samples one scalar channel and returns `0` when that channel is absent.

Not yet supported: general Lua tables (beyond constant bags). Unsupported constructs raise a
`SemanticError` naming the construct and, where relevant, its planned version.

### `input()` / `output()` API

- `input("signal-name")` — `signal-name` **must** be a string literal (e.g. `"signal-A"` for a
  virtual signal, or an item/fluid name like `"iron-plate"`). Returns the signal's numeric value.
- `output("signal-name", expr)` — same string-literal rule; must appear as a top-level statement
  (not nested in an expression). A program needs **at least one** `output()` call.
- Bags are multi-signal values. `output("signal-name", bag)` samples that named channel; use one
  output per required boundary channel. Bag locals cannot be used in scalar arithmetic,
  comparisons, or memory assignments. `bag_const`, `bag_arith`, and `bag_filter` explicitly
  encode red/green cookbook patterns and unblock v4 table constructors as constant bags.

### `place()` API (v5.1)

`place("wooden-chest" | "small-lamp" | "medium-electric-pole" | logistics chest, x, y)` is still
valid as a statement. In `local chest = place(...)`, it instead returns an immutable entity handle.
`input_from(chest)` reads a logistics chest's contents as a bag and enables `read_contents`;
`output_to(requester_or_buffer, bag)` enables `set_requests` and wires the bag producer to that
chest. `configure(entity, { read_contents = bool, set_requests = bool,
request_from_buffers = bool, requests = { ["iron-plate"] = 200 } })` overrides flags or supplies
static request filters. Positions remain authoritative absolute blueprint coordinates.
`simulate({ entityInputs })` can inject multi-signal bags onto `input_from` places (by place
id) so playground/tests exercise chest reads — still not a logistics-network sim.

### Errors

`parse()` throws `ParseError`; `analyze()` throws `SemanticError` — both carry `line`/`column`
and, for constructs on the roadmap, a `plannedVersion`. `compile()` lets both propagate
unchanged.

## Contributing

### Project structure

```
luatorio/
├── packages/
│   ├── core/   # parse -> analyze -> lower -> optimize -> lowerToCombinators -> layout -> emitBlueprint
│   └── cli/    # `luatorio compile program.lua`
├── examples/   # sample .lua programs, exercised by packages/core/src/golden.test.ts
├── scripts/    # research/maintenance helpers (e.g. cookbook schematic rip)
├── research/   # scraped catalogs (bulk dumps gitignored)
└── docs/       # design specs and implementation plans
```

### Scripts

| Command | Description |
|---|---|
| `pnpm test` | Run Vitest (unit, integration, and golden snapshot tests) |
| `pnpm typecheck` | TypeScript project build check |
| `pnpm lint` | Biome check |
| `pnpm build` | Emit `packages/*/dist` |
| `pnpm rip:cookbook` | Scrape Combinator cookbook 2.0 schematics → `research/cookbook-2.0/` (#52) |

### Updating golden snapshots

`packages/core/src/golden.test.ts` compiles every program in `examples/` and snapshots its
blueprint JSON. If you intentionally change compiler output (IR lowering, optimizations,
layout, or emission), regenerate and review the snapshots before committing:

```bash
pnpm test -- -u
# or, scoped to just the golden tests:
pnpm test -- packages/core/src/golden.test.ts -u
```

Always diff the updated `packages/core/src/__snapshots__/*.snap` files to confirm the change is
expected.
