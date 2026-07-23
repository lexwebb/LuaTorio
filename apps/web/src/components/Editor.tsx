import { StreamLanguage } from "@codemirror/language";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { EditorState } from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef } from "react";

export interface EditorProps {
  value: string;
  onChange: (value: string) => void;
}

const luaLanguage = StreamLanguage.define(lua);

/** CodeMirror 6 editor with Lua syntax highlighting via `@codemirror/legacy-modes`. */
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
