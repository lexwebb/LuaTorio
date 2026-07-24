import { useCallback, useEffect, useState } from "react";
import "./App.css";
import { Editor } from "./components/Editor.js";
import { ExamplePicker } from "./components/ExamplePicker.js";
import { Output } from "./components/Output.js";
import { Toolbar } from "./components/Toolbar.js";
import { type CompileOutcome, runCompile } from "./lib/compile.js";
import { defaultExampleSource, examples } from "./lib/examples.js";
import { decodeShareHash, encodeShareHash, type ViewMode } from "./lib/share.js";

const DEFAULT_SOURCE = defaultExampleSource();

export function App() {
  const [source, setSource] = useState(
    () => decodeShareHash(window.location.hash)?.source ?? DEFAULT_SOURCE,
  );
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => decodeShareHash(window.location.hash)?.mode ?? "blueprint",
  );
  const [outcome, setOutcome] = useState<CompileOutcome>({ status: "idle" });
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [simRunToken, setSimRunToken] = useState(0);

  // Keep the URL shareable: mirror source + view mode into the hash without growing history.
  useEffect(() => {
    window.history.replaceState(null, "", encodeShareHash({ source, mode: viewMode }));
  }, [source, viewMode]);

  const handleCompile = useCallback(() => {
    setOutcome(runCompile(source));
    setCopyStatus("idle");
  }, [source]);

  const handleSimulate = useCallback(() => {
    setViewMode("simulate");
    setSimRunToken((token) => token + 1);
  }, []);

  const handleSelectExample = useCallback((exampleSource: string) => {
    setSource(exampleSource);
    setOutcome({ status: "idle" });
    setCopyStatus("idle");
  }, []);

  const handleCopy = useCallback(() => {
    if (outcome.status !== "success") {
      return;
    }
    navigator.clipboard
      .writeText(outcome.blueprint)
      .then(() => setCopyStatus("copied"))
      .catch(() => setCopyStatus("failed"));
  }, [outcome]);

  return (
    <div className="playground">
      <header className="playground-titlebar">
        <span className="playground-brand-icon" aria-hidden="true">
          ⚙
        </span>
        <div>
          <h1>LuaTorio</h1>
          <p>
            Write LuaTorio source — arithmetic, memory, inlined helpers, multi-signal bags, and
            <code> place()</code> — then compile a Factorio blueprint and simulate the circuit in
            your browser.
          </p>
          <span className="playground-disclaimer">
            Fan-made playground — not affiliated with Wube Software. Combinator icons © Wube (see
            factorio-icons/NOTICE).
          </span>
        </div>
      </header>

      <div className="playground-subheader">
        <ExamplePicker examples={examples} onSelect={handleSelectExample} />
        <Toolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onCompile={handleCompile}
          onSimulate={handleSimulate}
          onCopy={handleCopy}
          copyDisabled={outcome.status !== "success"}
          copyStatus={copyStatus}
        />
      </div>

      <div className="playground-panes">
        <section className="pane">
          <div className="pane-titlebar">Lua Source</div>
          <div className="pane-body">
            <Editor value={source} onChange={setSource} />
          </div>
        </section>
        <section className="pane">
          <div className="pane-titlebar">{viewMode === "simulate" ? "Simulate" : "Result"}</div>
          <div className="pane-body pane-body-scroll">
            <Output
              outcome={outcome}
              viewMode={viewMode}
              source={source}
              simRunToken={simRunToken}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
