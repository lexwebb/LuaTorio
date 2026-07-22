import { describe, expect, it } from "vitest";
import { compile } from "./index.js";

describe("compile", () => {
  it("throws not implemented", () => {
    expect(() => compile("")).toThrowError("not implemented");
  });
});
