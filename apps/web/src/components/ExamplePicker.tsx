import type { ChangeEvent } from "react";
import { type Example, examplesByGroup } from "../lib/examples.js";

export interface ExamplePickerProps {
  examples: Example[];
  onSelect: (source: string) => void;
}

/** Dropdown that loads a bundled `examples/*.lua` source into the editor when chosen. */
export function ExamplePicker({ examples, onSelect }: ExamplePickerProps) {
  const groups = examplesByGroup();

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
        {groups.map(({ group, examples: groupExamples }) => (
          <optgroup key={group} label={group}>
            {groupExamples.map((example) => (
              <option key={example.id} value={example.id}>
                {example.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
