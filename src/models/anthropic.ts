import Anthropic from "@anthropic-ai/sdk";
import type {
  ModelProvider,
  ModelResponse,
  Message,
  ToolDefinition,
  ToolCall,
} from "../types.js";

// Runtime model adapter.
// Operational provider/model changes belong in config (/etc/brian/env), avoid edits here.

export interface AnthropicConfig {
  apiKey?: string;
  model?: string;
}

export class AnthropicModel implements ModelProvider {
  private client: Anthropic;
  private model: string;

  constructor(config: AnthropicConfig = {}) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model ?? "claude-sonnet-4-20250514";
  }

  async generate(params: {
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
  }): Promise<ModelResponse> {
    const messages = this.toAnthropicMessages(params.messages);
    const tools: Anthropic.Tool[] = params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16384,
      system: params.systemPrompt,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    });

    const text = response.content
      .filter(
        (block): block is Anthropic.TextBlock => block.type === "text"
      )
      .map((block) => block.text)
      .join("");

    const toolCalls: ToolCall[] = response.content
      .filter(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === "tool_use"
      )
      .map((block) => ({
        id: block.id,
        name: block.name,
        args: block.input as Record<string, unknown>,
      }));

    return {
      text: text || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  private toAnthropicMessages(
    messages: Message[]
  ): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        if (msg.toolResults && msg.toolResults.length > 0) {
          const content: Anthropic.ToolResultBlockParam[] =
            msg.toolResults.map((tr) => {
              if (tr.images && tr.images.length > 0) {
                return {
                  type: "tool_result" as const,
                  tool_use_id: tr.toolCallId,
                  content: [
                    { type: "text" as const, text: tr.result },
                    ...tr.images.map((img) => ({
                      type: "image" as const,
                      source: {
                        type: "base64" as const,
                        media_type: img.mimeType as
                          | "image/jpeg"
                          | "image/png"
                          | "image/gif"
                          | "image/webp",
                        data: img.data,
                      },
                    })),
                  ],
                };
              }
              return {
                type: "tool_result" as const,
                tool_use_id: tr.toolCallId,
                content: tr.result,
              };
            });
          result.push({ role: "user", content });
        } else {
          const content: Anthropic.ContentBlockParam[] = [];
          if (msg.text) {
            content.push({ type: "text", text: msg.text });
          }
          if (msg.images) {
            for (const img of msg.images) {
              content.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: img.mimeType as
                    | "image/jpeg"
                    | "image/png"
                    | "image/gif"
                    | "image/webp",
                  data: img.data,
                },
              });
            }
          }
          result.push({
            role: "user",
            content: content.length > 0 ? content : (msg.text ?? ""),
          });
        }
      } else {
        const content: (
          | Anthropic.TextBlockParam
          | Anthropic.ToolUseBlockParam
        )[] = [];
        if (msg.text) {
          content.push({ type: "text", text: msg.text });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.args,
            });
          }
        }
        if (content.length > 0) {
          result.push({ role: "assistant", content });
        }
      }
    }

    return result;
  }
}
