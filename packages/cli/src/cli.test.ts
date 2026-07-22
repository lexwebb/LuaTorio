import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./index.js";

const FIXTURE = "packages/cli/fixtures/minimal.lua";
const INVALID = "packages/cli/src/cli.test.ts";

describe("luatorio cli", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 1 when compile subcommand is missing a file", async () => {
    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean };
    const originalIsTTY = stdin.isTTY;
    stdin.isTTY = true;
    try {
      const code = await main(["compile"]);
      expect(code).toBe(1);
    } finally {
      stdin.isTTY = originalIsTTY;
    }
  });

  it("returns 1 when compile throws", async () => {
    const code = await main(["compile", INVALID]);
    expect(code).toBe(1);
  });

  it("prints blueprint to stdout", async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });

    const code = await main(["compile", FIXTURE]);

    expect(code).toBe(0);
    expect(chunks.join("").trim().startsWith("0")).toBe(true);
  });

  it("writes blueprint to a file with -o", async () => {
    const dir = await mkdtemp(join(tmpdir(), "luatorio-cli-"));
    const outputPath = join(dir, "out.txt");

    try {
      const code = await main(["compile", FIXTURE, "-o", outputPath]);

      expect(code).toBe(0);
      expect((await readFile(outputPath, "utf8")).trim().startsWith("0")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes blueprint to a file with --output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "luatorio-cli-"));
    const outputPath = join(dir, "out.txt");

    try {
      const code = await main(["compile", FIXTURE, "--output", outputPath]);

      expect(code).toBe(0);
      expect((await readFile(outputPath, "utf8")).trim().startsWith("0")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("passes --json to compile", async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });

    const code = await main(["compile", FIXTURE, "--json"]);

    expect(code).toBe(0);
    const plan = JSON.parse(chunks.join("").trim());
    expect(plan.blueprint).toBeDefined();
  });

  it("passes --name to compile", async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });

    const code = await main(["compile", FIXTURE, "--json", "--name", "My Circuit"]);

    expect(code).toBe(0);
    expect(JSON.parse(chunks.join("").trim()).blueprint.label).toBe("My Circuit");
  });
});
