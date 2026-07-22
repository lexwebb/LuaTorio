export interface CompileOptions {
  name?: string;
  optimize?: boolean;
  json?: boolean;
}

export interface CompileResult {
  blueprint: string;
  stats: {
    combinators: number;
    wires: number;
  };
  warnings: string[];
}

export function compile(_source: string, _options?: CompileOptions): CompileResult {
  throw new Error("not implemented");
}
