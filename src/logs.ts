import type { ToolResult } from "./types.js";

const DEFAULT_LOG_MAX_LEN = 220;

export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function clip(text: string, maxLen = DEFAULT_LOG_MAX_LEN): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

export function formatArgs(args: Record<string, unknown>): string {
  try {
    return clip(JSON.stringify(args));
  } catch {
    return "{unserializable args}";
  }
}

export function formatToolResult(result: ToolResult): string {
  if (typeof result === "string") {
    return clip(oneLine(result));
  }
  const text = clip(oneLine(result.text));
  const imageCount = result.images?.length ?? 0;
  return imageCount > 0 ? `${text} (+${imageCount} images)` : text;
}

export function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
