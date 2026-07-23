#!/usr/bin/env node
/**
 * Rip every Factorio blueprint from the Combinator cookbook 2.0 forum thread,
 * decode plans, and catalog patterns useful for LuaTorio emit specialization.
 *
 * Source: https://forums.factorio.com/viewtopic.php?t=124776
 * Issue:  #52
 *
 * Usage:
 *   node scripts/rip-cookbook-2.0.mjs [--out research/cookbook-2.0] [--delay-ms 400]
 */

import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/** Resolve workspace dep even when run from repo root. */
function loadDecodePlan() {
  const candidates = [
    path.join(ROOT, "packages/core/node_modules/@jensforstmann/factorio-blueprint-tools"),
    path.join(ROOT, "node_modules/@jensforstmann/factorio-blueprint-tools"),
  ];
  for (const dir of candidates) {
    try {
      return require(dir).decodePlan;
    } catch {
      // try next
    }
  }
  throw new Error(
    "Cannot find @jensforstmann/factorio-blueprint-tools — run `pnpm install` from repo root",
  );
}

const TOPIC_ID = 124776;
const BASE = `https://forums.factorio.com/viewtopic.php?t=${TOPIC_ID}`;
const USER_AGENT = "LuaTorio-research/1.0 (+https://github.com/lexwebb/LuaTorio; cookbook schematic rip)";

const COMBINATOR_NAMES = new Set([
  "constant-combinator",
  "arithmetic-combinator",
  "decider-combinator",
  "selector-combinator",
]);

function parseArgs(argv) {
  let out = path.join(ROOT, "research/cookbook-2.0");
  let delayMs = 400;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      out = path.resolve(argv[++i] ?? out);
    } else if (arg === "--delay-ms") {
      delayMs = Number(argv[++i] ?? delayMs);
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/rip-cookbook-2.0.mjs [--out DIR] [--delay-ms N]
Fetches Combinator cookbook 2.0, extracts bptext blueprints, writes catalog + patterns.`);
      process.exit(0);
    }
  }
  return { out, delayMs };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Discover pagination offsets from forum HTML. */
function pageOffsets(html) {
  const found = new Set([0]);
  for (const m of html.matchAll(/t=124776(?:&amp;|&)start=(\d+)/g)) {
    found.add(Number(m[1]));
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Guess a human label from text before the blueprint button.
 * Prefers numbered cookbook image names like "8 clock.png".
 */
function labelFromContext(beforeHtml) {
  const text = stripTags(beforeHtml);
  // Prefer cookbook screenshot filenames: "8 clock.png", "14 map item to list.png"
  const imgs = [...text.matchAll(/(\d+)\s+([a-zA-Z][a-zA-Z0-9 _-]{1,60})\.png/gi)];
  if (imgs.length > 0) {
    const last = imgs[imgs.length - 1];
    return `${last[1]} ${last[2].trim().toLowerCase()}`;
  }
  // Trailing bare title (e.g. "Minimum:" / "Maximum:")
  const colon = text.match(/([A-Za-z][A-Za-z0-9 /_-]{1,40}):\s*$/);
  if (colon) {
    return colon[1].trim().toLowerCase();
  }
  // Last ~8 words, skip forum chrome ("Viewed N times")
  const cleaned = text.replace(/\d[\d.]*\s*KiB.*?Viewed\s+\d+\s+times/gi, " ").trim();
  const words = cleaned.split(" ").filter(Boolean);
  return words.slice(-8).join(" ").slice(0, 80) || "untitled";
}

function extractBlueprints(html, pageStart) {
  const out = [];
  const re = /<div class="bptext"[^>]*>(0eN[A-Za-z0-9+/=]+)<\/div>/g;
  let match;
  let index = 0;
  while ((match = re.exec(html)) !== null) {
    const before = html.slice(Math.max(0, match.index - 800), match.index);
    out.push({
      pageStart,
      indexOnPage: index,
      label: labelFromContext(before),
      blueprint: match[1],
    });
    index += 1;
  }
  return out;
}

function signalName(signal) {
  if (signal === null || typeof signal !== "object") {
    return undefined;
  }
  const name = signal.name;
  return typeof name === "string" ? name : undefined;
}

function walkSignals(node, visit) {
  if (Array.isArray(node)) {
    for (const item of node) {
      walkSignals(item, visit);
    }
    return;
  }
  if (node === null || typeof node !== "object") {
    return;
  }
  const name = signalName(node);
  if (name !== undefined && ("type" in node || "quality" in node)) {
    visit(name);
  }
  for (const value of Object.values(node)) {
    walkSignals(value, visit);
  }
}

/**
 * Factorio decider output semantics:
 * - omit `copy_count_from_input` (or true) → copy input count
 * - `copy_count_from_input: false` → emit `constant` (default 1)
 */
function isCopyOutput(output) {
  return output?.copy_count_from_input !== false;
}

function isConstantOutput(output) {
  return output?.copy_count_from_input === false;
}

function hasNetworkSplit(obj) {
  if (obj === null || typeof obj !== "object") {
    return false;
  }
  for (const key of ["first_signal_networks", "second_signal_networks", "networks"]) {
    const net = obj[key];
    if (net && typeof net === "object" && (net.red === false || net.green === false)) {
      return true;
    }
  }
  return false;
}

function analyzePlan(plan) {
  const bp = plan?.blueprint ?? {};
  const entities = Array.isArray(bp.entities) ? bp.entities : [];
  const wires = Array.isArray(bp.wires) ? bp.wires : [];

  const byKind = {
    constant: 0,
    arithmetic: 0,
    decider: 0,
    selector: 0,
    other: 0,
  };
  const otherNames = new Set();
  const signals = new Set();
  let elseOutputs = 0;
  let multiOutput = 0;
  let copyPlusConstant = 0;
  let eachUse = 0;
  let anythingUse = 0;
  let everythingUse = 0;
  let redGreenSplit = 0;
  const selectorOps = new Set();
  let feedbackWires = 0;
  const descriptions = [];

  for (const entity of entities) {
    const name = entity.name;
    if (name === "constant-combinator") {
      byKind.constant += 1;
    } else if (name === "arithmetic-combinator") {
      byKind.arithmetic += 1;
    } else if (name === "decider-combinator") {
      byKind.decider += 1;
    } else if (name === "selector-combinator") {
      byKind.selector += 1;
      const op = entity.control_behavior?.operation;
      if (typeof op === "string") {
        selectorOps.add(op);
      }
    } else {
      byKind.other += 1;
      if (typeof name === "string") {
        otherNames.add(name);
      }
    }

    if (typeof entity.player_description === "string" && entity.player_description.trim()) {
      descriptions.push(entity.player_description.trim().slice(0, 240));
    }

    const cb = entity.control_behavior ?? {};
    walkSignals(cb, (sig) => {
      signals.add(sig);
      if (sig === "signal-each") {
        eachUse += 1;
      } else if (sig === "signal-anything") {
        anythingUse += 1;
      } else if (sig === "signal-everything") {
        everythingUse += 1;
      }
    });

    const decider = cb.decider_conditions;
    if (decider && typeof decider === "object") {
      const outputs = Array.isArray(decider.outputs) ? decider.outputs : [];
      const elseOut = Array.isArray(decider.else_outputs) ? decider.else_outputs : [];
      if (elseOut.length > 0) {
        elseOutputs += 1;
      }
      if (outputs.length > 1 || elseOut.length > 0) {
        multiOutput += 1;
      }
      // Group outputs by signal: copy+const on same signal = 2.0 clock idiom.
      const bySignal = new Map();
      for (const output of [...outputs, ...elseOut]) {
        const sig = signalName(output?.signal) ?? "";
        const entry = bySignal.get(sig) ?? { copy: false, constant: false };
        if (isCopyOutput(output)) {
          entry.copy = true;
        }
        if (isConstantOutput(output)) {
          entry.constant = true;
        }
        bySignal.set(sig, entry);
      }
      for (const entry of bySignal.values()) {
        if (entry.copy && entry.constant) {
          copyPlusConstant += 1;
        }
      }

      const conditions = Array.isArray(decider.conditions) ? decider.conditions : [];
      for (const cond of conditions) {
        if (hasNetworkSplit(cond)) {
          redGreenSplit += 1;
        }
      }
      for (const output of [...outputs, ...elseOut]) {
        if (hasNetworkSplit(output)) {
          redGreenSplit += 1;
        }
      }
    }

    const arith = cb.arithmetic_conditions;
    if (arith && typeof arith === "object" && hasNetworkSplit(arith)) {
      redGreenSplit += 1;
    }
  }

  // Feedback: wire from entity connector out back to same entity in
  for (const wire of wires) {
    if (!Array.isArray(wire) || wire.length < 4) {
      continue;
    }
    const [a, , b] = wire;
    if (a === b) {
      feedbackWires += 1;
    }
  }

  // Both colors present on the same entity → likely R/G cookbook style.
  const colorsByEntity = new Map();
  for (const wire of wires) {
    if (!Array.isArray(wire) || wire.length < 4) {
      continue;
    }
    const [a, ca, b, cb] = wire;
    for (const [ent, conn] of [
      [a, ca],
      [b, cb],
    ]) {
      const set = colorsByEntity.get(ent) ?? new Set();
      // Factorio: 1/3 red, 2/4 green
      set.add(conn % 2 === 1 ? "red" : "green");
      colorsByEntity.set(ent, set);
    }
  }
  let dualColorEntities = 0;
  for (const set of colorsByEntity.values()) {
    if (set.has("red") && set.has("green")) {
      dualColorEntities += 1;
    }
  }

  const combinators = entities.filter((e) => COMBINATOR_NAMES.has(e.name)).length;

  return {
    label: typeof bp.label === "string" ? bp.label : undefined,
    entities: entities.length,
    combinators,
    wires: wires.length,
    byKind,
    otherNames: [...otherNames].sort(),
    features: {
      elseOutputs,
      multiOutput,
      copyPlusConstant,
      eachUse,
      anythingUse,
      everythingUse,
      redGreenSplit,
      dualColorEntities,
      feedbackWires,
      selectorOps: [...selectorOps],
      wildcards: [...signals].filter(
        (s) =>
          s === "signal-each" || s === "signal-anything" || s === "signal-everything",
      ),
    },
    descriptions: [...new Set(descriptions)].slice(0, 5),
  };
}

function slugify(label, pageStart, indexOnPage) {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `p${pageStart}-${String(indexOnPage).padStart(2, "0")}-${base || "bp"}`;
}

function featureScore(features) {
  let score = 0;
  if (features.eachUse) score += 3;
  if (features.redGreenSplit || features.dualColorEntities) score += 3;
  if (features.copyPlusConstant) score += 2;
  if (features.elseOutputs) score += 2;
  if (features.multiOutput) score += 1;
  if (features.feedbackWires) score += 1;
  if (features.selectorOps.length) score += 2;
  if (features.anythingUse || features.everythingUse) score += 1;
  return score;
}

function niceLabel(entry) {
  // Prefer numbered cookbook titles; fall back to first description line.
  if (/^\d+\s+\S/.test(entry.label) && !entry.label.includes(".png")) {
    return entry.label;
  }
  const desc = entry.analysis.descriptions[0];
  if (desc) {
    const first = desc.split(/\n/)[0]?.trim() ?? "";
    if (first.length > 0 && first.length <= 90) {
      return first;
    }
    return `${first.slice(0, 87)}…`;
  }
  return entry.label;
}

function renderPatternsMd(catalog, sourceUrl) {
  const lines = [];
  lines.push("# Combinator cookbook 2.0 — pattern catalog");
  lines.push("");
  lines.push(`**Source:** ${sourceUrl}  `);
  lines.push(`**Generated:** ${catalog.generatedAt}  `);
  lines.push(`**Blueprints:** ${catalog.entries.length} (pages: ${catalog.pages.join(", ")})`);
  lines.push("");
  lines.push("## Size histogram (combinator entities)");
  lines.push("");
  const hist = new Map();
  for (const e of catalog.entries) {
    const n = e.analysis.combinators;
    hist.set(n, (hist.get(n) ?? 0) + 1);
  }
  for (const n of [...hist.keys()].sort((a, b) => a - b)) {
    lines.push(`- **${n}** combinators: ${hist.get(n)}`);
  }
  lines.push("");
  lines.push("## Feature tallies");
  lines.push("");
  const tallies = {
    each: 0,
    redGreenSplit: 0,
    dualColor: 0,
    elseOutputs: 0,
    multiOutput: 0,
    copyPlusConstant: 0,
    feedback: 0,
    selector: 0,
  };
  for (const e of catalog.entries) {
    const f = e.analysis.features;
    if (f.eachUse) tallies.each += 1;
    if (f.redGreenSplit) tallies.redGreenSplit += 1;
    if (f.dualColorEntities) tallies.dualColor += 1;
    if (f.elseOutputs) tallies.elseOutputs += 1;
    if (f.multiOutput) tallies.multiOutput += 1;
    if (f.copyPlusConstant) tallies.copyPlusConstant += 1;
    if (f.feedbackWires) tallies.feedback += 1;
    if (f.selectorOps.length) tallies.selector += 1;
  }
  for (const [k, v] of Object.entries(tallies)) {
    lines.push(`- \`${k}\`: ${v}`);
  }
  lines.push("");
  lines.push("## High-signal entries (opt research)");
  lines.push("");
  lines.push(
    "Ranked by EACH / red-green / copy+const / else_outputs / selector — idioms most likely to beat current LuaTorio emit.",
  );
  lines.push("");
  const ranked = [...catalog.entries].sort(
    (a, b) => featureScore(b.analysis.features) - featureScore(a.analysis.features),
  );
  for (const e of ranked.slice(0, 40)) {
    const f = e.analysis.features;
    const tags = [];
    if (f.eachUse) tags.push("EACH");
    if (f.redGreenSplit || f.dualColorEntities) tags.push("R/G");
    if (f.copyPlusConstant) tags.push("copy+const");
    if (f.elseOutputs) tags.push("else_outputs");
    if (f.multiOutput) tags.push("multi-out");
    if (f.feedbackWires) tags.push("feedback");
    if (f.selectorOps.length) tags.push(`selector:${f.selectorOps.join(",")}`);
    const title = niceLabel(e).replace(/\|/g, "/");
    lines.push(
      `- **${title}** (\`${e.id}\`, ${e.analysis.combinators} comb) — ${tags.join(", ") || "plain"}`,
    );
    const desc = e.analysis.descriptions[0];
    if (desc && niceLabel(e) !== desc.split(/\n/)[0]?.trim()) {
      lines.push(`  - _${desc.replace(/\n/g, " ").slice(0, 200)}_`);
    }
  }
  lines.push("");
  lines.push("## Full index");
  lines.push("");
  lines.push("| id | label | comb | EACH | R/G | else | copy+δ | selector |");
  lines.push("|----|-------|------|------|-----|------|--------|----------|");
  for (const e of catalog.entries) {
    const f = e.analysis.features;
    const rg = f.redGreenSplit || f.dualColorEntities ? "Y" : "";
    lines.push(
      `| \`${e.id}\` | ${niceLabel(e).replace(/\|/g, "/")} | ${e.analysis.combinators} | ${f.eachUse ? "Y" : ""} | ${rg} | ${f.elseOutputs ? "Y" : ""} | ${f.copyPlusConstant ? "Y" : ""} | ${f.selectorOps.join(",") || ""} |`,
    );
  }
  lines.push("");
  lines.push("## LuaTorio relevance checklist");
  lines.push("");
  lines.push("- [ ] Clock / counter / latch idioms vs `#50` fused decider clock");
  lines.push("- [ ] EACH−EACH / red-green filters vs `each_latch` / future bag arith");
  lines.push("- [ ] Memory cell / pulse extender / edge detector as IR shapes");
  lines.push("- [ ] Selector cookbook uses vs `signal_at` / count");
  lines.push("- [ ] Map-item-to-recipe / iterate-list as domain examples (not builtins)");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const { out, delayMs } = parseArgs(process.argv.slice(2));
  const decodePlan = loadDecodePlan();

  const rawDir = path.join(out, "raw");
  const planDir = path.join(out, "out");
  await mkdir(rawDir, { recursive: true });
  await mkdir(planDir, { recursive: true });

  console.error(`Fetching ${BASE} …`);
  const firstHtml = await fetchText(BASE);
  const offsets = pageOffsets(firstHtml);
  console.error(`Pages (start offsets): ${offsets.join(", ")}`);

  const scraped = [];
  for (const start of offsets) {
    const html =
      start === 0 ? firstHtml : await (async () => {
        await sleep(delayMs);
        const url = `${BASE}&start=${start}`;
        console.error(`Fetching ${url} …`);
        return fetchText(url);
      })();
    const bps = extractBlueprints(html, start);
    console.error(`  → ${bps.length} blueprints`);
    scraped.push(...bps);
  }

  // Deduplicate identical blueprint strings (keep first label).
  const seen = new Set();
  const unique = [];
  for (const item of scraped) {
    if (seen.has(item.blueprint)) {
      continue;
    }
    seen.add(item.blueprint);
    unique.push(item);
  }
  console.error(`Unique blueprints: ${unique.length} (from ${scraped.length} raw)`);

  const entries = [];
  const errors = [];
  for (const item of unique) {
    const id = slugify(item.label, item.pageStart, item.indexOnPage);
    await writeFile(path.join(rawDir, `${id}.bp`), `${item.blueprint}\n`, "utf8");
    try {
      const plan = decodePlan(item.blueprint);
      await writeFile(path.join(planDir, `${id}.json`), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
      const analysis = analyzePlan(plan);
      entries.push({
        id,
        label: item.label,
        pageStart: item.pageStart,
        indexOnPage: item.indexOnPage,
        blueprintChars: item.blueprint.length,
        analysis,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ id, label: item.label, error: message });
      console.error(`  ! decode failed ${id}: ${message}`);
    }
  }

  const catalog = {
    source: BASE,
    topicId: TOPIC_ID,
    generatedAt: new Date().toISOString(),
    pages: offsets,
    scraped: scraped.length,
    unique: unique.length,
    decoded: entries.length,
    errors,
    entries,
  };

  await writeFile(path.join(out, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  await writeFile(path.join(out, "patterns.md"), renderPatternsMd(catalog, BASE), "utf8");

  console.error(`Wrote ${path.join(out, "catalog.json")}`);
  console.error(`Wrote ${path.join(out, "patterns.md")}`);
  console.error(`Plans: ${planDir}/  Raw: ${rawDir}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
