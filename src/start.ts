import path from "path";
import { homedir } from "os";
import { Brian } from "./brian.js";
import { AutonomousWake } from "./wake/autonomous.js";
import { bash } from "./tools/index.js";
import type { ModelProvider } from "./types.js";

const name = process.env.BRIAN_NAME;
if (!name) {
  console.error("BRIAN_NAME not set");
  process.exit(1);
}

const stateDir = process.env.BRIAN_STATE_DIR ?? path.join(homedir(), ".brian");

async function createModel(): Promise<ModelProvider> {
  const provider = process.env.MODEL_PROVIDER ?? "vertex-ai";

  if (provider === "vertex-ai") {
    const { VertexAIModel } = await import("./models/vertex-ai.js");
    return new VertexAIModel({
      project: process.env.GCP_PROJECT!,
      region: process.env.VERTEX_AI_LOCATION ?? "global",
    });
  }

  const { AnthropicModel } = await import("./models/anthropic.js");
  return new AnthropicModel({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
}

const brian = new Brian({
  name,
  model: await createModel(),
  wake: new AutonomousWake(),
  tools: [bash],
  mcp: path.join(stateDir, "mcp"),
  instructions: path.join(stateDir, "instructions.md"),
  stateDir,
});

await brian.start();
