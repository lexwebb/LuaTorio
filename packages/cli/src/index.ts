#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { compile } from "@luatorio/core";

export async function main(argv: string[]): Promise<number> {
  const [command, filePath, ...rest] = argv;

  if (command !== "compile" || rest.length > 0 || !filePath) {
    console.error("Usage: luatorio compile <file>");
    return 1;
  }

  try {
    const source = await readFile(filePath, "utf8");
    const result = compile(source);
    process.stdout.write(`${result.blueprint}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
