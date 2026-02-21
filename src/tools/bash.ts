import { spawn } from "child_process";
import type { Tool } from "../types.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function exec(
  command: string,
  workingDirectory?: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bash", ["-c", command], {
      cwd: workingDirectory || process.cwd(),
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.npm-global/bin:${process.env.PATH}`,
      },
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));

    proc.on("close", (code) => {
      const output = [stdout, stderr].filter(Boolean).join("\n");
      if (code !== 0) {
        resolve(`Exit code ${code}\n${output}`);
      } else {
        resolve(output || "(no output)");
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to execute command: ${err.message}`));
    });
  });
}

export const bashTool: Tool = {
  name: "bash",
  definition: {
    name: "bash",
    description:
      "Execute a shell command. Has access to git, docker, node, and standard unix tools.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        working_directory: {
          type: "string",
          description: "Working directory for the command",
        },
        timeout_seconds: {
          type: "number",
          description: "Timeout in seconds (default: 300)",
        },
      },
      required: ["command"],
    },
  },
  async execute(input) {
    const { command, working_directory, timeout_seconds } = input as {
      command: string;
      working_directory?: string;
      timeout_seconds?: number;
    };
    return exec(command, working_directory, (timeout_seconds || 300) * 1000);
  },
};
