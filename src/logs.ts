const DEFAULT_LOG_MAX_LEN = 220;
const DEFAULT_PRETTY_MAX_STRING_LEN = 2000;
const DEFAULT_PRETTY_MAX_ARRAY_ITEMS = 20;
const DEFAULT_PRETTY_MAX_OBJECT_KEYS = 40;
const DEFAULT_PRETTY_MAX_DEPTH = 6;

export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function clip(text: string, maxLen = DEFAULT_LOG_MAX_LEN): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

export function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function indentBlock(text: string, spaces = 4): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? `${prefix}${line}` : ""))
    .join("\n");
}

export function log(message: string, context?: unknown): void {
  console.log(message);
  if (typeof context === "undefined") return;
  if (typeof context === "string") {
    console.log(indentBlock(context));
    return;
  }
  console.log(indentBlock(prettyJson(context)));
}

export function logError(message: string, context?: unknown): void {
  console.error(message);
  if (typeof context === "undefined") return;
  if (typeof context === "string") {
    console.error(indentBlock(context));
    return;
  }
  console.error(indentBlock(prettyJson(context)));
}

function truncateString(text: string, maxLen = DEFAULT_PRETTY_MAX_STRING_LEN): string {
  if (text.length <= maxLen) return text;
  const dropped = text.length - maxLen;
  return `${text.slice(0, maxLen)}... [truncated ${dropped} chars]`;
}

function toLogValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return truncateString(value);
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "undefined") {
    return "[undefined]";
  }

  if (typeof value === "function") {
    return "[function]";
  }

  if (typeof value === "symbol") {
    return value.toString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
      stack: value.stack ? truncateString(value.stack) : undefined,
    };
  }

  if (depth >= DEFAULT_PRETTY_MAX_DEPTH) {
    return "[max depth reached]";
  }

  if (Array.isArray(value)) {
    const slice = value.slice(0, DEFAULT_PRETTY_MAX_ARRAY_ITEMS);
    const items = slice.map((item) => toLogValue(item, depth + 1));
    if (value.length > DEFAULT_PRETTY_MAX_ARRAY_ITEMS) {
      items.push(`[${value.length - DEFAULT_PRETTY_MAX_ARRAY_ITEMS} more items]`);
    }
    return items;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    const limited = entries.slice(0, DEFAULT_PRETTY_MAX_OBJECT_KEYS);
    for (const [key, nested] of limited) {
      out[key] = toLogValue(nested, depth + 1);
    }
    if (entries.length > DEFAULT_PRETTY_MAX_OBJECT_KEYS) {
      out.__truncated_keys__ = entries.length - DEFAULT_PRETTY_MAX_OBJECT_KEYS;
    }
    return out;
  }

  return String(value);
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(toLogValue(value), null, 2);
  } catch {
    return "\"[unserializable]\"";
  }
}
