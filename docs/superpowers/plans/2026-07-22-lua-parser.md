# Lua Parser Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `parse(source): Chunk` and `ParseError` to `@luatorio/core` via a thin `luaparse` wrapper (issue #4).

**Architecture:** New `packages/core/src/parse.ts` wraps `luaparse.parse` with `{ locations: true, luaVersion: "5.3" }`, maps luaparse `SyntaxError` (with `.line` / `.column`) to our `ParseError`, and re-exports from the package entry. No semantic analysis and no `compile()` wiring.

**Tech Stack:** `luaparse@0.3.x`, `@types/luaparse`, Vitest, TypeScript (existing monorepo)

**Spec:** `docs/superpowers/specs/2026-07-22-lua-parser-design.md`

## Global Constraints

- Package: `@luatorio/core` only (do not change CLI behavior beyond what re-exports imply)
- AST typing: re-export luaparse `Chunk` — do not invent a custom AST
- Errors: throw `ParseError` with `message`, `line`, `column` — not a plain `Error`
- Empty / comments-only source must succeed (no throw)
- `compile()` remains stub throwing `Error("not implemented")`
- No semantic rejection of `while` / `function` (issue #5)
- pnpm workspaces; Biome for lint/format
- Follow existing ESM / NodeNext patterns in `packages/core`
- Sync GitHub Project when starting/finishing (`.cursor/skills/github-project-sync`)

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/core/package.json` | Add `luaparse` dependency and `@types/luaparse` (dev or dep — prefer dep for types if needed at publish; for private package, `dependencies: luaparse` + `devDependencies: @types/luaparse` is fine) |
| `packages/core/src/parse.ts` | `ParseError` class + `parse()` wrapper |
| `packages/core/src/parse.test.ts` | Unit tests |
| `packages/core/src/index.ts` | Re-export `parse`, `ParseError`, type `Chunk` |

---

### Task 1: `parse()` + `ParseError` with TDD

**Files:**
- Create: `packages/core/src/parse.ts`
- Create: `packages/core/src/parse.test.ts`
- Modify: `packages/core/package.json`

**Interfaces:**
- Consumes: `luaparse.parse(code, options?)` → `Chunk`; on failure throws object with `message`, `line`, `column`
- Produces:
  - `export class ParseError extends Error { readonly line: number; readonly column: number; constructor(message: string, line: number, column: number) }`
  - `export function parse(source: string): Chunk`

- [ ] **Step 1: Add dependencies**

From repo root:

```bash
pnpm add luaparse --filter @luatorio/core
pnpm add -D @types/luaparse --filter @luatorio/core
```

Expected: `packages/core/package.json` lists `luaparse` under `dependencies` and `@types/luaparse` under `devDependencies`; lockfile updated.

- [ ] **Step 2: Write failing tests**

Create `packages/core/src/parse.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm test -- packages/core/src/parse.test.ts
```

Expected: FAIL — cannot resolve `./parse.js` / `ParseError` not found.

- [ ] **Step 4: Implement `packages/core/src/parse.ts`**

```typescript
import luaparse from "luaparse";
import type { Chunk } from "luaparse";

export type { Chunk };

export class ParseError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column: number) {
    super(message);
    this.name = "ParseError";
    this.line = line;
    this.column = column;
  }
}

function isLuaparseSyntaxError(
  error: unknown,
): error is Error & { line: number; column: number } {
  return (
    error instanceof Error &&
    typeof (error as { line?: unknown }).line === "number" &&
    typeof (error as { column?: unknown }).column === "number"
  );
}

export function parse(source: string): Chunk {
  try {
    return luaparse.parse(source, {
      locations: true,
      luaVersion: "5.3",
    });
  } catch (error) {
    if (isLuaparseSyntaxError(error)) {
      throw new ParseError(error.message, error.line, error.column);
    }
    throw error;
  }
}
```

**CJS import note:** `luaparse` is CommonJS. If `import luaparse from "luaparse"` fails under `verbatimModuleSyntax` / Vitest:

1. Prefer `import { createRequire } from "node:module"; const require = createRequire(import.meta.url); const luaparse = require("luaparse") as typeof import("luaparse");`
2. Or `import * as luaparseNamespace from "luaparse"` and call `(luaparseNamespace as typeof import("luaparse")).parse` / `.default.parse` after checking which shape Vitest resolves.

Pick the first approach that typechecks and passes tests; do not add `allowSyntheticDefaultImports` hacks that weaken the shared tsconfig.

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm test -- packages/core/src/parse.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/core/src/parse.ts packages/core/src/parse.test.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(core): add luaparse wrapper with ParseError

EOF
)"
```

---

### Task 2: Package exports + verification

**Files:**
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `parse`, `ParseError`, `Chunk` from `./parse.js`
- Produces: same symbols available from `@luatorio/core` entry

- [ ] **Step 1: Write a failing import smoke test (extend existing or add)**

Add to `packages/core/src/compile.test.ts` **or** create a one-liner in `parse.test.ts` that imports from the package entry — prefer adding to `parse.test.ts` a describe block is unnecessary; instead add this test file `packages/core/src/index.exports.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { ParseError, parse, compile } from "./index.js";

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
```

- [ ] **Step 2: Run to verify failure (missing re-exports)**

```bash
pnpm test -- packages/core/src/index.exports.test.ts
```

Expected: FAIL — `parse` / `ParseError` not exported from `./index.js`.

- [ ] **Step 3: Update `packages/core/src/index.ts`**

```typescript
export interface CompileOptions {
  name?: string;
  optimize?: boolean;
  json?: boolean;
}

export interface CompileResult {
  blueprint: string;
  stats: {
    combinators: number;
    wires: number;
  };
  warnings: string[];
}

export function compile(_source: string, _options?: CompileOptions): CompileResult {
  throw new Error("not implemented");
}

export { parse, ParseError } from "./parse.js";
export type { Chunk } from "./parse.js";
```

- [ ] **Step 4: Run full verification**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all exit 0.

If Biome complains about formatting, run `pnpm format` and include those files in the commit.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/index.exports.test.ts
git commit -m "$(cat <<'EOF'
feat(core): export parse and ParseError from package entry

EOF
)"
```

- [ ] **Step 6: GitHub Project sync (finish)**

Per `.cursor/skills/github-project-sync/SKILL.md`:

1. Check off acceptance criteria on issue #4 body
2. Set project Status → `Done`
3. Close issue #4 with `--reason completed` and a short comment
4. Confirm with `gh issue view 4 --repo lexwebb/LuaTorio --json state,projectItems`

---

## Self-Review

1. **Spec coverage:** parse API, ParseError, luaparse dep, tests (valid/invalid/empty/comments), re-exports — Tasks 1–2. Out of scope items omitted.
2. **Placeholders:** CJS import fallback is concrete (ordered options), not TBD.
3. **Type consistency:** `parse(source: string): Chunk`, `ParseError` fields match the design doc.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-lua-parser.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks

**2. Inline Execution** — execute in this session with checkpoints

Which approach?
