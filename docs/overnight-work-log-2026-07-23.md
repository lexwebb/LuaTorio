# Overnight autonomous work log — 2026-07-23/24

**Mode:** Full autonomous on `main`. Decisions made without blocking. Major open questions → skipped + noted here for morning.

**Board:** https://github.com/users/lexwebb/projects/1  
**Tip commit baseline:** `88db079` (PR #75 merge)  
**Final tip (local main, ahead of origin):** `d8c3264`  
**Verification:** `pnpm typecheck` + **227** tests passing

## Morning summary

| Issue | Outcome |
|-------|---------|
| #57 cookbook fixtures | **Done** `36f52f3` |
| #65 elseif / nested if | **Done** `4000286` |
| #66 first-class bags | **Done** `4000286` |
| #58 bag_arith | **Done** `4000286` |
| #59 bag_filter | **Done** `f1c084e` |
| #67 v3 functions design | **Done** `2bae003` |
| #69 v4 tables design | **Done** `2bae003` |
| #72 v5 place design | **Done** `2bae003` |
| #68 v3 functions impl | **Done** `c81594e` |
| #61 edge detector | **Done** `c81594e` (`edge`) |
| #62 ANY/EVERY | **Done** `c81594e` (`bag_test`) |
| #60 bag memory cell | **Not planned** — no size win; composition documented |
| #63 hysteresis | **Not planned** — `sr` composition already honest |
| #70 table bags | **Done** `9bd646c` / `d8c3264` |
| #73 place() | **Done** `9bd646c` |
| #71 recursion emit | **Not planned (Option B)** — permanent reject; loops instead |

**Not pushed** to `origin/main` (8 local commits). Push when ready.

## New language surface (quick ref)

```lua
-- bags
local b = bag_const("signal-A", 10, "signal-B", 5)
local q = bag_arith("/", b, bag_const("signal-A", 2, "signal-B", 1))
local f = bag_filter("include", b, bag_const("signal-A", 1))
local t = { ["signal-A"] = 10, ["iron-plate"] = 3 }
local a = t["signal-A"]

-- control / functions / place
local function clamp(x, lo, hi)
  return x < lo and lo or (x > hi and hi or x)
end
output("signal-C", clamp(input("signal-A"), 0, 100))
output("signal-E", edge(input("signal-D")))
output("signal-W", bag_test("any", ">", b, 0))
place("wooden-chest", 4, 0)
```

## Priority order (fixed)

1. #66 first-class bags  
2. #57 cookbook fixtures  
3. #58 / #59 bag arith + filters  
4. #60 bag memory cell  
5. #61 / #62 edge + wildcards  
6. #65 elseif (can parallel)  
7. #67 → #68 v3 functions → #71 recursion  
8. #69 → #70 v4 tables  
9. #72 → #73 v5 place()  
10. #63 hysteresis (low)

## Decisions (defaults if ambiguous)

| Topic | Decision |
|-------|----------|
| Commit target | Direct to `main` (user authorized) |
| Bag typing | `bagLocals`; producers `each_latch` / `bag_const` / ops / tables |
| #57 fixtures without rip `out/` | Hand-built JSON fixtures (exact cookbook BPs can re-rip later) |
| #60/#63 size-win unclear | Closed not-planned with composition recipes |
| #71 recursion | Design only; emit deferred for morning |
| #73 place() | Minimal allowlist + absolute coords; sim ignores placed entities |
| Tests | typecheck + full vitest before commit |

## Session log

### T0 — Kickoff
- Explored codebase (bags = `each_latch` wire handles only).
- Cookbook `out/` not in git → hand-built fixtures for #57.
- Parallel tracks: #66/#58, #65, #57.

### T1 — #57 fixtures (DONE)
- Commit `36f52f3` — `cookbook-1-math`, `cookbook-3-filter-include`, `cookbook-8-clock`.

### T2 — #65 + #66 + #58 (DONE)
- Commit `4000286` — elseif desugar; `bagLocals`; `bag_const` / `bag_arith`.

### T3 — #59 bag filters (DONE)
- Commit `f1c084e` — `bag_filter(include|exclude|limit)`.

### T4 — #67 + #69 + #72 designs (DONE)
- Commit `2bae003` — v3/v4/v5 accepted designs.

### T5 — #60 / #63 (NOT PLANNED)
- No clear combinator-count win vs existing `each_latch`/`sr` compositions.
- Recipes in `docs/superpowers/specs/2026-07-23-cookbook-followups-design.md`.

### T6 — #68 + #61 + #62 (DONE)
- Commit `c81594e` — inlined `local function`; `edge`; `bag_test`.

### T7/#T8 — #70 + #73 (DONE)
- Commits `9bd646c`, `d8c3264` — table bags + `bag_sample`; `place()`.

### T9 — #71 (DEFERRED → DECIDED Option B)
- Commit `4b1b718` — recursion design note (options).
- **2026-07-24 morning:** chose **Option B** — permanent reject; no stack VM.
  Analyzer no longer says “planned for v4”; docs/README updated; issue closed not planned.

## Morning checklist

1. Review/push 8 commits on `main` (`36f52f3`…`d8c3264`).
2. Decide #71 stack/tick model (or keep permanent reject).
3. Optional: re-rip cookbook `out/` and replace hand fixtures with exact BPs.
4. Optional: pulse extender / bag_hold if a proven size win appears.
5. Spot-check goldens / Factorio import of `place.lua` + `bag_arith.lua`.
