import { spawn } from "child_process";
import type { Tool } from "../types.js";

export function selfDeployTool(scriptPath?: string): Tool {
  const script = scriptPath ?? `${process.env.HOME}/deploy-self.sh`;

  return {
    name: "self_deploy",
    definition: {
      name: "self_deploy",
      description:
        "Trigger a self-deployment: pulls latest code, installs dependencies, rebuilds, and restarts the process. The deploy script handles rollback if the new version fails to start.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    async execute() {
      const proc = spawn("nohup", [script], {
        detached: true,
        stdio: "ignore",
      });
      proc.unref();
      return "Self-deploy triggered. The process will restart shortly.";
    },
  };
}
