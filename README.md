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
