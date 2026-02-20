import { spawn } from "child_process";
import type { Tool } from "./index.js";

export const selfDeployTool: Tool = {
  name: "self_deploy",
  definition: {
    name: "self_deploy",
    description:
      "Trigger a self-deployment: pulls latest code from main, installs dependencies, rebuilds, and restarts the process. The deploy script handles rollback if the new version fails to start. Confirm with the user before calling this.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  async execute() {
    const scriptPath = `${process.env.HOME}/deploy-self.sh`;
    const proc = spawn("nohup", [scriptPath], {
      detached: true,
      stdio: "ignore",
    });
    proc.unref();
    return "Self-deploy triggered. The process will restart shortly. If the new version fails, it will automatically roll back.";
  },
};
