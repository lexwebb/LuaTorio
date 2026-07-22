#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { compile } from "@luatorio/core";

const USAGE = "Usage: luatorio compile <file> [-o|--output <path>] [--json] [--name <label>]";

interface CompileArgs {
  filePath?: string;
  outputPath?: string;
  json: boolean;
  name?: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseCompileArgs(argv: string[]): CompileArgs | null {
  let filePath: string | undefined;
  let outputPath: string | undefined;
  let json = false;
  let name: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      return null;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "-o" || arg === "--output") {
      const value = argv[++i];
      if (!value) {
        return null;
      }
      outputPath = value;
      continue;
    }
    if (arg === "--name") {
      const value = argv[++i];
      if (!value) {
        return null;
      }
      name = value;
      continue;
    }
    if (arg.startsWith("-")) {
      return null;
    }
    if (filePath) {
      return null;
    }
    filePath = arg;
  }

  const args: CompileArgs = { json };
  if (filePath !== undefined) {
    args.filePath = filePath;
  }
  if (outputPath !== undefined) {
    args.outputPath = outputPath;
  }
  if (name !== undefined) {
    args.name = name;
  }
  return args;
}

async function readSource(filePath?: string): Promise<string> {
  if (filePath) {
    return readFile(filePath, "utf8");
  }
  return readStdin();
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command !== "compile") {
    console.error(USAGE);
    return 1;
  }

  const args = parseCompileArgs(rest);
  if (!args) {
    console.error(USAGE);
    return 1;
  }

  if (!args.filePath && process.stdin.isTTY) {
    console.error(USAGE);
    return 1;
  }

  try {
    const source = await readSource(args.filePath);
    const result = compile(source, {
      ...(args.json ? { json: true } : {}),
      ...(args.name !== undefined ? { name: args.name } : {}),
    });
    const output = `${result.blueprint}\n`;
    if (args.outputPath) {
      await writeFile(args.outputPath, output);
    } else {
      process.stdout.write(output);
    }
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
