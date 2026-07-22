import { describe, expect, it } from "vitest";
import { main } from "./index.js";

describe("luatorio cli", () => {
  it("returns 1 when compile subcommand is missing a file", async () => {
    const code = await main(["compile"]);
    expect(code).toBe(1);
  });

  it("returns 1 when stub compile throws", async () => {
    const code = await main(["compile", "packages/cli/src/cli.test.ts"]);
    expect(code).toBe(1);
  });
});
