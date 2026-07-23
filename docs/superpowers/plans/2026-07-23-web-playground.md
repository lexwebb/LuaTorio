# Web Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a React+Vite playground in `apps/web` that compiles Lua client-side, looks Factorio-inspired, and deploys to GitHub Pages (issues #14–#17).

**Architecture:** Vite SPA depends on `@luatorio/core` via `workspace:*`. Compile runs in the browser. factorio-css is a visual reference only (reimplement lookalike CSS — no LICENSE upstream). Pages workflow builds core then web with `base: /LuaTorio/`.

**Tech Stack:** pnpm workspaces, Vite, React 19, TypeScript, CodeMirror 6, `@luatorio/core`, GitHub Actions Pages

**Spec:** `docs/superpowers/specs/2026-07-23-web-playground-design.md`

## Global Constraints

- Package location: `apps/web` (`@luatorio/web`, private)
- Workspace: add `apps/*` to `pnpm-workspace.yaml`
- Vite `base: '/LuaTorio/'`
- Do not vendor factorio-css / `bg.png` without a license — reimplement inspired styles
- Do not ship Wube proprietary GUI sprites
- Sync GitHub Project on start/finish of each issue (#14–#17)
- Merge to `main` (no PR required unless asked)
- Keep existing core/cli tests green
- Biome: ignore `apps/web/dist` if needed; may exclude Vite app from root `tsc -b` (web has its own tsconfig)

---

## File Structure

| Path | Responsibility |
|---|---|
| `pnpm-workspace.yaml` | Include `apps/*` |
| `apps/web/package.json` | Vite/React deps; workspace dep on core |
| `apps/web/vite.config.ts` | base path, aliases |
| `apps/web/tsconfig.json` | App TS config |
| `apps/web/index.html` | SPA shell |
| `apps/web/src/main.tsx` | React entry |
| `apps/web/src/App.tsx` | Playground layout |
| `apps/web/src/components/*` | Editor, Toolbar, Output, ExamplePicker |
| `apps/web/src/styles/factorio-theme.css` | Homage theme (reimplemented) |
| `apps/web/src/lib/share.ts` | URL hash encode/decode |
| `apps/web/src/lib/examples.ts` | Bundle examples via `?raw` |
| `.github/workflows/pages.yml` | Deploy Pages |
| `README.md` | Link to playground when live |

---

### Task 1: Scaffold `apps/web` (issue #14)

**Files:** create apps/web skeleton; modify `pnpm-workspace.yaml`; optionally root scripts `dev:web` / `build:web`

**Interfaces:**
- Produces: runnable Vite app that can `import { compile } from "@luatorio/core"` after `pnpm build` of core

- [ ] **Step 1:** Add `apps/*` to `pnpm-workspace.yaml`
- [ ] **Step 2:** Scaffold Vite React-TS app under `apps/web` (manual files preferred over `npm create` to control names)
- [ ] **Step 3:** Set `name: "@luatorio/web"`, `private: true`, dependency `"@luatorio/core": "workspace:*"`
- [ ] **Step 4:** `vite.config.ts` with `base: '/LuaTorio/'` and resolve alias if needed for core
- [ ] **Step 5:** Minimal `App.tsx` that calls `compile("local x = input(\"signal-A\")\noutput(\"signal-B\", x)")` and shows blueprint length or error — proves wiring
- [ ] **Step 6:** `pnpm install && pnpm --filter @luatorio/core build && pnpm --filter @luatorio/web build`
- [ ] **Step 7:** Commit `feat(web): scaffold Vite React app in apps/web`
- [ ] **Step 8:** Sync #14 → Done (checkboxes, close, project Status)

---

### Task 2: Playground UI (issue #15)

**Files:** Editor (CodeMirror), Toolbar, Output, ExamplePicker, share hash helpers

- [ ] **Step 1:** Add `@codemirror/lang-javascript` is wrong — use a Lua mode: `@codemirror/legacy-modes` StreamLanguage lua, or `@replit/codemirror-lang-csharp` no — prefer `@codemirror/lang-javascript` NOT. Use `codemirror` + `@codemirror/lang-…` — for Lua: `StreamLanguage.define(lua)` from `@codemirror/legacy-modes/mode/lua`
- [ ] **Step 2:** Wire Compile / Copy / toggles (string | json | stats)
- [ ] **Step 3:** Load examples from `../../examples/*.lua` via `?raw` imports in `examples.ts`
- [ ] **Step 4:** `share.ts` — compress or encodeURIComponent source into `location.hash`; restore on boot
- [ ] **Step 5:** Error panel for ParseError/SemanticError (message + line/col)
- [ ] **Step 6:** Manual smoke + commit `feat(web): playground editor compile examples and share`
- [ ] **Step 7:** Sync #15 Done

---

### Task 3: Factorio-inspired theme (issue #16)

- [ ] **Step 1:** Author `factorio-theme.css` — dark outer frame, titlebar, shallow panes, beveled buttons (inspired by FFF #243 / factorio-css; no vendored bg.png)
- [ ] **Step 2:** Apply classes to App chrome; theme CodeMirror
- [ ] **Step 3:** Add short NOTICE/comment citing inspiration sources
- [ ] **Step 4:** Commit `feat(web): add Factorio-inspired UI theme`
- [ ] **Step 5:** Sync #16 Done

---

### Task 4: GitHub Pages workflow (issue #17)

- [ ] **Step 1:** Add `.github/workflows/pages.yml` — Node 20, pnpm 9.12.0, build core, build web, upload artifact, deploy-pages
- [ ] **Step 2:** Permissions: `pages: write`, `id-token: write`
- [ ] **Step 3:** README note: enable Pages → Source: GitHub Actions; link will be `https://lexwebb.github.io/LuaTorio/`
- [ ] **Step 4:** Commit `ci: deploy web playground to GitHub Pages`
- [ ] **Step 5:** Sync #17 Done; push `main`

---

## Self-Review

1. Spec coverage: scaffold, UI features, theme (reimplement), Pages — Tasks 1–4.
2. License constraint explicit.
3. Issue sync per task.

## Execution

User requested start immediately — prefer **Subagent-Driven** execution of Tasks 1→4 without further confirmation gates, merging each task to `main` and syncing the board.
