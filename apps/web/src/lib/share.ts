/**
 * Encodes/decodes playground state (source + view mode) into a URL-safe, unicode-safe base64
 * fragment so a link can restore an editor session without any server-side storage.
 */
export type ViewMode = "blueprint" | "json" | "stats" | "simulate";

const VIEW_MODES: readonly ViewMode[] = ["blueprint", "json", "stats", "simulate"];

export interface ShareState {
  source: string;
  mode: ViewMode;
}

function isViewMode(value: string): value is ViewMode {
  return (VIEW_MODES as readonly string[]).includes(value);
}

function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(encoded: string): string | undefined {
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

/** Builds a `#s=<base64>&m=<mode>` fragment (including the leading `#`) for `location.hash`. */
export function encodeShareHash(state: ShareState): string {
  const params = new URLSearchParams({ s: encodeBase64Url(state.source), m: state.mode });
  return `#${params.toString()}`;
}

/** Parses a `location.hash` value back into `ShareState`, or `undefined` if it holds no source. */
export function decodeShareHash(hash: string): ShareState | undefined {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!trimmed) {
    return undefined;
  }

  const params = new URLSearchParams(trimmed);
  const encodedSource = params.get("s");
  if (encodedSource === null) {
    return undefined;
  }

  const source = decodeBase64Url(encodedSource);
  if (source === undefined) {
    return undefined;
  }

  const modeParam = params.get("m");
  const mode = modeParam !== null && isViewMode(modeParam) ? modeParam : "blueprint";
  return { source, mode };
}
