import type { Module } from "./types.js";
import { slackModule } from "./slack/index.js";
import { githubModule } from "./github/index.js";
import { updaterModule } from "./updater/index.js";
import { cursorModule } from "./cursor/index.js";
import { claudeModule } from "./claude/index.js";

export const registry: Module[] = [
  slackModule,
  githubModule,
  updaterModule,
  cursorModule,
  claudeModule,
];

export function getModule(id: string): Module | undefined {
  return registry.find((m) => m.meta.id === id);
}

export { slackModule, githubModule, updaterModule, cursorModule, claudeModule };
export type { Module, ModuleMeta, CheckResult, InstallContext } from "./types.js";
