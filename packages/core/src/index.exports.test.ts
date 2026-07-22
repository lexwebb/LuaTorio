import { describe, expect, it } from "vitest";
import { compile, ParseError, parse } from "./index.js";

describe("@luatorio/core exports", () => {
  it("re-exports parse and ParseError", () => {
    expect(typeof parse).toBe("function");
    expect(parse("local x = 1").type).toBe("Chunk");
    expect(() => parse("local =")).toThrow(ParseError);
  });

  it("keeps compile stub", () => {
    expect(() => compile("")).toThrowError("not implemented");
  });
});
