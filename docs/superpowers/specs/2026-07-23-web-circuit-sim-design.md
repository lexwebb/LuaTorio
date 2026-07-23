# Web Circuit Simulator + Canvas

**Date:** 2026-07-23  
**Status:** Done (P0–P2)  
**Related:** playground MVP (`2026-07-23-web-playground-design.md`), `@luatorio/core` `simulate` / `layout`

## Goal

Validate LuaTorio programs in the browser — not only compile to a blueprint string, but **run the tick-accurate sim** and optionally **see the laid-out circuit**.

## Phases

| Phase | Deliverable |
|---|---|
| **P0** | Simulate view: editable `input()` values, tick count, output trace table |
| **P1** | Circuit canvas from `layout()` + vendored combinator icons + Wube disclaimer |
| **P2** | Tick scrubbing, play/pause/step + speed, entity config + live bag inspector, layered layout for canvas |

## Pipeline (browser)

```
source → parse → analyze → lower → optimize → lowerToCombinators
                                      ↓
                    simulate(graph, { ticks, inputs, entityOutputs })
                                      ↓
                    layout(graph, { arrangement: "layered" }) → canvas
```

Reuse exported `@luatorio/core` APIs; no new VM. Compile-to-blueprint remains the existing `compile()` path (`layout` default stays `row` for emit/goldens).

## UI

- Add **Simulate** alongside Blueprint / JSON / Stats.
- Simulate pane: input fields (from graph `inputs`), ticks, Run (debounce on change OK), results table (`tick × output signals`).
- P1: canvas above the table — entities at layout positions, wires as colored strokes, icons by `kind`.
- P2: playback (reset / step / play-pause / speed / scrubber), click combinator for `control_behavior` + live bag, layered columns so feedback nets are readable.

## Vendored icons

Ship 64×64 (or wiki) PNGs under `apps/web/public/factorio-icons/` (or `src/assets/factorio-icons/`):

- constant / arithmetic / decider / selector combinators

**License posture** (Wube ToS / prior non-commercial icon use):

- Icons © Wube Software
- Non-commercial fan project; not affiliated with Wube
- Not for redistribution outside this app
- Wube may request removal — we comply
- Document in `apps/web/public/factorio-icons/NOTICE` + playground footer/disclaimer

Do **not** vendor full game spritesheets or GUI chrome from the game.

## Non-goals (this track)

- Pixel-perfect Factorio map render / entity orientation
- Simulating foreign blueprints in the UI (core can; playground stays Lua→graph)
- Web Worker (add if traces get heavy)

## Tracking issues

1. P0 — browser simulate panel  
2. P1 — circuit canvas + vendored icons + NOTICE  
3. P2 — playback / inspector / layered canvas layout
