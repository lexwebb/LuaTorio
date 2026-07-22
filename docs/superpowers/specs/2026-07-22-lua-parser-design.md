# Lua Parser Integration Design

**Date:** 2026-07-22  
**Status:** Approved  
**Issue:** [#4 — v1: Lua parser integration (luaparse)](https://github.com/lexwebb/LuaTorio/issues/4)  
**Parent:** [LuaTorio Design Spec](./2026-07-22-luatorio-design.md)

## Summary

Add `parse(source): Chunk` to `@luatorio/core` as a thin wrapper around `luaparse`, with structured `ParseError` (line/column). Re-export luaparse AST types. No semantic gating and no `compile()` wiring yet.

## Decisions

| Choice | Decision | Rationale |
|---|---|---|
| AST typing | Re-export luaparse / `@types/luaparse` | Matches “full Lua parser with semantic gating”; #5 owns the subset |
| Errors | Custom `ParseError` with `line` / `column` | Structured for CLI and tests |
| Scope | Thin wrapper only | Keep parse separate from semantic analysis |

## Public API

```typescript
import type { Chunk } from "luaparse";

export class ParseError extends Error {
  readonly line: number;
  readonly column: number;
  constructor(message: string, line: number, column: number);
}

export function parse(source: string): Chunk;
```

Also re-export `ParseError`, `parse`, and `Chunk` (type) from `packages/core/src/index.ts`.

### Behavior

- Call `luaparse.parse(source, { locations: true })` (Lua version: library default unless a specific version is required for 5.x syntax we care about — prefer default / 5.3 if the option is available).
- On success, return the `Chunk` AST unchanged.
- On failure, throw `ParseError` with message and line/column from luaparse (or best-effort extraction from its error message/object).
- Empty source and comments-only source succeed (empty or comment-only chunk); do not throw.
- `compile()` remains the stub that throws `not implemented`.

## Files

| Path | Responsibility |
|---|---|
| `packages/core/src/parse.ts` | `parse()` + `ParseError` |
| `packages/core/src/parse.test.ts` | Unit tests |
| `packages/core/package.json` | `luaparse` dependency + `@types/luaparse` |
| `packages/core/src/index.ts` | Re-exports |

## Tests

- Valid snippet (`local x = 1`) → `Chunk` with statements
- Invalid syntax → `ParseError` with line and column
- Empty string → no throw
- Comments only → no throw

## Out of scope

- Rejecting unsupported constructs (`while`, `function`, etc.) — issue #5
- Wiring `parse` into `compile()`
- IR / emitter changes

## Acceptance criteria

- [ ] `luaparse` dependency added to `packages/core`
- [ ] `parse()` returns typed AST (luaparse `Chunk`)
- [ ] Parse errors include line/column via `ParseError`
- [ ] Unit tests for valid and invalid Lua snippets
- [ ] Comments and empty chunks handled correctly
