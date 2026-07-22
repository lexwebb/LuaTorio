import { describe, expect, it } from "vitest";
import { compile, ParseError, parse } from "./index.js";

describe("@luatorio/core exports", () => {
  it("re-exports parse and ParseError", () => {
    expect(typeof parse).toBe("function");
    expect(parse("local x = 1").type).toBe("Chunk");
    expect(() => parse("local =")).toThrow(ParseError);
  });

  it("compiles a program end to end into a blueprint string", () => {
    const result = compile(`output("signal-B", input("signal-A"))`);
    expect(result.blueprint.startsWith("0")).toBe(true);
  });
});
