import { spawn } from "child_process";
import type { Tool } from "../types.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // Cursor tasks can be slow

function execCursor(
  instruction: string,
  workingDirectory?: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("cursor", ["agent", "--print", "--trust", "--yolo", instruction], {
      cwd: workingDirectory || process.cwd(),
      env: {
        ...process.env,
        CURSOR_API_KEY: process.env.CURSOR_API_KEY,
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
      reject(new Error(`Failed to execute cursor agent: ${err.message}`));
    });
    
    // For headless mode, we might need to close stdin
    proc.stdin.end();
  });
}

export const cursorTool: Tool = {
  name: "cursor_agent",
  definition: {
    name: "cursor_agent",
    description: "Use Cursor's agentic brain for complex coding tasks, refactorings, or project-wide changes. It uses the headless 'cursor agent' CLI.",
    parameters: {
      type: "object",
      properties: {
        instruction: {
          type: "string",
          description: "Detailed instruction for the coding task",
        },
        working_directory: {
          type: "string",
          description: "Working directory for the command",
        },
      },
      required: ["instruction"],
    },
  },
  async execute(input) {
    const { instruction, working_directory } = input as {
      instruction: string;
      working_directory?: string;
    };
    
    if (!process.env.CURSOR_API_KEY) {
      return "Error: CURSOR_API_KEY is not set in environment.";
    }

    return execCursor(instruction, working_directory);
  },
};
