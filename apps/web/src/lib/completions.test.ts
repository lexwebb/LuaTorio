import { describe, expect, it } from "vitest";
import {
  detectStringCompletionContext,
  stringCompletionOptions,
} from "./completions.js";
import { PLACE_ENTITIES, SIGNAL_CATALOG } from "./signal-catalog.js";

describe("signal-catalog", () => {
  it("includes virtual signal-A and iron-plate", () => {
    expect(SIGNAL_CATALOG).toContain("signal-A");
    expect(SIGNAL_CATALOG).toContain("iron-plate");
  });

  it("lists the place() allowlist", () => {
    expect(PLACE_ENTITIES).toEqual([
      "wooden-chest",
      "small-lamp",
      "medium-electric-pole",
    ]);
  });
});

describe("string completion context", () => {
  it("detects input/output signal strings", () => {
    expect(detectStringCompletionContext('local a = input("sig')).toMatchObject({
      kind: "signal",
      prefix: "sig",
    });
    expect(detectStringCompletionContext('output("')).toMatchObject({
      kind: "signal",
      prefix: "",
    });
  });

  it("detects place() entity strings", () => {
    expect(detectStringCompletionContext('place("woo')).toMatchObject({
      kind: "place",
      prefix: "woo",
    });
  });

  it("detects bag_const signal slots", () => {
    expect(detectStringCompletionContext('bag_const("signal-')).toMatchObject({
      kind: "signal",
      prefix: "signal-",
    });
    expect(detectStringCompletionContext('bag_const("signal-A", 1, "s')).toMatchObject({
      kind: "signal",
      prefix: "s",
    });
  });

  it("filters catalog options by prefix", () => {
    expect(stringCompletionOptions("place", "woo")).toEqual(["wooden-chest"]);
    expect(stringCompletionOptions("signal", "signal-A")).toContain("signal-A");
    expect(stringCompletionOptions("bag_filter_mode", "inc")).toEqual(["include"]);
  });

  it("does not treat arbitrary strings as signal contexts", () => {
    expect(detectStringCompletionContext('local s = "sig')).toBeUndefined();
  });
});
