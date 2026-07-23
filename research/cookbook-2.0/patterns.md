# Combinator cookbook 2.0 — pattern catalog

**Source:** https://forums.factorio.com/viewtopic.php?t=124776  
**Generated:** 2026-07-23T21:44:23.857Z  
**Blueprints:** 37 (pages: 0, 20, 40)

## Size histogram (combinator entities)

- **1** combinators: 3
- **2** combinators: 3
- **3** combinators: 9
- **4** combinators: 11
- **5** combinators: 2
- **6** combinators: 1
- **7** combinators: 1
- **8** combinators: 1
- **10** combinators: 1
- **16** combinators: 1
- **17** combinators: 1
- **23** combinators: 1
- **24** combinators: 1
- **26** combinators: 1

## Feature tallies

- `each`: 23
- `redGreenSplit`: 29
- `dualColor`: 33
- `elseOutputs`: 0
- `multiOutput`: 8
- `copyPlusConstant`: 6
- `feedback`: 16
- `selector`: 4

## High-signal entries (opt research)

Ranked by EACH / red-green / copy+const / else_outputs / selector — idioms most likely to beat current LuaTorio emit.

- **A memory cell that only holds data from the previous cell. If the master condition is n…** (`p40-00-to-the-maximum-value-screenshot-2025-03-16-21002`, 10 comb) — EACH, R/G, copy+const, multi-out, feedback
  - _A memory cell that only holds data from the previous cell. If the master condition is not met, projects the last value it has held. If the master set condition is met, updates its value to the one hel_
- **11 iterate list 1** (`p0-11-11-iterate-list-1`, 3 comb) — R/G, copy+const, multi-out, feedback, selector:select
- **12 iterate list 2** (`p0-12-12-iterate-list-2`, 4 comb) — R/G, copy+const, multi-out, feedback, selector:count,select
- **10 filter real items** (`p0-10-10-filter-real-items`, 4 comb) — EACH, R/G, selector:stack-size
  - _Filter stackable items from an arbitrary number of signals._
- **13 stalled belt detector** (`p0-14-13-stalled-belt-detector`, 1 comb) — R/G, copy+const, multi-out, feedback
  - _This is a counter that counts the ticks while there are items on the belt ([virtual-signal=signal-anything]) AND it don't receives any pulses from the belt ([virtual-signal=signal-everything]).  A suf_
- **18 throughput display** (`p0-21-18-throughput-display`, 6 comb) — EACH, R/G, feedback
- **While [virtual-signal=signal-S] is true, pass values from [item=red-wire], so the outpu…** (`p0-25-circuits-i-e-assembler-recipes-flickering-12-22-`, 23 comb) — R/G, copy+const, multi-out, feedback
  - _While [virtual-signal=signal-S] is true, pass values from [item=red-wire], so the output follows the input. While [virtual-signal=signal-S] is false, the output is provided by the other combinator._
- **17 digital display** (`p0-13-17-digital-display`, 3 comb) — EACH, R/G
- **20 pulse extender** (`p0-19-20-pulse-extender`, 4 comb) — EACH, R/G, feedback
  - _If there is some input on [item=green-wire]and [virtual-signal=signal-R]eset is false, pass the input from[item=green-wire]_
- **combinator. 12-21-2024, 14-16-06.png (1.66 MiB) Viewed 35099 times** (`p0-22-combinator-12-21-2024-14-16-06-png-1-66-mib-view`, 8 comb) — EACH, R/G
- **Sends [virtual-signal=signal-P] signal each time the value in the red [item=red-wire] w…** (`p0-28-signal-in-different-wires-no-12-24-2024-22-38-10`, 24 comb) — EACH, R/G
  - _Sends [virtual-signal=signal-P] signal each time the value in the red [item=red-wire] wire increases. Delay: 2 ticks  Can be switched to negative [virtual-signal=down-right-arrow] front by replacing >_
- **While [virtual-signal=signal-S] is true, pass values from [item=red-wire], so the outpu…** (`p20-02-with-the-specific-signal-you-want-combinator-184`, 4 comb) — EACH, R/G, feedback
  - _While [virtual-signal=signal-S] is true, pass values from [item=red-wire], so the output follows the input. While [virtual-signal=signal-S] is false, the output is provided by the other combinator._
- **189046 snip** (`p40-01-189046-snip`, 5 comb) — EACH, R/G
  - _range M-R = Lower Bound_
- **1 math** (`p0-00-1-math`, 3 comb) — EACH, R/G
  - _Divide everything from [item=red-wire] by everything from [item=green-wire]. Can be used for all the other arithmetic operations as well._
- **2 min** (`p0-01-2-min`, 4 comb) — EACH, R/G
  - _This combinator outputs all signals from[item=green-wire]whose values are lower or equal than the corresponding signals on[item=red-wire] The other combinator outputs all signals from[item=red-wire]wh_
- **This combinator outputs all signals from[item=green-wire]whose values are greater than …** (`p0-02-hh-copy-blueprint-maximum`, 4 comb) — EACH, R/G
  - _This combinator outputs all signals from[item=green-wire]whose values are greater than or equal to the corresponding signals on[item=red-wire] The other combinator outputs all signals from[item=red-wi_
- **3 filter include** (`p0-03-3-filter-include`, 3 comb) — EACH, R/G
  - _Arbitrary signals on[item=red-wire] Filter definition on[item=green-wire] Output only signals from[item=red-wire]also present on[item=green-wire] Values on[item=green-wire]don't matter, don't need to _
- **4 filter exclude** (`p0-04-4-filter-exclude`, 3 comb) — EACH, R/G
  - _Arbitrary signals on[item=red-wire] Filter definition on[item=green-wire] Output only signals from[item=red-wire]not present on[item=green-wire] Values on[item=green-wire]don't matter, don't need to b_
- **5 filter limit** (`p0-05-5-filter-limit`, 3 comb) — EACH, R/G
  - _Maximum allowed items_
- **14 map item to list** (`p0-15-14-map-item-to-list`, 3 comb) — EACH, R/G
  - _Simulated fluid content_
- **15 limit train limit** (`p0-16-15-limit-train-limit`, 4 comb) — EACH, R/G
  - _Train capacity. 4 [item=iron-ore] wagons: 4*40*50=8000 4 [item=iron-plate] wagons: 4*40*100=16000_
- **16 asteroid collecting** (`p0-17-16-asteroid-collecting`, 2 comb) — EACH, R/G
  - _Maximum allowed items_
- **19 edge detector** (`p0-18-19-edge-detector`, 3 comb) — EACH, R/G
  - _Delay 1 tick_
- **21 periodic memory snapshot** (`p0-20-21-periodic-memory-snapshot`, 4 comb) — R/G, multi-out, feedback
  - _simulate logistics network content_
- **644584 combinator_16248048_544x256** (`p0-23-644584-combinator-16248048-544x256`, 17 comb) — EACH, R/G
- **simulate logistics network content** (`p0-27-caveat-it-spills-the-counter-into-the-output`, 26 comb) — R/G, multi-out, feedback
- **Simulated fluid content** (`p20-03-are-bumped-into-the-millions-01-05-2025-20-13-07`, 3 comb) — EACH, R/G
- **Define the reprocessing recipe for each type and quality of asteroid chunk.** (`p20-04-dynamically-setting-the-recipe-to-reprocess-aste`, 2 comb) — EACH, R/G
- **Arbitrary signals are on [item=red-wire].** (`p40-02-am-alternative-way-to-include-only-filtered-item`, 16 comb) — EACH, R/G
- **When the selected "max" signal comes out, set the filter to that signal if it is over a…** (`p40-05-into-a-reliable-material-stream-off-a-platform`, 4 comb) — R/G, selector:select
  - _When the selected "max" signal comes out, set the filter to that signal if it is over a count. This is "more than 4 * 45 of a given kind of single component" but you may need other logic to deal with _
- **9 memory cell** (`p0-09-9-memory-cell`, 5 comb) — R/G, feedback
  - _While [virtual-signal=signal-S] is true, pass values from [item=red-wire], so the output follows the input. While [virtual-signal=signal-S] is false, the output is provided by the other combinator._
- **this is needed for the counter to count** (`p0-26-f-i-understood-correctly-the-contraption`, 4 comb) — R/G, feedback
- **6 latch** (`p0-06-6-latch`, 2 comb) — R/G, feedback
  - _Hysteresis: Activate[virtual-signal=signal-check]if input signal [item=iron-ore] raises above the upper limit (200). [virtual-signal=signal-check]stays active until input signal [item=iron-ore] goes b_
- **8 clock** (`p0-08-8-clock`, 1 comb) — copy+const, multi-out, feedback
  - _This clock counts from 0 to 100, then starts from 0 again. Feel free to provide a different loop condition with different input signals. The clock counts as long as the conditions are true.  In contra_
- **Ensures a belt has an arbitrary amount of ammo on it. This lets you connect to a space …** (`p20-01-is-probably-looser-than-it-ought-to-be`, 4 comb) — R/G, feedback
  - _Ensures a belt has an arbitrary amount of ammo on it. This lets you connect to a space platform's ammo feed belt, set "hold all" and read the entire belt. And if it's assemblers cannot feed the belt t_
- **7 counter** (`p0-07-7-counter`, 1 comb) — feedback
  - _This counter counts everything moved by the inserter. It is reset to 0 if [virtual-signal=signal-R]>0 is provided._
- **state of the new display panel for signage.** (`p20-00-state-of-the-new-display-panel-for-signage`, 7 comb) — plain

## Full index

| id | label | comb | EACH | R/G | else | copy+δ | selector |
|----|-------|------|------|-----|------|--------|----------|
| `p0-00-1-math` | 1 math | 3 | Y | Y |  |  |  |
| `p0-01-2-min` | 2 min | 4 | Y | Y |  |  |  |
| `p0-02-hh-copy-blueprint-maximum` | This combinator outputs all signals from[item=green-wire]whose values are greater than … | 4 | Y | Y |  |  |  |
| `p0-03-3-filter-include` | 3 filter include | 3 | Y | Y |  |  |  |
| `p0-04-4-filter-exclude` | 4 filter exclude | 3 | Y | Y |  |  |  |
| `p0-05-5-filter-limit` | 5 filter limit | 3 | Y | Y |  |  |  |
| `p0-06-6-latch` | 6 latch | 2 |  | Y |  |  |  |
| `p0-07-7-counter` | 7 counter | 1 |  |  |  |  |  |
| `p0-08-8-clock` | 8 clock | 1 |  |  |  | Y |  |
| `p0-09-9-memory-cell` | 9 memory cell | 5 |  | Y |  |  |  |
| `p0-10-10-filter-real-items` | 10 filter real items | 4 | Y | Y |  |  | stack-size |
| `p0-11-11-iterate-list-1` | 11 iterate list 1 | 3 |  | Y |  | Y | select |
| `p0-12-12-iterate-list-2` | 12 iterate list 2 | 4 |  | Y |  | Y | count,select |
| `p0-13-17-digital-display` | 17 digital display | 3 | Y | Y |  |  |  |
| `p0-14-13-stalled-belt-detector` | 13 stalled belt detector | 1 |  | Y |  | Y |  |
| `p0-15-14-map-item-to-list` | 14 map item to list | 3 | Y | Y |  |  |  |
| `p0-16-15-limit-train-limit` | 15 limit train limit | 4 | Y | Y |  |  |  |
| `p0-17-16-asteroid-collecting` | 16 asteroid collecting | 2 | Y | Y |  |  |  |
| `p0-18-19-edge-detector` | 19 edge detector | 3 | Y | Y |  |  |  |
| `p0-19-20-pulse-extender` | 20 pulse extender | 4 | Y | Y |  |  |  |
| `p0-20-21-periodic-memory-snapshot` | 21 periodic memory snapshot | 4 |  | Y |  |  |  |
| `p0-21-18-throughput-display` | 18 throughput display | 6 | Y | Y |  |  |  |
| `p0-22-combinator-12-21-2024-14-16-06-png-1-66-mib-view` | combinator. 12-21-2024, 14-16-06.png (1.66 MiB) Viewed 35099 times | 8 | Y | Y |  |  |  |
| `p0-23-644584-combinator-16248048-544x256` | 644584 combinator_16248048_544x256 | 17 | Y | Y |  |  |  |
| `p0-25-circuits-i-e-assembler-recipes-flickering-12-22-` | While [virtual-signal=signal-S] is true, pass values from [item=red-wire], so the outpu… | 23 |  | Y |  | Y |  |
| `p0-26-f-i-understood-correctly-the-contraption` | this is needed for the counter to count | 4 |  | Y |  |  |  |
| `p0-27-caveat-it-spills-the-counter-into-the-output` | simulate logistics network content | 26 |  | Y |  |  |  |
| `p0-28-signal-in-different-wires-no-12-24-2024-22-38-10` | Sends [virtual-signal=signal-P] signal each time the value in the red [item=red-wire] w… | 24 | Y | Y |  |  |  |
| `p20-00-state-of-the-new-display-panel-for-signage` | state of the new display panel for signage. | 7 |  |  |  |  |  |
| `p20-01-is-probably-looser-than-it-ought-to-be` | Ensures a belt has an arbitrary amount of ammo on it. This lets you connect to a space … | 4 |  | Y |  |  |  |
| `p20-02-with-the-specific-signal-you-want-combinator-184` | While [virtual-signal=signal-S] is true, pass values from [item=red-wire], so the outpu… | 4 | Y | Y |  |  |  |
| `p20-03-are-bumped-into-the-millions-01-05-2025-20-13-07` | Simulated fluid content | 3 | Y | Y |  |  |  |
| `p20-04-dynamically-setting-the-recipe-to-reprocess-aste` | Define the reprocessing recipe for each type and quality of asteroid chunk. | 2 | Y | Y |  |  |  |
| `p40-00-to-the-maximum-value-screenshot-2025-03-16-21002` | A memory cell that only holds data from the previous cell. If the master condition is n… | 10 | Y | Y |  | Y |  |
| `p40-01-189046-snip` | 189046 snip | 5 | Y | Y |  |  |  |
| `p40-02-am-alternative-way-to-include-only-filtered-item` | Arbitrary signals are on [item=red-wire]. | 16 | Y | Y |  |  |  |
| `p40-05-into-a-reliable-material-stream-off-a-platform` | When the selected "max" signal comes out, set the filter to that signal if it is over a… | 4 |  | Y |  |  | select |

## LuaTorio relevance checklist

Tracked follow-ups (filed after first rip):

| Topic | Issue |
|-------|--------|
| Import cookbook fixtures for VM parity | [#57](https://github.com/lexwebb/LuaTorio/issues/57) |
| Bag pairwise EACH arith (`1 math`) | [#58](https://github.com/lexwebb/LuaTorio/issues/58) |
| Channel presence / limit filters (`3`–`5`) | [#59](https://github.com/lexwebb/LuaTorio/issues/59) |
| Multi-signal EVERYTHING memory cell (`9`) | [#60](https://github.com/lexwebb/LuaTorio/issues/60) |
| Edge detector + pulse extender (`19`/`20`) | [#61](https://github.com/lexwebb/LuaTorio/issues/61) |
| ANY/EVERY wildcard emit (`13`) | [#62](https://github.com/lexwebb/LuaTorio/issues/62) |
| Scalar hysteresis latch (`6`, low priority) | [#63](https://github.com/lexwebb/LuaTorio/issues/63) |

Suggested order: **#57 → #58/#59 → #60 → #61/#62 → #63**.

## VM parity fixtures

Issue [#57](https://github.com/lexwebb/LuaTorio/issues/57) adds hand-built, importable
Factorio 2.0 JSON fixtures under
`packages/core/src/sim/fixtures/`:

- `cookbook-1-math.json` — `EACH ÷ EACH`, with red-only dividend and green-only divisor.
- `cookbook-3-filter-include.json` — red data / green presence-mask decider.
- `cookbook-8-clock.json` — one-decider copy-plus-constant feedback clock.

The importer preserves their color-specific connector topology. The clock has a
tick-trace assertion. The first two are structural parity fixtures for now:
pairwise `EACH` arithmetic and cross-color `EACH` presence comparison are not
yet evaluated faithfully by the VM (tracked by [#58](https://github.com/lexwebb/LuaTorio/issues/58)
and [#59](https://github.com/lexwebb/LuaTorio/issues/59), respectively). These
fixtures deliberately remain in the corpus to prevent ingest regressions while
those VM/emit follow-ups land.

Also already in flight / mined:

- [x] Clock / counter idioms vs [#50](https://github.com/lexwebb/LuaTorio/issues/50) fused decider clock
- [ ] Selector cookbook uses vs [`signal_at`](https://github.com/lexwebb/LuaTorio/issues/47) / count
- [ ] Map-item-to-recipe / iterate-list as domain examples (not builtins)
