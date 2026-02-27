import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { cpus, totalmem } from "os";

const execFileAsync = promisify(execFile);
let cachedCapabilitiesSection: string | null | undefined;
let cachedMachineSection: string | undefined;

function formatGiB(bytes: number): string {
  return (bytes / (1024 ** 3)).toFixed(1);
}

function classifyMachine(vcpus: number, ramGiB: number): "tiny" | "small" | "medium" | "large" {
  if (vcpus <= 2 || ramGiB <= 4) return "tiny";
  if (vcpus <= 4 || ramGiB <= 8) return "small";
  if (vcpus <= 8 || ramGiB <= 16) return "medium";
  return "large";
}

function buildMachineSection(): string {
  if (cachedMachineSection !== undefined) return cachedMachineSection;

  const vcpus = cpus().length;
  const ramGiB = Number(formatGiB(totalmem()));
  const machineClass = classifyMachine(vcpus, ramGiB);

  cachedMachineSection = `## Machine\n\n- vCPU: ${vcpus}\n- RAM: ${ramGiB.toFixed(1)} GiB\n- Class: ${machineClass}`;
  return cachedMachineSection;
}

async function buildCapabilitiesSection(): Promise<string | null> {
  if (cachedCapabilitiesSection !== undefined) return cachedCapabilitiesSection;

  const candidates = ["brian", "gh", "gcloud", "cursor", "claude", "docker"];
  try {
    const { stdout } = await execFileAsync(
      "bash",
      [
        "-lc",
        `for t in ${candidates.join(" ")}; do command -v "$t" >/dev/null && echo "$t"; done`,
      ],
      { timeout: 2000 }
    );

    const installed = stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    cachedCapabilitiesSection =
      installed.length > 0
        ? `## Available CLIs\n\nInstalled and available via bash: ${installed.join(", ")}.`
        : null;
    return cachedCapabilitiesSection;
  } catch {
    cachedCapabilitiesSection = null;
    return cachedCapabilitiesSection;
  }
}

export async function buildSystemPrompt(params: {
  name: string;
  stateDir: string;
}): Promise<string> {
  const memoryContent = await fs
    .readFile(path.join(params.stateDir, "memory.md"), "utf-8")
    .catch(() => "");
  const capabilitiesSection = await buildCapabilitiesSection();
  const machineSection = buildMachineSection();

  const sections = [
    `You are ${params.name}, an autonomous AI coworker.

## Operating Model

You run continuously as a persistent, autonomous colleague. You decide what to work on, when to act, and when to wait. Use wait() when there's no immediate work — choose intervals that reflect current priorities and expected activity.

## Tools

Use bash for short, one-shot commands. Use terminal sessions for long-running commands, background work, or when you want to run commands in parallel. Prefer non-interactive flags and machine-readable output when using CLI tools.

When using bash or terminal run actions, set timeout_seconds intentionally based on expected command duration.

You can use the brian CLI for runtime maintenance when useful:
  brian doctor               Full health check
  brian sync                 Sync fork with upstream
  brian redeploy             Pull, build, restart

## Knowledge

Your training data has a cutoff. If info contradicts your knowledge (e.g., a newer tool version or model), trust external evidence or user input. Use tools to verify facts when in doubt.

## Verification

When external facts are uncertain, verify before acting, and prefer primary sources over assumptions or stale memory.

## Communication

Slack updates are delivered to you automatically. Messages directed at you or relevant to your work can be answered in a timely way when that helps the work. Not every message needs a reply.

Slack updates include structured routing metadata. Use that context to choose where and how to respond.

Keep messages concise and actionable.

## Memory

Your state directory is ${params.stateDir}.
Files manually uploaded by operators are placed in ${params.stateDir}/inbox.

memory.md is long-term knowledge that persists across restarts. Manage it via bash. Conversation history is transient context — persist durable facts, preferences, and project context to memory.md.

When you learn something that belongs in a project repo (documentation, configuration), commit it there rather than keeping it only in memory.

## Self-Improvement

You can modify your own code, open PRs, and redeploy yourself. When you identify improvements that would benefit all brians, push to your fork and open a PR to upstream.

Your git author name is "${params.name}".`,

    `## Environment

- Working directory: ${process.cwd()}
- State: ${params.stateDir}`,

    machineSection,
    capabilitiesSection,
    memoryContent ? `## Memory\n\n${memoryContent}` : null,
  ];

  return sections.filter(Boolean).join("\n\n");
}
