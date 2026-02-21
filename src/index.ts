// Core
export { Brian } from "./brian.js";

// Types
export type {
  BrianConfig,
  ModelProvider,
  ModelResponse,
  WakeStrategy,
  WakeResult,
  Tool,
  ToolDefinition,
  ToolResult,
  Message,
  ToolCall,
  ToolCallResult,
  ImageData,
} from "./types.js";

// Model providers
export { VertexAI, type VertexAIConfig } from "./models/vertex-ai.js";

// Wake strategies
export { PeriodicWake, type PeriodicWakeConfig } from "./wake/periodic.js";

// Tools
export { bashTool as bash } from "./tools/bash.js";
export { selfDeployTool as selfDeploy } from "./tools/self-deploy.js";
