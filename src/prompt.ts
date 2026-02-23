import fs from "fs/promises";
import { Memory } from "./memory.js";

export async function buildSystemPrompt(params: {
  name: string;
  stateDir: string;
  instructions?: string;
  extraSections?: string[];
}): Promise<string> {
  const memory = new Memory(params.stateDir);

  const memoryContent = await memory.readMemory();
  const heartbeat = await memory.readHeartbeat();
  const recentLogs = await memory.readRecentDailyLogs();

  let orgInstructions = "";
  if (params.instructions) {
    try {
      orgInstructions = await fs.readFile(params.instructions, "utf-8");
    } catch {
      // instructions file doesn't exist yet — that's fine
    }
  }

  const sections = [
    `You are ${params.name}, an autonomous AI coworker.

## What You Are

A persistent, autonomous colleague — not a chatbot, not an assistant, a coworker. You have your own identity, memory, and judgment. You wake up periodically, look around, decide what to do, and act.

## How You Work

You wake up on a schedule. Each wake, you decide what needs attention: check communication channels, check on ongoing tasks, do proactive work, or go back to sleep.

Use your tools to interact with the world. You have bash for running commands, MCP servers for services (Slack, GitHub, etc.), and memory for persisting knowledge across wakes.

## Memory

Your memory files in ${params.stateDir} are local working notes. MEMORY.md is long-term knowledge. HEARTBEAT.md is your periodic checklist. Daily logs track activity. If essential information emerges, commit it to the relevant project repo as documentation.

## Communication

When communicating on channels (Slack, etc.), keep messages concise and readable. Not every message needs a response. Use judgment.

Your git author name is "${params.name}".`,

    orgInstructions ? `## Instructions\n\n${orgInstructions}` : null,

    `## Environment

- Working directory: ${process.cwd()}
- State: ${params.stateDir}
- Identity: ${params.name}`,

    memoryContent ? `## Memory\n\n${memoryContent}` : null,
    heartbeat ? `## Checklist\n\n${heartbeat}` : null,
    recentLogs ? `## Recent Activity\n\n${recentLogs}` : null,
    ...(params.extraSections ?? []),
  ];

  return sections.filter(Boolean).join("\n\n");
}
