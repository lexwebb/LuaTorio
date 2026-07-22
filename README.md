# LuaTorio

LuaTorio is a TypeScript compiler that translates a restricted subset of real Lua into
[Factorio](https://factorio.com) 2.0+ circuit network blueprints. Write ordinary Lua expressions
describing combinational logic; LuaTorio parses them with a real Lua parser, lowers them to a
signal-value IR, optimizes and lays out the resulting circuit, and emits a pasteable blueprint
string (or the raw blueprint JSON, for debugging).

It ships as an npm library, [`@luatorio/core`](packages/core), and a CLI, `luatorio`
([`packages/cli`](packages/cli)).

See [`docs/superpowers/specs/2026-07-22-luatorio-design.md`](docs/superpowers/specs/2026-07-22-luatorio-design.md)
for the full design spec, IR, combinator lowering, and roadmap.

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
console.log(stats); // { combinators: 3, wires: 2 }
```

## Examples

[`examples/`](examples) contains working v1 programs, each compiled and decoded in
`packages/core/src/golden.test.ts`:

| File | Demonstrates |
|---|---|
| [`adder.lua`](examples/adder.lua) | Two inputs, arithmetic (`+`) |
| [`clamp.lua`](examples/clamp.lua) | Clamping a value into a range via `and`/`or` |
| [`mux.lua`](examples/mux.lua) | 2-to-1 multiplexer (`select`) via `and`/`or` |
| [`comparison-chain.lua`](examples/comparison-chain.lua) | Comparisons (`<`) chained with `and` |

## v1 Language Reference

v1 programs are a flat sequence of statements — no user-defined functions, loops, or
reassignment yet (see the [design spec](docs/superpowers/specs/2026-07-22-luatorio-design.md#roadmap)
for the v2+ roadmap).

### Allowed constructs

| Construct | Notes |
|---|---|
| `local x = <expr>` | Single assignment; every local must be initialized |
| `input("signal-name")` | Built-in; declares a circuit input, returns its value |
| `output("signal-name", expr)` | Built-in; top-level statement only, declares a circuit output |
| Arithmetic: `+ - * / %` | Lowers to arithmetic combinators |
| Comparisons: `< > <= >= == ~=` | Lowers to a decider combinator (1/0 output) |
| `a and b or c` | Standard Lua ternary idiom; desugars to a `select` (mux) |
| Integer literals | Lowers to constant combinators; floats are rejected |

Not yet supported (with their planned version): reassignment and `while`/`for`/`repeat` (v2),
`function` (v3), tables and multi-signal bundles (v4), entity placement (v5). Unsupported
constructs raise a `SemanticError` naming the construct and its planned version.

### `input()` / `output()` API

- `input("signal-name")` — `signal-name` **must** be a string literal (e.g. `"signal-A"` for a
  virtual signal, or an item/fluid name like `"iron-plate"`). Returns the signal's numeric value.
- `output("signal-name", expr)` — same string-literal rule; must appear as a top-level statement
  (not nested in an expression). A program needs **at least one** `output()` call.

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
└── docs/       # design specs and implementation plans
```

### Scripts

| Command | Description |
|---|---|
| `pnpm test` | Run Vitest (unit, integration, and golden snapshot tests) |
| `pnpm typecheck` | TypeScript project build check |
| `pnpm lint` | Biome check |
| `pnpm build` | Emit `packages/*/dist` |

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
