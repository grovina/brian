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
        CLOUDSDK_CORE_DISABLE_PROMPTS:
          process.env.CLOUDSDK_CORE_DISABLE_PROMPTS ?? "1",
        CLOUDSDK_PAGER: process.env.CLOUDSDK_PAGER ?? "",
      },
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeoutHandle: NodeJS.Timeout | null = null;

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (proc.exitCode === null) {
            proc.kill("SIGKILL");
          }
        }, 5_000);
      }, timeoutMs);
    }

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));

    proc.on("close", (code, signal) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
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
