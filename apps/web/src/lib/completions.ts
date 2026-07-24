import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { PLACE_ENTITIES, SIGNAL_CATALOG } from "./signal-catalog.js";

const BUILTIN_COMPLETIONS: Completion[] = [
  {
    label: "input",
    type: "function",
    detail: "Read a circuit input signal",
    info: 'input("signal-A")',
  },
  {
    label: "output",
    type: "function",
    detail: "Declare a circuit output",
    info: 'output("signal-B", expr)',
  },
  {
    label: "place",
    type: "function",
    detail: "Place a non-combinator entity",
    info: 'place("wooden-chest", x, y)',
  },
  {
    label: "tick",
    type: "function",
    detail: "Clocked loop barrier",
    info: "Last statement in while/for body",
  },
  { label: "sr", type: "function", detail: "Cookbook SR latch", info: "q = sr(q, set, reset)" },
  {
    label: "each_latch",
    type: "function",
    detail: "EACH-tag sticky bag",
    info: 'each_latch(level, "signal-A", high, …)',
  },
  {
    label: "bag_const",
    type: "function",
    detail: "Constant multi-signal bag",
    info: 'bag_const("signal-A", 10, …)',
  },
  {
    label: "bag_arith",
    type: "function",
    detail: "Pairwise EACH arithmetic",
    info: 'bag_arith("/", left, right)',
  },
  {
    label: "bag_filter",
    type: "function",
    detail: "Include / exclude / limit bags",
    info: 'bag_filter("include", data, mask)',
  },
  {
    label: "bag_test",
    type: "function",
    detail: "ANYTHING / EVERYTHING predicate",
    info: 'bag_test("any", ">", bag, 0)',
  },
  { label: "edge", type: "function", detail: "Rising-edge pulse", info: "edge(level)" },
  {
    label: "signal_count",
    type: "function",
    detail: "Count nonzero args",
    info: "signal_count(a, b, …)",
  },
  {
    label: "signal_at",
    type: "function",
    detail: "Nth-largest nonzero arg",
    info: "signal_at(0, a, b, …)",
  },
  {
    label: "signal_at_asc",
    type: "function",
    detail: "Nth-smallest nonzero arg",
    info: "signal_at_asc(0, a, b, …)",
  },
  {
    label: "local function",
    type: "keyword",
    detail: "Inlined helper (v3)",
    apply: "local function name(x)\n  return x\nend\n",
  },
  {
    label: "while",
    type: "keyword",
    detail: "Clocked while loop",
    apply: "while cond do\n  tick()\nend\n",
  },
];

const BAG_FILTER_MODES = ["include", "exclude", "limit"] as const;
const BAG_TEST_KINDS = ["any", "every"] as const;
const BAG_ARITH_OPS = ["+", "-", "*", "/", "%"] as const;

export type StringCompletionKind =
  | "signal"
  | "place"
  | "bag_filter_mode"
  | "bag_test_kind"
  | "bag_arith_op";

/**
 * Cheap leftward scan: are we inside a string that is a known call's signal/entity/mode arg?
 * Returns the completion kind and the prefix typed so far inside the quotes.
 */
export function detectStringCompletionContext(
  textBeforeCursor: string,
): { kind: StringCompletionKind; prefix: string } | undefined {
  const match = textBeforeCursor.match(/["']([^"']*)$/);
  if (!match) {
    return undefined;
  }
  const prefix = match[1] ?? "";
  const beforeQuote = textBeforeCursor.slice(0, textBeforeCursor.length - prefix.length - 1);
  const trimmed = beforeQuote.replace(/\s+$/u, "");

  // place("…
  if (/\bplace\s*\(\s*$/u.test(trimmed)) {
    return { kind: "place", prefix };
  }

  // input("… or output("…
  if (/\b(?:input|output)\s*\(\s*$/u.test(trimmed)) {
    return { kind: "signal", prefix };
  }

  // bag["… or { ["…
  if (/(?:\[[\s]*$|\{\s*\[)$/u.test(trimmed) || /\[[\s]*$/u.test(trimmed)) {
    return { kind: "signal", prefix };
  }

  // bag_filter("mode
  if (/\bbag_filter\s*\(\s*$/u.test(trimmed)) {
    return { kind: "bag_filter_mode", prefix };
  }

  // bag_test("any|/every
  if (/\bbag_test\s*\(\s*$/u.test(trimmed)) {
    return { kind: "bag_test_kind", prefix };
  }

  // bag_arith("/
  if (/\bbag_arith\s*\(\s*$/u.test(trimmed)) {
    return { kind: "bag_arith_op", prefix };
  }

  // bag_const("signal or each_latch(…, "signal — signal slots after a comma (or start)
  if (/\b(?:bag_const|each_latch)\s*\([^)]*$/u.test(trimmed)) {
    // Odd-position string among comma-separated args tends to be a signal name for bag_const
    // (signal, count, signal, count…). For each_latch: level, signal, high.
    const argsChunk = trimmed.replace(/^.*\b(?:bag_const|each_latch)\s*\(/u, "");
    const commaCount = (argsChunk.match(/,/g) ?? []).length;
    if (/\beach_latch\b/u.test(trimmed)) {
      if (commaCount % 3 === 1) {
        return { kind: "signal", prefix };
      }
    } else if (commaCount % 2 === 0) {
      return { kind: "signal", prefix };
    }
  }

  return undefined;
}

/** Options for a string-completion kind, filtered by prefix (case-insensitive). */
export function stringCompletionOptions(kind: StringCompletionKind, prefix: string): string[] {
  const lower = prefix.toLowerCase();
  const catalog: readonly string[] = (() => {
    switch (kind) {
      case "signal":
        return SIGNAL_CATALOG;
      case "place":
        return PLACE_ENTITIES;
      case "bag_filter_mode":
        return BAG_FILTER_MODES;
      case "bag_test_kind":
        return BAG_TEST_KINDS;
      case "bag_arith_op":
        return BAG_ARITH_OPS;
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
  })();
  return catalog.filter((name) => name.toLowerCase().startsWith(lower));
}

function builtinCompletionResult(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[A-Za-z_][\w]*/u);
  if (word === null && !context.explicit) {
    return null;
  }
  const from = word?.from ?? context.pos;
  const typed = word?.text ?? "";
  if (typed.length === 0 && !context.explicit) {
    return null;
  }
  const options = BUILTIN_COMPLETIONS.filter((item) =>
    item.label.toLowerCase().startsWith(typed.toLowerCase()),
  );
  if (options.length === 0) {
    return null;
  }
  return { from, options, validFor: /^[\w]*$/u };
}

/**
 * LuaTorio playground completion source: string catalogs in call args, else builtins.
 * Exported for unit tests via helpers above; CM calls this as a CompletionSource.
 */
export function luatorioCompletions(context: CompletionContext): CompletionResult | null {
  const before = context.state.doc.sliceString(0, context.pos);
  const stringCtx = detectStringCompletionContext(before);
  if (stringCtx !== undefined) {
    const options = stringCompletionOptions(stringCtx.kind, stringCtx.prefix).map(
      (label): Completion => ({
        label,
        type: "constant",
        detail: stringCtx.kind === "place" ? "place() entity" : "signal / mode",
        apply: label,
      }),
    );
    if (options.length === 0) {
      return null;
    }
    const from = context.pos - stringCtx.prefix.length;
    return { from, options, validFor: /^[\w-]*$/u };
  }
  return builtinCompletionResult(context);
}
