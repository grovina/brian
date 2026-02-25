import type { ModelProvider } from "./types.js";

// Model provider is an operational config choice.
// Change it via /etc/brian/env + redeploy, not by editing provider code.
export async function createModel(): Promise<ModelProvider> {
  const provider = process.env.MODEL_PROVIDER?.trim() || "vertex-ai";
  const modelId = process.env.MODEL_ID?.trim();

  if (provider === "vertex-ai") {
    if (!process.env.GCP_PROJECT) {
      throw new Error("GCP_PROJECT not set for MODEL_PROVIDER=vertex-ai");
    }
    const { VertexAIModel } = await import("./models/vertex-ai.js");
    return new VertexAIModel({
      project: process.env.GCP_PROJECT,
      region: process.env.VERTEX_AI_LOCATION ?? "global",
      model: modelId || undefined,
    });
  }

  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY not set for MODEL_PROVIDER=anthropic");
    }
    const { AnthropicModel } = await import("./models/anthropic.js");
    return new AnthropicModel({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: modelId || undefined,
    });
  }

  throw new Error(
    `Unsupported MODEL_PROVIDER: ${provider}. Expected 'vertex-ai' or 'anthropic'.`
  );
}

export async function checkModelConfig(): Promise<void> {
  const model = await createModel();
  await model.generate({
    systemPrompt: "Health check. Reply briefly.",
    messages: [{ role: "user", text: "Reply with OK." }],
    tools: [],
  });
}
