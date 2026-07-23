# Overnight autonomous work log — 2026-07-23/24

**Mode:** Full autonomous on `main`. Decisions made without blocking. Major open questions → skipped + noted here for morning.

**Board:** https://github.com/users/lexwebb/projects/1  
**Tip commit baseline:** `88db079` (PR #75 merge)

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
| Bag typing | Rename/generalize `eachLatchLocals` → `bagLocals`; bag producers start as `each_latch`; bag→op nodes added as siblings land |
| #57 fixtures without rip `out/` | Hand-build minimal Factorio-shaped JSON mirroring cookbook idioms (EACH÷EACH, filter include, clock, memory cell, edge) using existing `fromBlueprint` schema — re-rip later for exact BP parity |
| #60/#61/#63 size-win unclear | Implement if ≤ cookbook entity count; else document composition recipe and close not-planned with link |
| #71 recursion | Design note + analyzer detection only if v3 lands; full stack emit may defer |
| #72/#73 place() | Design docs required; full emit only if time — otherwise leave Todo with design Done |
| Tests | Always `pnpm typecheck` + targeted vitest before commit; update goldens when emit changes |

## Session log

### T0 — Kickoff
- Explored codebase (bags = `each_latch` wire handles only; no bag type lattice).
- Cookbook `out/` not in git → #57 will use hand-built fixtures.
- Starting #66 + parallel #65 + #57.

### T1 — #57 fixtures (DONE)
- Commit `36f52f3` — hand-built `cookbook-1-math`, `cookbook-3-filter-include`, `cookbook-8-clock`.
- Issue closed, Project Done. VM pairwise EACH still structural-only until #58/#59.

### T2 — #65 + #66 + #58 (DONE, combined commit)
- Design notes: `2026-07-23-elseif-nested-if-design.md`, `2026-07-23-first-class-bags-design.md`.
- Surface: `bag_const(...)`, `bag_arith(op, left, right)`; `bagLocals` typing.
- Emit: 1 arith EACH⊗EACH, left red / right green.
- Examples: `elseif_nested.lua`, `bag_arith.lua`.
- `pnpm typecheck` + 199 tests green.
- Commit pending in this step → see git log.

### T3 — #59 bag filters (DONE)
- Added `bag_filter("include" | "exclude" | "limit", data, mask)` with shared `bag_filter` IR.
- Emits one red-data / green-mask EACH decider; include/exclude use presence and limit uses `data <= mask`.
- Added design note, `bag_filter.lua`, goldens, analyzer validation, and simulator coverage.

### T4 — #67 + #69 + #72 design roadmap (DONE)
- Added accepted v3 function, v4 tables-as-bags, and v5 `place()` designs, each mapped to its
  existing implementation follow-up (#68, #70, #73).
- v3 uses fully inlined, non-recursive pure functions with immutable captures; v4 chooses
  bracketed string-literal signal keys for immutable constant bags; v5 starts with three placed
  non-combinator entities and no automatic placed-entity wiring.
- Linked the roadmap slice and README language reference; no emit work was started.

---
