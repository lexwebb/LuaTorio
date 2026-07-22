import { describe, expect, it } from "vitest";
import { parse, ParseError } from "./parse.js";

describe("parse", () => {
  it("parses a simple local assignment", () => {
    const ast = parse("local x = 1");
    expect(ast.type).toBe("Chunk");
    expect(ast.body.length).toBeGreaterThan(0);
  });

  it("throws ParseError with line and column on invalid syntax", () => {
    expect(() => parse("local =")).toThrow(ParseError);
    try {
      parse("local =");
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      const parseError = error as ParseError;
      expect(parseError.line).toBe(1);
      expect(parseError.column).toBeGreaterThan(0);
      expect(parseError.message.length).toBeGreaterThan(0);
    }
  });

  it("accepts empty source", () => {
    const ast = parse("");
    expect(ast.type).toBe("Chunk");
    expect(ast.body).toEqual([]);
  });

  it("accepts comments-only source", () => {
    const ast = parse("-- just a comment\n");
    expect(ast.type).toBe("Chunk");
    expect(ast.body).toEqual([]);
  });
});
