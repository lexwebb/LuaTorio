import { describe, expect, it } from "vitest";
import { runFuzz } from "./fuzz.js";
import { reference } from "./reference.js";

describe("reference", () => {
  it("matches free-running counter traces", () => {
    const result = reference(
      `
local x = 0
x = x + 1
output("signal-A", x)
`,
      { ticks: 5 },
    );
    expect(result.ticks.map((t) => t.outputs["signal-A"])).toEqual([1, 2, 3, 4, 5]);
  });

  it("while_count with L=5 reaches 5", () => {
    const result = reference(
      `
local i = 0
local lim = input("signal-L")
while i < lim do
  i = i + 1
  tick()
end
output("signal-A", i)
`,
      { ticks: 8, inputs: { "signal-L": 5 } },
    );
    expect(result.ticks[4]?.outputs["signal-A"]).toBe(5);
    expect(result.ticks[7]?.outputs["signal-A"]).toBe(5);
  });
});

describe("fuzz", () => {
  it("compile→simulate ≡ reference for 100 fixed-seed cases", () => {
    const failure = runFuzz({ seed: 0xc17c_51_7, iterations: 100 });
    expect(failure, failure?.error).toBeUndefined();
  });
});
