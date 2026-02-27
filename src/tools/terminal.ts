import fs from "fs/promises";
import path from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import type { Tool } from "../types.js";
import { shellEnv, waitForProcessCompletion } from "./process.js";

const DEFAULT_TIMEOUT_SECONDS = 300;
const DEFAULT_READ_TAIL_CHARS = 4000;
const MAX_OUTPUT_BUFFER_CHARS = 100_000;

type CommandStatus = "running" | "exited" | "timed_out" | "cancelled";

interface CommandState {
  command: string;
  startedAt: string;
  finishedAt?: string;
  pid?: number;
  status: CommandStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  timeoutSeconds: number;
  stdout: string;
  stderr: string;
}

interface SessionState {
  id: string;
  cwd: string;
  env: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  activeCommand?: CommandState;
  lastCommand?: CommandState;
}

interface PersistedState {
  sessions: SessionState[];
}

class TerminalSessionManager {
  private sessions = new Map<string, SessionState>();
  private procs = new Map<string, ChildProcessWithoutNullStreams>();
  private loaded = false;
  private readonly stateFile: string;

  constructor() {
    const stateDir =
      process.env.BRIAN_STATE_DIR ?? path.join(homedir(), ".brian");
    this.stateFile = path.join(stateDir, "terminals", "sessions.json");
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.stateFile, "utf-8");
      const parsed = JSON.parse(raw) as PersistedState;
      for (const session of parsed.sessions ?? []) {
        if (session.activeCommand?.status === "running") {
          session.activeCommand.status = "cancelled";
          session.activeCommand.finishedAt = new Date().toISOString();
          session.lastCommand = session.activeCommand;
          delete session.activeCommand;
        }
        this.sessions.set(session.id, session);
      }
    } catch {
      // No prior state is fine.
    }
  }

  private trimOutput(text: string): string {
    if (text.length <= MAX_OUTPUT_BUFFER_CHARS) return text;
    return text.slice(text.length - MAX_OUTPUT_BUFFER_CHARS);
  }

  private summarizeCommand(command?: CommandState): Record<string, unknown> | null {
    if (!command) return null;
    return {
      command: command.command,
      startedAt: command.startedAt,
      finishedAt: command.finishedAt ?? null,
      pid: command.pid ?? null,
      status: command.status,
      exitCode: command.exitCode,
      signal: command.signal,
      timedOut: command.timedOut,
      timeoutSeconds: command.timeoutSeconds,
    };
  }

  private summarizeSession(session: SessionState): Record<string, unknown> {
    return {
      id: session.id,
      cwd: session.cwd,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      activeCommand: this.summarizeCommand(session.activeCommand),
      lastCommand: this.summarizeCommand(session.lastCommand),
    };
  }

  private async persist(): Promise<void> {
    const payload: PersistedState = {
      sessions: Array.from(this.sessions.values()),
    };
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    await fs.writeFile(this.stateFile, JSON.stringify(payload, null, 2));
  }

  async save(): Promise<void> {
    await this.persist();
  }

  createSession(cwd?: string, env?: Record<string, string>): SessionState {
    const now = new Date().toISOString();
    const id = randomUUID();
    const session: SessionState = {
      id,
      cwd: cwd || process.cwd(),
      env: env ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(id, session);
    return session;
  }

  listSessions(): Record<string, unknown>[] {
    return Array.from(this.sessions.values()).map((session) =>
      this.summarizeSession(session)
    );
  }

  getSession(sessionId: string): SessionState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }

  getStatus(sessionId: string): Record<string, unknown> {
    return this.summarizeSession(this.getSession(sessionId));
  }

  async closeSession(sessionId: string, force = false): Promise<Record<string, unknown>> {
    const session = this.getSession(sessionId);
    if (session.activeCommand?.status === "running" && !force) {
      throw new Error(
        `Session ${sessionId} has a running command. Use force=true or cancel first.`
      );
    }
    if (session.activeCommand?.status === "running" && force) {
      this.cancel(sessionId, "SIGKILL");
    }
    this.sessions.delete(sessionId);
    return { closed: true, sessionId };
  }

  private attachProcessHandlers(
    session: SessionState,
    proc: ChildProcessWithoutNullStreams,
    commandState: CommandState,
    timeoutSeconds: number
  ): Promise<CommandState> {
    return new Promise((resolve) => {
      proc.stdout.on("data", (chunk) => {
        commandState.stdout = this.trimOutput(commandState.stdout + chunk.toString());
      });
      proc.stderr.on("data", (chunk) => {
        commandState.stderr = this.trimOutput(commandState.stderr + chunk.toString());
      });

      proc.on("error", (err) => {
        commandState.stderr = this.trimOutput(
          `${commandState.stderr}\nFailed to start command: ${err.message}`.trim()
        );
      });

      void waitForProcessCompletion(proc, Math.max(1, timeoutSeconds) * 1000).then(
        ({ exitCode, signal, timedOut }) => {
          this.procs.delete(session.id);
          commandState.exitCode = exitCode;
          commandState.signal = signal;
          commandState.timedOut = timedOut;
          commandState.finishedAt = new Date().toISOString();
          if (commandState.status === "running") {
            if (timedOut) {
              commandState.status = "timed_out";
            } else {
              commandState.status = signal === "SIGTERM" ? "cancelled" : "exited";
            }
          }

          session.lastCommand = { ...commandState };
          delete session.activeCommand;
          session.updatedAt = new Date().toISOString();
          void this.persist();
          resolve(commandState);
        }
      );
    });
  }

  async run(
    sessionId: string,
    command: string,
    timeoutSeconds: number,
    background: boolean
  ): Promise<Record<string, unknown>> {
    const session = this.getSession(sessionId);
    if (session.activeCommand?.status === "running") {
      throw new Error(`Session ${sessionId} already has a running command`);
    }

    const commandState: CommandState = {
      command,
      startedAt: new Date().toISOString(),
      status: "running",
      exitCode: null,
      signal: null,
      timedOut: false,
      timeoutSeconds: Math.max(1, timeoutSeconds),
      stdout: "",
      stderr: "",
    };

    const proc = spawn("bash", ["-c", command], {
      cwd: session.cwd,
      env: shellEnv(session.env),
    });

    commandState.pid = proc.pid;
    session.activeCommand = commandState;
    session.updatedAt = new Date().toISOString();
    this.procs.set(session.id, proc);

    const completion = this.attachProcessHandlers(
      session,
      proc,
      commandState,
      commandState.timeoutSeconds
    );

    if (background) {
      void this.persist();
      return {
        sessionId,
        started: true,
        background: true,
        pid: commandState.pid ?? null,
        command,
        timeoutSeconds: commandState.timeoutSeconds,
      };
    }

    const done = await completion;
    return {
      sessionId,
      started: true,
      background: false,
      command: done.command,
      status: done.status,
      exitCode: done.exitCode,
      signal: done.signal,
      timedOut: done.timedOut,
      stdout: done.stdout,
      stderr: done.stderr,
    };
  }

  cancel(sessionId: string, signal: NodeJS.Signals = "SIGTERM"): Record<string, unknown> {
    const session = this.getSession(sessionId);
    const proc = this.procs.get(sessionId);
    if (!proc || !session.activeCommand || session.activeCommand.status !== "running") {
      return { sessionId, cancelled: false, reason: "No running command" };
    }
    if (signal === "SIGTERM") {
      session.activeCommand.status = "cancelled";
    }
    proc.kill(signal);
    session.updatedAt = new Date().toISOString();
    void this.persist();
    return {
      sessionId,
      cancelled: true,
      signal,
      pid: session.activeCommand.pid ?? null,
    };
  }

  read(
    sessionId: string,
    stream: "stdout" | "stderr" | "combined",
    tailChars: number
  ): Record<string, unknown> {
    const session = this.getSession(sessionId);
    const source = session.activeCommand ?? session.lastCommand;
    if (!source) {
      return {
        sessionId,
        stream,
        output: "",
        hasCommand: false,
      };
    }

    const safeTail = Math.max(1, tailChars);
    const raw =
      stream === "stdout"
        ? source.stdout
        : stream === "stderr"
          ? source.stderr
          : [source.stdout, source.stderr].filter(Boolean).join("\n");
    const output = raw.length > safeTail ? raw.slice(raw.length - safeTail) : raw;

    return {
      sessionId,
      stream,
      output,
      command: source.command,
      status: source.status,
      hasCommand: true,
      truncated: raw.length > safeTail,
    };
  }
}

const manager = new TerminalSessionManager();

function asJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") {
      out[k] = v;
    }
  }
  return out;
}

export const terminalTool: Tool = {
  name: "terminal",
  definition: {
    name: "terminal",
    description:
      "Manage terminal sessions and run commands in parallel. Supports creating/listing sessions, running commands, reading output, checking status, cancelling, and closing sessions.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "list", "run", "read", "status", "cancel", "close"],
          description: "Terminal action to perform",
        },
        session_id: {
          type: "string",
          description: "Session ID for actions that target an existing session",
        },
        command: {
          type: "string",
          description: "Command to run when action=run",
        },
        cwd: {
          type: "string",
          description: "Initial working directory when action=create",
        },
        env: {
          type: "object",
          description: "Environment variables to add to session when action=create",
        },
        timeout_seconds: {
          type: "number",
          description: "Command timeout in seconds when action=run (default: 300)",
        },
        background: {
          type: "boolean",
          description: "When action=run, return immediately if true (default: true)",
        },
        stream: {
          type: "string",
          enum: ["stdout", "stderr", "combined"],
          description: "Output stream selection when action=read (default: combined)",
        },
        tail_chars: {
          type: "number",
          description: "How many trailing chars to return when action=read",
        },
        signal: {
          type: "string",
          enum: ["SIGTERM", "SIGKILL", "SIGINT"],
          description: "Signal used when action=cancel (default: SIGTERM)",
        },
        force: {
          type: "boolean",
          description: "Allow close while running command when action=close",
        },
      },
      required: ["action"],
    },
  },
  async execute(input) {
    const {
      action,
      session_id,
      command,
      cwd,
      env,
      timeout_seconds,
      background,
      stream,
      tail_chars,
      signal,
      force,
    } = input as {
      action: "create" | "list" | "run" | "read" | "status" | "cancel" | "close";
      session_id?: string;
      command?: string;
      cwd?: string;
      env?: Record<string, unknown>;
      timeout_seconds?: number;
      background?: boolean;
      stream?: "stdout" | "stderr" | "combined";
      tail_chars?: number;
      signal?: NodeJS.Signals;
      force?: boolean;
    };

    await manager.ensureLoaded();

    switch (action) {
      case "create": {
        const session = manager.createSession(cwd, asStringRecord(env));
        await manager.save();
        return asJson({
          created: true,
          sessionId: session.id,
          session: manager.getStatus(session.id),
        });
      }
      case "list":
        return asJson({ sessions: manager.listSessions() });
      case "status": {
        if (!session_id) throw new Error("session_id is required for status");
        return asJson(manager.getStatus(session_id));
      }
      case "run": {
        if (!session_id) throw new Error("session_id is required for run");
        if (!command) throw new Error("command is required for run");
        return asJson(
          await manager.run(
            session_id,
            command,
            timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS,
            background ?? true
          )
        );
      }
      case "read": {
        if (!session_id) throw new Error("session_id is required for read");
        return asJson(
          manager.read(
            session_id,
            stream ?? "combined",
            tail_chars ?? DEFAULT_READ_TAIL_CHARS
          )
        );
      }
      case "cancel": {
        if (!session_id) throw new Error("session_id is required for cancel");
        return asJson(manager.cancel(session_id, signal ?? "SIGTERM"));
      }
      case "close": {
        if (!session_id) throw new Error("session_id is required for close");
        return asJson(await manager.closeSession(session_id, force ?? false));
      }
      default:
        throw new Error(`Unsupported action: ${String(action)}`);
    }
  },
};
