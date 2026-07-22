# Monorepo Scaffold Design

**Date:** 2026-07-22  
**Status:** Approved  
**Issue:** [#3 — v1: Monorepo scaffold](https://github.com/lexwebb/LuaTorio/issues/3)  
**Parent:** [LuaTorio Design Spec](./2026-07-22-luatorio-design.md)

## Summary

Set up a pnpm workspaces monorepo with TypeScript (strict), Vitest, Biome, a stub `@luatorio/core` `compile()` API, a thin `@luatorio/cli` package, and GitHub Actions CI. No real compiler behavior yet.

## Decisions

| Choice | Decision | Rationale |
|---|---|---|
| Package manager | pnpm workspaces | Faster installs, stricter deps; layout matches design |
| Lint/format | Biome | Single tool, less config than ESLint + Prettier |
| CI | GitHub Actions on push/PR | Recommended by issue #3 |
| Scope | Lean complete scaffold | Unblocks later issues without redoing wiring |

## Layout

```
luatorio/
├── packages/
│   ├── core/                 # @luatorio/core
│   │   ├── src/index.ts      # stub compile()
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── cli/                  # @luatorio/cli (bin: luatorio)
│       ├── src/index.ts      # thin wrapper → core
│       ├── package.json
│       └── tsconfig.json
├── package.json              # pnpm workspaces root
├── pnpm-workspace.yaml
├── tsconfig.base.json        # strict shared config
├── vitest.config.ts
├── biome.json
├── .github/workflows/ci.yml
└── docs/                     # existing
```

- Workspace packages: `@luatorio/core`, `@luatorio/cli`
- CLI depends on core via `workspace:*`
- Node engines: `>=20`
- pnpm version pinned via `packageManager` field

## Public API (stub)

Match the parent design API shape; implementation throws until later issues land:

```typescript
interface CompileOptions {
  name?: string;
  optimize?: boolean; // default true
  json?: boolean;     // return raw JSON instead of encoded string
}

interface CompileResult {
  blueprint: string;
  stats: { combinators: number; wires: number };
  warnings: string[];
}

function compile(source: string, options?: CompileOptions): CompileResult;
```

`compile()` throws `Error("not implemented")` so callers fail loudly.

## CLI

- Package: `@luatorio/cli`
- Binary name: `luatorio`
- Minimal command: `luatorio compile <file>` reads the file, calls `compile()`, prints result or error to stderr and exits non-zero on failure
- Stub will error until core is implemented

## Tooling

- **TypeScript:** strict mode in `tsconfig.base.json`; packages extend it. No project references yet.
- **Vitest:** root config; colocated `*.test.ts`; `pnpm test` covers both packages.
- **Biome:** lint + format; root scripts `lint` / `format`; checked in CI.
- **Root scripts:** `test`, `typecheck`, `lint`, `build`.

## CI

GitHub Actions workflow on push/PR:

1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm test`

## Acceptance criteria

- [ ] Root `package.json` with pnpm workspaces: `packages/core`, `packages/cli`
- [ ] TypeScript config (strict) shared across packages
- [ ] Vitest configured for unit tests
- [ ] Biome baseline for lint + format
- [ ] `packages/core` exports stub `compile()` matching design API
- [ ] `packages/cli` depends on core and exposes `luatorio` bin
- [ ] `pnpm install` works from root
- [ ] CI workflow runs typecheck, lint, and tests on push/PR
- [ ] At least one smoke test asserting stub `compile` behavior

## Out of scope

- Lua parsing, semantic analysis, IR, emitter
- Real blueprint output
- Publishing to npm
- Turborepo / Nx / Changesets
