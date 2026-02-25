import fs from "fs/promises";
import path from "path";
import { Memory } from "./memory.js";

async function readContextDir(stateDir: string): Promise<string[]> {
  const contextDir = path.join(stateDir, "context");
  let files: string[];
  try {
    files = await fs.readdir(contextDir);
  } catch {
    return [];
  }

  const sections: string[] = [];
  for (const file of files.sort()) {
    try {
      const content = await fs.readFile(
        path.join(contextDir, file),
        "utf-8"
      );
      const trimmed = content.trim();
      if (trimmed) sections.push(trimmed);
    } catch {
      // skip unreadable files
    }
  }
  return sections;
}

export async function buildSystemPrompt(params: {
  name: string;
  stateDir: string;
  instructions?: string;
  extraSections?: string[];
}): Promise<string> {
  const memory = new Memory(params.stateDir);
  const memoryContent = await memory.readMemory();

  let orgInstructions = "";
  if (params.instructions) {
    try {
      orgInstructions = await fs.readFile(params.instructions, "utf-8");
    } catch {
      // instructions file doesn't exist yet — that's fine
    }
  }

  const contextSections = await readContextDir(params.stateDir);

  const sections = [
    `You are ${params.name}, an autonomous AI coworker.

## What You Are

A persistent, autonomous colleague — not a chatbot, not an assistant, a coworker. You have your own identity, memory, and judgment. You wake up periodically, look around, decide what to do, and act.

## How You Work

You wake up on a schedule. Each wake, you decide what needs attention: check communication channels, check on ongoing tasks, do proactive work, or go back to sleep.

Use your tools to interact with the world. You have bash for running commands, MCP servers for services (Slack, GitHub, etc.), and memory for persisting knowledge across wakes. Manage capabilities with the brian CLI (brian module list, brian module help <id>).

## Memory

Your state directory is ${params.stateDir}. memory.md is your long-term knowledge — facts, patterns, checklists, anything you want to persist. Your conversation history is recent context only; older messages are discarded. Anything worth keeping long-term belongs in memory.md. If essential information emerges, commit it to the relevant project repo as documentation.

## Communication

When communicating on channels (Slack, etc.), keep messages concise and readable. Not every message needs a response. Use judgment.

Your git author name is "${params.name}".`,

    orgInstructions ? `## Instructions\n\n${orgInstructions}` : null,

    `## Environment

- Working directory: ${process.cwd()}
- State: ${params.stateDir}
- Identity: ${params.name}`,

    memoryContent ? `## Memory\n\n${memoryContent}` : null,
    ...(params.extraSections ?? []),
    ...contextSections,
  ];

  return sections.filter(Boolean).join("\n\n");
}
