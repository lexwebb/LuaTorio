# Web: foreign blueprint import panel

**Date:** 2026-07-24  
**Status:** Implemented  
**Issue:** #83

## Goal

Paste a Factorio blueprint string or JSON plan in the playground, import supported combinators
via `importBlueprint` → `simulateImported`, and show a tick output trace.

## Surface

- New view mode `import` (toolbar).
- Fixture picker loads bundled `packages/core/src/sim/fixtures/*.json`.
- User supplies output ports as `(signal, entity_number)` — foreign BPs do not auto-label ports.
- Errors from `BlueprintImportError` / decode failures shown in the pane.

## Core

`importBlueprint(text, opts?)` wraps JSON.parse or `decodePlan`, then `fromBlueprint`.

## Non-goals

Canvas layout from import positions, URL-hash sharing of blueprints, importing chests/assemblers.
