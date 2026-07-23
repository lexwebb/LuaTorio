# Web Playground Design

**Date:** 2026-07-23  
**Status:** Approved  
**Milestone:** `web`  
**Parent:** [LuaTorio Design Spec](./2026-07-22-luatorio-design.md)

## Summary

Browser playground for LuaTorio: React + Vite SPA in `apps/web`, compiling entirely client-side via `@luatorio/core`. Hosted on GitHub Pages. UI chrome adapted from [drewtato/factorio-css](https://github.com/drewtato/factorio-css) (Factorio-inspired), with CodeMirror 6 for the Lua editor.

## Decisions

| Choice | Decision |
|---|---|
| Stack | React + Vite + TypeScript |
| Location | `apps/web` (add `apps/*` to pnpm workspaces) |
| Compile | In-browser `@luatorio/core` (no worker in MVP) |
| Editor | CodeMirror 6 + Lua highlighting |
| Scope | Richer IDE: examples, string/JSON/stats toggles, shareable URL hash |
| Hosting | GitHub Pages project site (`base: /LuaTorio/`) |
| Look | Adapt factorio-css frames/buttons/panels |

## Product surface

| Area | Behavior |
|---|---|
| Header / titlebar | Brand **LuaTorio**, short tagline, GitHub link |
| Example picker | Load bundled `examples/*.lua` |
| Editor | CodeMirror 6, Lua mode, dominant pane |
| Actions | Compile, Copy blueprint; toggles: blueprint string / JSON / stats |
| Output | Result text; errors with line/column when available |
| Share | Encode source (+ view mode) in URL hash; restore on load |

Pipeline: editor source → `compile(source, { json?, name? })` → render blueprint/JSON/stats or `ParseError` / `SemanticError`.

## Packaging

```
apps/web/
  package.json          # name: @luatorio/web (private)
  vite.config.ts        # base: '/LuaTorio/'
  index.html
  src/
    main.tsx
    App.tsx
    styles/             # factorio-css vendor + overrides
    components/         # Editor, Output, Toolbar, …
  public/
```

- `pnpm-workspace.yaml`: include `apps/*`
- Depend on `@luatorio/core` via `workspace:*`
- Import examples with Vite `?raw` (from repo `examples/` or copied into `apps/web`)
- CI builds `@luatorio/core` before the web app so Vite resolves `dist`

## Visual system (factorio-css)

### Research notes

- [factorio-css](https://github.com/drewtato/factorio-css): unofficial CSS from [FFF #243](https://www.factorio.com/blog/post/fff-243); unmaintained, pre-0.17
- [Raiguard GUI Style Guide](https://man.sr.ht/~raiguard/factorio-gui-style-guide/): in-game mod patterns (reference only)
- [reactorio](https://github.com/maxpowa/reactorio): React-for-mods, not browser
- No maintained React Factorio component library exists

### Adaptation plan

1. Vendor `factorio.css` (+ `bg.png` if license allows) under `apps/web/src/styles/vendor/factorio-css/` with a `NOTICE` attributing drewtato / FFF #243
2. **License gate:** the upstream repo has **no LICENSE file**. Before committing vendored files, either obtain permission, treat as all-rights-reserved and **reimplement** lookalike CSS inspired by the public demo (preferred if unclear), or vendor only if we document risk and keep attribution. Default implementation path if license remains unclear: **reimplement** Factorio-like frames/buttons using FFF #243 + factorio-css as visual reference, without copying `bg.png`
3. Map UI to outer frame, titlebar, shallow content panes, chunky buttons
4. Theme CodeMirror to the dark panel palette
5. Do **not** ship Wube proprietary GUI sprites from the game

## GitHub Pages

- `vite.config.ts`: `base: '/LuaTorio/'`
- Workflow `.github/workflows/pages.yml`: on `main` → `pnpm install` → build core → build web → deploy `apps/web/dist` with `actions/deploy-pages`
- Enable Pages (GitHub Actions source) in repo settings as a one-time manual step if not already

## GitHub Project tracking

Create issues under milestone `web`, add to LuaTorio project:

1. Scaffold `apps/web` + workspace + Vite/React
2. Playground UI (editor, compile, output, examples, share hash)
3. Factorio-css adaptation / theme
4. GitHub Pages deploy workflow

## Out of scope (MVP)

- Web Worker compile
- Blueprint preview / entity canvas — **shipped** as Simulate view (#42/#43)
- Auth, saved cloud snippets
- npm publish of the web app

## Acceptance (MVP done when)

- [ ] `apps/web` builds and runs locally (`pnpm --filter @luatorio/web dev`)
- [ ] Compile works in browser for v1 examples
- [ ] Examples, JSON/stats toggles, copy, share hash work
- [ ] Factorio-inspired chrome applied
- [ ] Pages workflow deploys from `main`
