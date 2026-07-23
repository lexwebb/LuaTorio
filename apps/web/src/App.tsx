import { compile } from "@luatorio/core";
import { useState } from "react";

const SAMPLE_SOURCE = 'local x = input("signal-A")\noutput("signal-B", x)';

export function App() {
  const [result, setResult] = useState<string | null>(null);

  function handleCompile() {
    try {
      const { blueprint } = compile(SAMPLE_SOURCE);
      setResult(`Compiled OK — blueprint length: ${blueprint.length}`);
    } catch (error) {
      setResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <main>
      <h1>LuaTorio Playground</h1>
      <p>Scaffold check: compiling a tiny Lua snippet via @luatorio/core.</p>
      <button type="button" onClick={handleCompile}>
        Compile
      </button>
      {result && <pre>{result}</pre>}
    </main>
  );
}
