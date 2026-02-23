import {
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type Part,
} from "@google/genai";
import type {
  ModelProvider,
  ModelResponse,
  Message,
  ToolDefinition,
  ToolCall,
} from "../types.js";

export interface VertexAIConfig {
  project: string;
  region?: string;
  model?: string;
}

export class VertexAIModel implements ModelProvider {
  private ai: GoogleGenAI;
  private model: string;

  constructor(config: VertexAIConfig) {
    this.ai = new GoogleGenAI({
      vertexai: true,
      project: config.project,
      location: config.region ?? "europe-west1",
    });
    this.model = config.model ?? "gemini-3-flash-preview";
  }

  async generate(params: {
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
  }): Promise<ModelResponse> {
    const contents = this.toGeminiContents(params.messages);
    const functionDeclarations = params.tools.map((d) => ({
      name: d.name,
      description: d.description,
      parameters: d.parameters,
    }));

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction: params.systemPrompt,
        tools:
          functionDeclarations.length > 0
            ? [{ functionDeclarations }]
            : undefined,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const parts: Part[] =
      response.candidates?.[0]?.content?.parts ?? [];

    const text = parts
      .filter((p: any) => p.text)
      .map((p: any) => p.text)
      .join("");

    const toolCalls: ToolCall[] = (response.functionCalls ?? []).map(
      (fc) => ({
        id: fc.name!,
        name: fc.name!,
        args: (fc.args as Record<string, unknown>) ?? {},
      })
    );

    return {
      text: text || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }

  private toGeminiContents(messages: Message[]): Content[] {
    const contents: Content[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        if (msg.toolResults && msg.toolResults.length > 0) {
          const parts: Part[] = [];
          for (const tr of msg.toolResults) {
            parts.push({
              functionResponse: {
                name: tr.toolCallId,
                response: { result: tr.result },
              },
            });
            if (tr.images) {
              for (const img of tr.images) {
                parts.push({
                  inlineData: { data: img.data, mimeType: img.mimeType },
                });
              }
            }
          }
          contents.push({ role: "user", parts });
        } else {
          contents.push({
            role: "user",
            parts: [{ text: msg.text ?? "" }],
          });
        }
      } else {
        const parts: Part[] = [];
        if (msg.text) {
          parts.push({ text: msg.text });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: { name: tc.name, args: tc.args },
            });
          }
        }
        if (parts.length > 0) {
          contents.push({ role: "model", parts });
        }
      }
    }

    return contents;
  }
}
