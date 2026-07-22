# Monorepo Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a pnpm workspaces monorepo with TypeScript, Vitest, Biome, stub `@luatorio/core`, thin `@luatorio/cli`, and GitHub Actions CI (issue #3).

**Architecture:** Root pnpm workspace owns shared tooling. `packages/core` exports the public `compile()` API (stub throws). `packages/cli` depends on core via `workspace:*` and exposes the `luatorio` binary. CI runs typecheck, lint, and tests on every push/PR.

**Tech Stack:** pnpm 9.12.0, TypeScript 5.x/7.x (whatever `pnpm add -D typescript` resolves), Vitest 4.x, Biome 2.x, Node >=20, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-07-22-monorepo-scaffold-design.md`

## Global Constraints

- Package manager: pnpm workspaces (not npm/yarn)
- Package names: `@luatorio/core`, `@luatorio/cli`
- Binary name: `luatorio`
- Node engines: `>=20`
- TypeScript: strict mode
- Lint/format: Biome only (no ESLint/Prettier)
- `compile()` throws `Error("not implemented")` — no fake blueprint strings
- No Turborepo/Nx/Changesets
- Do not commit `mcp-config.json` if present

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json` | Root scripts, `packageManager`, workspace root deps |
| `pnpm-workspace.yaml` | Workspace package globs |
| `tsconfig.base.json` | Shared strict TypeScript settings |
| `tsconfig.json` | Root solution config for typecheck |
| `vitest.config.ts` | Test discovery for both packages |
| `biome.json` | Lint + format rules |
| `.gitignore` | node_modules, dist, coverage, lock noise |
| `.npmrc` | `shamefully-hoist=false` defaults (optional; omit if unused) |
| `packages/core/package.json` | `@luatorio/core` package metadata + exports |
| `packages/core/tsconfig.json` | Extends base; emits to `dist/` |
| `packages/core/src/index.ts` | Types + stub `compile()` |
| `packages/core/src/compile.test.ts` | Smoke test for stub |
| `packages/cli/package.json` | `@luatorio/cli` + `bin.luatorio` |
| `packages/cli/tsconfig.json` | Extends base; emits to `dist/` |
| `packages/cli/src/index.ts` | CLI entry: `compile <file>` |
| `packages/cli/src/cli.test.ts` | Smoke test for CLI arg handling |
| `.github/workflows/ci.yml` | install → typecheck → lint → test |

---

### Task 1: Root workspace and shared tooling

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `biome.json`
- Create: `.gitignore`
- Modify: `README.md` (minimal install/test note)

**Interfaces:**
- Consumes: nothing
- Produces: pnpm workspace root; scripts `test`, `typecheck`, `lint`, `format`, `build` (build/typecheck will fully work after Task 2–3)

- [ ] **Step 1: Create `.gitignore`**

```gitignore
node_modules/
dist/
coverage/
*.tsbuildinfo
.DS_Store
mcp-config.json
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 4: Create root `tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "./packages/core" },
    { "path": "./packages/cli" }
  ]
}
```

Note: packages will set `"composite": true` in Task 2/3 so `tsc -b` works. If project references prove painful, fall back to `pnpm -r exec tsc --noEmit` in Task 4 — prefer references first.

- [ ] **Step 5: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.5/schema.json",
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "files": {
    "includes": ["**/*.ts", "**/*.json"],
    "ignore": ["**/dist/**", "**/node_modules/**", "**/coverage/**"]
  }
}
```

If Biome 2.x rejects `files.ignore`, switch to the version’s documented ignore key (`files.includes` with negation, or `assist`/`overrides` per Biome docs after install).

- [ ] **Step 6: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
  },
});
```

- [ ] **Step 7: Create root `package.json`**

```json
{
  "name": "luatorio",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc -b --pretty false",
    "test": "vitest run",
    "lint": "biome check .",
    "format": "biome check --write ."
  },
  "devDependencies": {}
}
```

- [ ] **Step 8: Install root tooling**

Run:

```bash
pnpm add -Dw typescript vitest @biomejs/biome @types/node
```

Expected: `pnpm-lock.yaml` created; `devDependencies` populated with concrete versions.

- [ ] **Step 9: Update `README.md`**

Replace contents with:

```markdown
# LuaTorio

TypeScript compiler from a restricted Lua subset to Factorio 2.0 circuit blueprints.

## Setup

```bash
pnpm install
```

## Scripts

| Command | Description |
|---|---|
| `pnpm test` | Run Vitest |
| `pnpm typecheck` | TypeScript project build check |
| `pnpm lint` | Biome check |
| `pnpm build` | Emit `packages/*/dist` |

See `docs/superpowers/specs/2026-07-22-luatorio-design.md` for the language and pipeline design.
```

- [ ] **Step 10: Commit**

```bash
git add .gitignore pnpm-workspace.yaml tsconfig.base.json tsconfig.json biome.json vitest.config.ts package.json pnpm-lock.yaml README.md
git commit -m "$(cat <<'EOF'
chore: scaffold pnpm workspace root and shared tooling

EOF
)"
```

---

### Task 2: `@luatorio/core` stub + smoke test

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/compile.test.ts`

**Interfaces:**
- Consumes: root TypeScript/Vitest tooling
- Produces:
  - `export interface CompileOptions { name?: string; optimize?: boolean; json?: boolean }`
  - `export interface CompileResult { blueprint: string; stats: { combinators: number; wires: number }; warnings: string[] }`
  - `export function compile(source: string, options?: CompileOptions): CompileResult` — throws `Error("not implemented")`

- [ ] **Step 1: Write the failing smoke test**

Create `packages/core/src/compile.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { compile } from "./index.js";

describe("compile", () => {
  it("throws not implemented", () => {
    expect(() => compile("")).toThrowError("not implemented");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`

Expected: FAIL — cannot resolve `./index.js` / module not found (or similar).

- [ ] **Step 3: Create `packages/core/package.json`**

```json
{
  "name": "@luatorio/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

- [ ] **Step 4: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 5: Implement stub `packages/core/src/index.ts`**

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
```

- [ ] **Step 6: Link workspace and run test**

Run:

```bash
pnpm install
pnpm test
```

Expected: PASS — `compile` throws `not implemented`.

If Vitest cannot resolve `.js` imports from TypeScript source, add to `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
});
```

Or change the test import to `./index` (without `.js`) only if NodeNext + Vitest require it — prefer keeping `.js` extensions consistent with NodeNext emit.

- [ ] **Step 7: Commit**

```bash
git add packages/core package.json pnpm-lock.yaml vitest.config.ts
git commit -m "$(cat <<'EOF'
feat(core): add stub compile() API with smoke test

EOF
)"
```

---

### Task 3: `@luatorio/cli` package

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/cli.test.ts`

**Interfaces:**
- Consumes: `compile` from `@luatorio/core`
- Produces: `luatorio` bin; `main(argv: string[]): Promise<number>` returning exit code (0 success, 1 error) for testability

- [ ] **Step 1: Write failing CLI tests**

Create `packages/cli/src/cli.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`

Expected: FAIL — cannot find `packages/cli` module / `main` export.

- [ ] **Step 3: Create `packages/cli/package.json`**

```json
{
  "name": "@luatorio/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "luatorio": "./dist/index.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@luatorio/core": "workspace:*"
  }
}
```

- [ ] **Step 4: Create `packages/cli/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 5: Implement `packages/cli/src/index.ts`**

```typescript
#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { compile } from "@luatorio/core";

export async function main(argv: string[]): Promise<number> {
  const [command, filePath, ...rest] = argv;

  if (command !== "compile" || rest.length > 0 || !filePath) {
    console.error("Usage: luatorio compile <file>");
    return 1;
  }

  try {
    const source = await readFile(filePath, "utf8");
    const result = compile(source);
    process.stdout.write(`${result.blueprint}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

// Compatible direct-run check for Node ESM:
async function runCli(): Promise<void> {
  const entry = process.argv[1];
  if (!entry) return;
  const { pathToFileURL } = await import("node:url");
  if (import.meta.url !== pathToFileURL(entry).href) return;
  const code = await main(process.argv.slice(2));
  process.exitCode = code;
}

void runCli();
```

If the direct-run guard is awkward under Vitest, simplify to:

```typescript
#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { compile } from "@luatorio/core";

export async function main(argv: string[]): Promise<number> {
  const [command, filePath, ...rest] = argv;

  if (command !== "compile" || rest.length > 0 || !filePath) {
    console.error("Usage: luatorio compile <file>");
    return 1;
  }

  try {
    const source = await readFile(filePath, "utf8");
    const result = compile(source);
    process.stdout.write(`${result.blueprint}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
```

Use top-level await (Node 20+ / ESM) for the entry guard. Keep **one** of these implementations — prefer the simplified `pathToFileURL` version.

- [ ] **Step 6: Install workspace link and run tests**

Run:

```bash
pnpm install
pnpm test
```

Expected: all tests PASS (core stub + both CLI cases returning `1`).

- [ ] **Step 7: Build and smoke the bin**

Run:

```bash
pnpm build
pnpm --filter @luatorio/cli exec luatorio compile README.md
```

Expected: prints `not implemented` to stderr and exits non-zero.

Alternative if bin path not on PATH via exec:

```bash
node packages/cli/dist/index.js compile README.md
```

Expected: exit code 1, stderr contains `not implemented`.

- [ ] **Step 8: Commit**

```bash
git add packages/cli package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(cli): add luatorio compile stub CLI

EOF
)"
```

---

### Task 4: Verify root scripts end-to-end

**Files:**
- Modify: `package.json` / `tsconfig*.json` / `biome.json` only if verification reveals gaps
- Modify: `packages/*/package.json` only if exports need a `development` condition for source imports

**Interfaces:**
- Consumes: Tasks 1–3 artifacts
- Produces: green `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`

Expected: exit 0. If `tsc -b` fails on missing composite/references, fix package tsconfigs to match Task 2/3, or change root scripts to:

```json
"typecheck": "pnpm -r --parallel run typecheck",
"build": "pnpm -r run build"
```

and ensure each package `typecheck` script uses `tsc -p tsconfig.json --noEmit`.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`

Expected: exit 0. If Biome flags style issues, run `pnpm format` and commit formatting with the fix (do not disable recommended rules wholesale).

- [ ] **Step 3: Run tests and build once more**

Run:

```bash
pnpm test
pnpm build
```

Expected: both exit 0.

- [ ] **Step 4: Commit any tooling fixes**

Only if Step 1–3 required file changes:

```bash
git add -u
git commit -m "$(cat <<'EOF'
chore: fix root scripts after scaffold verification

EOF
)"
```

If nothing changed, skip this commit.

---

### Task 5: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root scripts from Task 1/4
- Produces: CI job running install → typecheck → lint → test on push/PR

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9.12.0

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint

      - name: Test
        run: pnpm test
```

- [ ] **Step 2: Sanity-check workflow locally (optional)**

If `actionlint` is installed: `actionlint .github/workflows/ci.yml`  
Otherwise skip — rely on GitHub UI after push.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: add pnpm typecheck, lint, and test workflow

EOF
)"
```

- [ ] **Step 4: Acceptance checklist (manual)**

Confirm against issue #3 / scaffold spec:

- [ ] Root `package.json` with pnpm workspaces `packages/core`, `packages/cli`
- [ ] Shared strict TypeScript config
- [ ] Vitest configured; smoke tests pass
- [ ] Biome lint/format baseline
- [ ] `@luatorio/core` exports stub `compile()`
- [ ] `@luatorio/cli` exposes `luatorio` bin
- [ ] `pnpm install` works from root
- [ ] CI workflow present with typecheck + lint + test
- [ ] At least one smoke test for stub `compile`

---

## Self-Review

1. **Spec coverage:** Layout, pnpm, Biome, Vitest, stub API, CLI bin, CI, smoke test — all mapped to Tasks 1–5. Out-of-scope items intentionally omitted.
2. **Placeholders:** None remaining; Biome ignore-key note is a concrete fallback, not TBD.
3. **Type consistency:** `CompileOptions` / `CompileResult` / `compile()` match the design spec; CLI `main(argv): Promise<number>` is stable for tests.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-monorepo-scaffold.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
