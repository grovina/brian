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

export interface WakeStrategy {
  start(handler: () => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  tools?(): Tool[];
  promptSection?(): string;
}

export interface BrianConfig {
  name: string;
  model: ModelProvider;
  wake: WakeStrategy;
  tools?: Tool[];
  mcp?: string | string[];
  instructions?: string;
  stateDir?: string;
}
