export interface ImageData {
  mimeType: string;
  data: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolCallResult {
  toolCallId: string;
  result: string;
  images?: ImageData[];
}

export interface Message {
  role: "user" | "assistant";
  text?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolCallResult[];
  images?: ImageData[];
  metadata?: unknown;
}

export function formatTime(date = new Date()): string {
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Drops leading messages until the first user message with text content. */
export function sanitizeHistory(messages: Message[]): Message[] {
  let start = 0;
  while (start < messages.length) {
    const msg = messages[start];
    if (msg.role !== "user") {
      start++;
      continue;
    }
    if (msg.toolResults) {
      start++;
      continue;
    }
    if (msg.text) break;
    start++;
  }
  return messages.slice(start);
}

export interface ModelResponse {
  text?: string;
  toolCalls?: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
  metadata?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ToolResult = string | { text: string; images?: ImageData[] };

export interface Tool {
  name: string;
  definition: ToolDefinition;
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}

export interface ModelProvider {
  generate(params: {
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
  }): Promise<ModelResponse>;
}

export interface BrianConfig {
  name: string;
  model: ModelProvider;
  tools?: Tool[];
  stateDir?: string;
  slack?: { token: string };
}
