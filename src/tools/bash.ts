import { spawn } from "child_process";
import type { Tool } from "../types.js";
import { shellEnv, waitForProcessCompletion } from "./process.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function exec(
  command: string,
  workingDirectory?: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bash", ["-c", command], {
      cwd: workingDirectory || process.cwd(),
      env: shellEnv(),
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));

    proc.on("error", (err) => {
      reject(new Error(`Failed to execute command: ${err.message}`));
    });

    void waitForProcessCompletion(proc, timeoutMs).then(
      ({ exitCode, signal, timedOut }) => {
        const output = [stdout, stderr].filter(Boolean).join("\n");
        if (timedOut) {
          const seconds = Math.max(1, Math.round(timeoutMs / 1000));
          resolve(
            `Timed out after ${seconds}s (signal: ${signal ?? "SIGTERM"})\n${output || "(no output)"}`
          );
          return;
        }
        if (signal) {
          resolve(`Terminated by signal ${signal}\n${output || "(no output)"}`);
          return;
        }
        if (exitCode !== 0) {
          resolve(`Exit code ${exitCode}\n${output}`);
        } else {
          resolve(output || "(no output)");
        }
      }
    );
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
