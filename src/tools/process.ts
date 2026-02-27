import type { ChildProcessWithoutNullStreams } from "child_process";

const DEFAULT_DRAIN_MS = 100;
const FORCE_KILL_DELAY_MS = 5_000;

export interface ProcessCompletion {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

export function shellEnv(extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extraEnv,
    PATH: `${process.env.HOME}/.npm-global/bin:${process.env.PATH}`,
    CLOUDSDK_CORE_DISABLE_PROMPTS:
      process.env.CLOUDSDK_CORE_DISABLE_PROMPTS ?? "1",
    CLOUDSDK_PAGER: process.env.CLOUDSDK_PAGER ?? "",
  };
}

export function waitForProcessCompletion(
  proc: ChildProcessWithoutNullStreams,
  timeoutMs: number,
  drainMs = DEFAULT_DRAIN_MS
): Promise<ProcessCompletion> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let exitCode: number | null = null;
    let signal: NodeJS.Signals | null = null;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let finalizeTimer: NodeJS.Timeout | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (finalizeTimer) clearTimeout(finalizeTimer);
      resolve({ exitCode, signal, timedOut });
    };

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (proc.exitCode === null) {
            proc.kill("SIGKILL");
          }
        }, FORCE_KILL_DELAY_MS);
      }, timeoutMs);
    }

    // "close" waits for stdio streams to close; descendants can keep them open.
    // Use "exit" as authoritative completion and keep a short drain window.
    proc.on("exit", (code, exitSignal) => {
      exitCode = code;
      signal = exitSignal;
      if (finalizeTimer) clearTimeout(finalizeTimer);
      finalizeTimer = setTimeout(finish, Math.max(0, drainMs));
    });

    proc.on("close", (code, closeSignal) => {
      if (exitCode === null) exitCode = code;
      if (signal === null) signal = closeSignal;
      finish();
    });
  });
}
