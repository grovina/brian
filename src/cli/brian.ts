#!/usr/bin/env node

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { execFileSync, execSync } from "child_process";
import { registry, getModule } from "../modules/index.js";
import { syncCheck } from "../modules/updater/index.js";
import type { InstallContext } from "../modules/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveContext(): InstallContext {
  const home = process.env.HOME ?? "/home/brian";
  return {
    repoDir: process.env.BRIAN_REPO_DIR ?? resolve(__dirname, "../.."),
    stateDir: process.env.BRIAN_STATE_DIR ?? resolve(home, ".brian"),
  };
}

function printUsage(): void {
  console.log(`brian — manage your brian instance

Commands:
  setup                       Initialize state, install modules, start daemon
  deploy                      Pull, build, restart (with rollback)
  module list                 List available modules
  module install <name>       Install a module
  module check [name]         Check module status
  doctor                      Run all health checks
  sync                        Sync fork with upstream
  sync --check                Check fork status only
  help                        This message`);
}

// ─────────────────────────────────────────────────
// setup
// ─────────────────────────────────────────────────

async function handleSetup(): Promise<void> {
  const name = process.env.BRIAN_NAME;
  if (!name) {
    console.error("BRIAN_NAME not set");
    process.exit(1);
  }

  const ctx = resolveContext();
  const org = process.env.GITHUB_ORG ?? "";

  console.log("Initializing state directory...");
  await fs.mkdir(resolve(ctx.stateDir, "mcp"), { recursive: true });
  await fs.mkdir(resolve(ctx.stateDir, "context"), { recursive: true });

  const instructionsPath = resolve(ctx.stateDir, "instructions.md");
  try {
    await fs.access(instructionsPath);
  } catch {
    let instructions = `## First Run

This is your first deployment. Introduce yourself on Slack, explain what you
can do, and ask the team what they need. Once you've done that, remove this
section and commit the change.
`;

    if (org) {
      instructions += `
## About

You're built on the brian framework. Your org has a fork at
github.com/${org}/brian (upstream: github.com/grovina/brian).

When you identify improvements that would benefit all brians, push changes
to your fork and open a PR to upstream.
`;
    }

    instructions += `
## Managing Capabilities

Use the \`brian\` CLI to manage your modules and integrations:

  brian module list          — see available modules
  brian module install X     — install a module
  brian doctor               — check health
  brian sync                 — sync fork with upstream
`;

    await fs.writeFile(instructionsPath, instructions);
  }

  console.log("Installing default modules...");
  for (const mod of registry.filter((m) => m.meta.default)) {
    try {
      await mod.install(ctx);
      console.log(`  ✓ ${mod.meta.name}`);
    } catch (err) {
      console.error(`  ✗ ${mod.meta.name}: ${err}`);
    }
  }

  await installService(name, ctx.repoDir);

  console.log(`\n${name} is running!`);
}

async function installService(
  name: string,
  repoDir: string
): Promise<void> {
  const unit = `[Unit]
Description=${name}
After=network.target

[Service]
Type=simple
User=brian
WorkingDirectory=${repoDir}
EnvironmentFile=/etc/brian/env
ExecStart=/usr/bin/node dist/start.js
Restart=on-failure
RestartSec=5
StartLimitBurst=5
StartLimitIntervalSec=60

[Install]
WantedBy=multi-user.target
`;

  console.log("Installing systemd service...");
  try {
    await fs.writeFile("/tmp/brian.service", unit);
    execSync("sudo mv /tmp/brian.service /etc/systemd/system/brian.service", {
      stdio: "inherit",
    });
    execSync(
      "sudo systemctl daemon-reload && sudo systemctl enable brian && sudo systemctl restart brian",
      { stdio: "inherit" }
    );

    console.log("Waiting for startup...");
    await new Promise((r) => setTimeout(r, 10_000));

    try {
      execSync("systemctl is-active --quiet brian");
    } catch {
      console.error("Failed to start. Check: journalctl -u brian -n 50");
      process.exit(1);
    }
  } catch {
    console.log(
      "Systemd not available — start manually: node dist/start.js"
    );
  }
}

// ─────────────────────────────────────────────────
// module
// ─────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────
// deploy / doctor / sync
// ─────────────────────────────────────────────────

async function handleDeploy(): Promise<void> {
  const ctx = resolveContext();

  console.log("Pulling latest...");
  execSync(`git -C ${ctx.repoDir} pull origin main`, { stdio: "inherit" });

  console.log("Installing dependencies...");
  execSync(`cd ${ctx.repoDir} && npm install`, { stdio: "inherit" });

  console.log("Building...");
  execSync(`cd ${ctx.repoDir} && npm run build`, { stdio: "inherit" });

  console.log("Restarting...");
  try {
    execSync("sudo systemctl restart brian", { stdio: "inherit" });
    await new Promise((r) => setTimeout(r, 10_000));
    execSync("systemctl is-active --quiet brian");
    console.log("✓ Deployed and running");
  } catch {
    console.error("✗ Failed to restart. Rolling back...");
    execSync(`git -C ${ctx.repoDir} checkout HEAD~1`, { stdio: "inherit" });
    execSync(`cd ${ctx.repoDir} && npm install && npm run build`, { stdio: "inherit" });
    execSync("sudo systemctl restart brian", { stdio: "inherit" });
    console.error("Rolled back to previous version.");
    process.exit(1);
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
    await syncCheck(ctx);
    console.log("✓ Status written to context/fork-status.md");
    return;
  }

  console.log("Syncing fork with upstream...");
  try {
    execFileSync("git", ["-C", ctx.repoDir, "fetch", "upstream"], {
      stdio: "inherit",
    });
    execFileSync(
      "git",
      ["-C", ctx.repoDir, "merge", "upstream/main", "--ff-only"],
      { stdio: "inherit" }
    );
    console.log("✓ Fork synced");

    await syncCheck(ctx);
  } catch {
    console.error(
      "✗ Sync failed — may need manual merge. Try: git -C " +
        ctx.repoDir +
        " merge upstream/main"
    );
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const [command, subcommand, ...rest] = process.argv.slice(2);

  switch (command) {
    case "setup":
      await handleSetup();
      break;
    case "deploy":
      await handleDeploy();
      break;
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
