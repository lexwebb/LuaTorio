import { autocompletion } from "@codemirror/autocomplete";
import { StreamLanguage } from "@codemirror/language";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { linter, lintGutter } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef } from "react";
import { luatorioCompletions } from "../lib/completions.js";
import { diagnose } from "../lib/diagnostics.js";

export interface EditorProps {
  value: string;
  onChange: (value: string) => void;
}

const luaLanguage = StreamLanguage.define(lua);

const luatorioLinter = linter((view) => diagnose(view.state.doc.toString()), { delay: 250 });

/** CodeMirror 6 editor with Lua highlight, live diagnostics, and LuaTorio completions. */
export function Editor({ value, onChange }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  // Keep the latest callback available to the update listener without recreating the view.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Create the CodeMirror view once; external `value` changes are applied by the effect below
  // instead of tearing down and rebuilding the editor (which would lose cursor/scroll state).
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once CodeMirror bootstrap
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          luaLanguage,
          luatorioLinter,
          lintGutter(),
          autocompletion({ override: [luatorioCompletions] }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
      parent: container,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const current = view.state.doc.toString();
    if (current === value) {
      return;
    }
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div className="playground-editor" ref={containerRef} />;
}
