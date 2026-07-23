import type { ChangeEvent } from "react";
import type { Example } from "../lib/examples.js";

export interface ExamplePickerProps {
  examples: Example[];
  onSelect: (source: string) => void;
}

/** Dropdown that loads a bundled `examples/*.lua` source into the editor when chosen. */
export function ExamplePicker({ examples, onSelect }: ExamplePickerProps) {
  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const example = examples.find((candidate) => candidate.id === event.target.value);
    if (example) {
      onSelect(example.source);
    }
    event.target.value = "";
  }

  return (
    <label className="example-picker">
      <span>Examples</span>
      <select defaultValue="" onChange={handleChange}>
        <option value="" disabled>
          Load an example…
        </option>
        {examples.map((example) => (
          <option key={example.id} value={example.id}>
            {example.label}
          </option>
        ))}
      </select>
    </label>
  );
}
