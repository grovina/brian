#!/usr/bin/env node

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { registry, getModule } from "../modules/index.js";
import { syncCheck } from "../modules/updater/index.js";
import type { InstallContext } from "../modules/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveContext(): InstallContext {
  const home = process.env.HOME ?? "/home/brian";
  return {
    appDir: process.env.BRIAN_APP_DIR ?? resolve(home, "app"),
    stateDir: process.env.BRIAN_STATE_DIR ?? resolve(home, ".brian"),
    frameworkDir:
      process.env.BRIAN_FRAMEWORK_DIR ?? resolve(__dirname, "../.."),
  };
}

function printUsage(): void {
  console.log(`brian — manage your brian instance

Commands:
  module list                 List available modules
  module install <name>       Install a module
  module check [name]         Check module status
  doctor                      Run all health checks
  sync                        Sync fork with upstream
  sync --check                Check fork status only
  help                        This message`);
}

async function handleModuleList(): Promise<void> {
  console.log("Available modules:\n");
  const ctx = resolveContext();

  for (const mod of registry) {
    const result = await mod.check(ctx).catch(() => ({
      installed: false,
      issues: ["check failed"],
    }));
    const status = result.installed ? "✓" : "·";
    const tag = mod.meta.default ? " (default)" : "";
    console.log(
      `  ${status}  ${mod.meta.id.padEnd(12)} ${mod.meta.description}${tag}`
    );
    if (!result.installed && result.issues?.length) {
      for (const issue of result.issues) {
        console.log(`       → ${issue}`);
      }
    }
  }
}

async function handleModuleInstall(name: string): Promise<void> {
  const mod = getModule(name);
  if (!mod) {
    console.error(
      `Unknown module: ${name}\nAvailable: ${registry.map((m) => m.meta.id).join(", ")}`
    );
    process.exit(1);
  }

  const ctx = resolveContext();
  console.log(`Installing ${mod.meta.name}...`);

  try {
    await mod.install(ctx);
    const result = await mod.check(ctx);
    if (result.installed) {
      console.log(`✓ ${mod.meta.name} installed`);
    } else {
      console.log(`⚠ ${mod.meta.name} installed but has issues:`);
      for (const issue of result.issues ?? []) {
        console.log(`  → ${issue}`);
      }
    }
  } catch (err) {
    console.error(`✗ Failed to install ${mod.meta.name}:`, err);
    process.exit(1);
  }
}

async function handleModuleCheck(name?: string): Promise<void> {
  const ctx = resolveContext();
  const modules = name ? [getModule(name)].filter(Boolean) : registry;

  if (name && modules.length === 0) {
    console.error(`Unknown module: ${name}`);
    process.exit(1);
  }

  for (const mod of modules) {
    if (!mod) continue;
    try {
      const result = await mod.check(ctx);
      const status = result.installed ? "✓" : "✗";
      const version = result.version ? ` (${result.version})` : "";
      console.log(`${status} ${mod.meta.name}${version}`);
      if (!result.installed && result.issues?.length) {
        for (const issue of result.issues) {
          console.log(`  → ${issue}`);
        }
      }
    } catch (err) {
      console.log(`✗ ${mod.meta.name}: check failed — ${err}`);
    }
  }
}

async function handleDoctor(): Promise<void> {
  console.log("Running health checks...\n");
  await handleModuleCheck();
}

async function handleSync(args: string[]): Promise<void> {
  const ctx = resolveContext();

  if (args.includes("--check")) {
    console.log("Checking fork status...");
    await syncCheck({
      frameworkDir: ctx.frameworkDir,
      stateDir: ctx.stateDir,
    });
    console.log("✓ Status written to context/fork-status.md");
    return;
  }

  console.log("Syncing fork with upstream...");
  try {
    execFileSync("git", ["-C", ctx.frameworkDir, "fetch", "upstream"], {
      stdio: "inherit",
    });
    execFileSync(
      "git",
      ["-C", ctx.frameworkDir, "merge", "upstream/main", "--ff-only"],
      { stdio: "inherit" }
    );
    console.log("✓ Fork synced");

    await syncCheck({
      frameworkDir: ctx.frameworkDir,
      stateDir: ctx.stateDir,
    });
  } catch {
    console.error(
      "✗ Sync failed — may need manual merge. Try: git -C " +
        ctx.frameworkDir +
        " merge upstream/main"
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const [command, subcommand, ...rest] = process.argv.slice(2);

  switch (command) {
    case "module":
      switch (subcommand) {
        case "list":
          await handleModuleList();
          break;
        case "install":
          if (!rest[0]) {
            console.error("Usage: brian module install <name>");
            process.exit(1);
          }
          await handleModuleInstall(rest[0]);
          break;
        case "check":
          await handleModuleCheck(rest[0]);
          break;
        default:
          console.error("Usage: brian module <list|install|check>");
          process.exit(1);
      }
      break;
    case "doctor":
      await handleDoctor();
      break;
    case "sync":
      await handleSync(subcommand ? [subcommand, ...rest] : rest);
      break;
    case "help":
    case undefined:
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
