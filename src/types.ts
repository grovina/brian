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
}

export interface ModelResponse {
  text?: string;
  toolCalls?: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
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

export interface WakeResult {
  active: boolean;
  nextWakeMinutes?: number;
}

export interface WakeStrategy {
  start(handler: () => Promise<WakeResult>): Promise<void>;
  stop(): Promise<void>;
}

export interface BrianConfig {
  name: string;
  model: ModelProvider;
  wake: WakeStrategy;
  tools?: (Tool | Tool[])[];
  mcp?: string | string[];
  instructions?: string;
  stateDir?: string;
}
