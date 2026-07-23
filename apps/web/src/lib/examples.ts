/** Bundled `examples/*.lua` sources (see `docs/superpowers/plans/2026-07-23-web-playground.md` Task 2). */
export interface Example {
  id: string;
  label: string;
  source: string;
}

// Vite inlines every matched file's raw text at build time; the glob is resolved relative to
// this file, so it reaches the repo-root `examples/` directory two levels above `apps/web`.
const modules = import.meta.glob("../../../../examples/*.lua", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const examples: Example[] = Object.entries(modules)
  .map(([path, source]) => {
    const fileName = path.split("/").pop() ?? path;
    const id = fileName.replace(/\.lua$/, "");
    return { id, label: id, source };
  })
  .sort((a, b) => a.label.localeCompare(b.label));
