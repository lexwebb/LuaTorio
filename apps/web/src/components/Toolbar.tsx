import type { ViewMode } from "../lib/share.js";

export interface ToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onCompile: () => void;
  onCopy: () => void;
  copyDisabled: boolean;
  copyStatus: "idle" | "copied" | "failed";
}

const VIEW_MODES: Array<{ id: ViewMode; label: string }> = [
  { id: "blueprint", label: "Blueprint" },
  { id: "json", label: "JSON" },
  { id: "stats", label: "Stats" },
];

/** Compile / view-mode toggle / copy actions above the editor and output panes. */
export function Toolbar({ viewMode, onViewModeChange, onCompile, onCopy, copyDisabled, copyStatus }: ToolbarProps) {
  return (
    <div className="toolbar">
      <button type="button" className="toolbar-button toolbar-button-primary" onClick={onCompile}>
        Compile
      </button>
      <div className="toolbar-view-toggle" role="group" aria-label="Output view mode">
        {VIEW_MODES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`toolbar-toggle-button${viewMode === id ? " is-active" : ""}`}
            aria-pressed={viewMode === id}
            onClick={() => onViewModeChange(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <button type="button" className="toolbar-button" onClick={onCopy} disabled={copyDisabled}>
        {copyStatus === "copied" ? "Copied!" : copyStatus === "failed" ? "Copy failed" : "Copy blueprint"}
      </button>
    </div>
  );
}
