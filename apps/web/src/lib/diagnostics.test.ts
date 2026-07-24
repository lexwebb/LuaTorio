import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnostics.js";

describe("diagnose", () => {
  it("returns no diagnostics for empty or whitespace-only source", () => {
    expect(diagnose("")).toEqual([]);
    expect(diagnose("  \n\t")).toEqual([]);
  });

  it("returns a parse diagnostic with a document range", () => {
    const diagnostics = diagnose("local!!!\noutput(\"signal-A\", 1)");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.message.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.from).toBeGreaterThanOrEqual(0);
    expect(diagnostics[0]?.to).toBeGreaterThan(diagnostics[0]?.from ?? 0);
  });

  it("returns a semantic diagnostic for an undefined variable", () => {
    const diagnostics = diagnose('output("signal-A", missing)');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/undefined variable/i);
    expect(diagnostics[0]?.severity).toBe("error");
  });

  it("returns no diagnostics for a valid program", () => {
    expect(diagnose('output("signal-B", input("signal-A") + 1)')).toEqual([]);
  });
});
