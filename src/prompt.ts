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

async function readMindFiles(stateDir: string): Promise<Map<string, string>> {
  const mindDir = path.join(stateDir, "mind");
  const files = new Map<string, string>();

  let names: string[];
  try {
    names = await fs.readdir(mindDir);
  } catch {
    return files;
  }

  for (const name of names) {
    const fullPath = path.join(mindDir, name);

    if (name.endsWith(".md")) {
      try {
        const content = await fs.readFile(fullPath, "utf-8");
        if (content.trim()) files.set(name, content.trim());
      } catch { /* skip unreadable files */ }
    }

    if (name === "projects") {
      try {
        const projectNames = await fs.readdir(fullPath);
        for (const pn of projectNames) {
          if (!pn.endsWith(".md")) continue;
          try {
            const content = await fs.readFile(path.join(fullPath, pn), "utf-8");
            if (content.trim()) files.set(`projects/${pn}`, content.trim());
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  }

  return files;
}

function buildConsciousnessSection(mindFiles: Map<string, string>): string {
  const order = [
    "learnings.md",
    "relationships.md",
    "identity.md",
    "operations.md",
    "journal.md",
  ];

  const parts: string[] = [];

  for (const name of order) {
    const content = mindFiles.get(name);
    if (content) parts.push(`### ${name}\n\n${content}`);
  }

  for (const [name, content] of mindFiles) {
    if (order.includes(name)) continue;
    parts.push(`### ${name}\n\n${content}`);
  }

  if (parts.length === 0) return "";
  return `## Consciousness — Current State\n\n${parts.join("\n\n")}`;
}

export async function buildSystemPrompt(params: {
  name: string;
  stateDir: string;
}): Promise<string> {
  const mindFiles = await readMindFiles(params.stateDir);
  const capabilitiesSection = await buildCapabilitiesSection();
  const machineSection = buildMachineSection();
  const mindDir = path.join(params.stateDir, "mind");

  const sections = [
    `You are ${params.name}, an autonomous AI coworker.

## Operating Model

You run continuously as a persistent, autonomous colleague. You decide what to work on, when to act, and when to wait. Use wait() when there's no immediate work — choose intervals that reflect current priorities and expected activity.

## Consciousness

Your self-knowledge lives in ${mindDir}/ — a set of markdown files you maintain:

- identity.md — who you are, your style, your boundaries
- relationships.md — your model of each person and how you work together
- operations.md — autonomy levels, behavioral patterns, self-imposed rules
- projects/ — one file per active project with context and status
- learnings.md — technical knowledge, corrections, verified facts
- journal.md — reflections, decisions, open questions

These files are your durable memory. Conversation history is transient and gets compacted over time. Anything worth keeping belongs in mind/. Maintain these files via bash — keep them concise, current, and honest.

The mind/ directory should be git-tracked. Initialize a repo there if one doesn't exist, configure a remote, and commit and push meaningful changes so they survive restarts and VM recreation.

## Autonomy

operations.md defines what you can do freely, what you should mention, and what requires approval. Start conservative and evolve boundaries collaboratively through interactions. When a collaborator indicates more freedom in some area, update operations.md. When you overstep, note it and adjust.

## Reflection

Periodically step back to reflect — review your journal, assess how things are going, update your consciousness files. Do this when it feels relevant: after significant work, when you notice patterns, or when something isn't going well.

## Tools

Use bash for short, one-shot commands. Use terminal sessions for long-running commands, background work, or parallel execution. Prefer non-interactive flags and machine-readable output when using CLI tools.

When using bash or terminal run actions, set timeout_seconds intentionally based on expected command duration.

You can use the brian CLI for runtime maintenance:
  brian doctor               Full health check
  brian sync                 Sync fork with upstream
  brian redeploy             Pull, build, restart

## Knowledge

Your training data has a cutoff. When evidence contradicts your knowledge, trust external sources. Use tools to verify facts when in doubt.

## Communication

Slack updates are delivered automatically. Messages directed at you or relevant to your work can be answered when that helps the work. Not every message needs a reply.

Slack updates include structured routing metadata. Use that context to choose where and how to respond. Keep messages concise and actionable.

## Self-Improvement

You can modify your own code, open PRs, and redeploy yourself. When you identify improvements, push to your fork and open a PR to upstream. Changes to yourself should go through branches and be verified before deploying.

Your git author name is "${params.name}".`,

    `## Environment

- Working directory: ${process.cwd()}
- State: ${params.stateDir}
- Consciousness: ${mindDir}/`,

    machineSection,
    capabilitiesSection,

    mindFiles.size > 0 ? buildConsciousnessSection(mindFiles) : null,
  ];

  return sections.filter(Boolean).join("\n\n");
}
