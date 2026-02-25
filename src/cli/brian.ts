#!/usr/bin/env node

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { execFileSync, execSync } from "child_process";
import { registry, getModule, type CheckResult } from "../modules/index.js";
import { syncCheck } from "../modules/updater/index.js";
import type { InstallContext } from "../modules/types.js";
import { checkModelConfig } from "../model.js";

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
  redeploy                    Pull, build, restart (with rollback)
  config check                Validate runtime config and model connectivity
  module list                 List available modules
  module install <name>       Install a module
  module check [name]         Check module status
  module help <name>          Show module usage guide
  doctor                      Run all health checks
  sync [--force]              Sync fork with upstream
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

  console.log("Initializing state directory...");
  await fs.mkdir(resolve(ctx.stateDir, "mcp"), { recursive: true });
  await fs.mkdir(resolve(ctx.stateDir, "context"), { recursive: true });

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
StartLimitBurst=5
StartLimitIntervalSec=60

[Service]
Type=simple
User=brian
WorkingDirectory=${repoDir}
EnvironmentFile=/etc/brian/env
ExecStart=/usr/bin/node dist/start.js
Restart=on-failure
RestartSec=5

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
  const ctx = resolveContext();

  for (const mod of registry) {
    const result = await mod.check(ctx).catch((): CheckResult => ({
      installed: false,
      issues: ["check failed"],
    }));
    if (result.installed) {
      const ver = result.version ? ` (${result.version})` : "";
      console.log(
        `  ✓  ${mod.meta.id.padEnd(12)} ${mod.meta.description}${ver}`
      );
    } else {
      const hint = result.issues?.[0] ?? "not installed";
      console.log(
        `  ·  ${mod.meta.id.padEnd(12)} ${hint} — run: brian module install ${mod.meta.id}`
      );
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

  try {
    await mod.install(ctx);
    const result = await mod.check(ctx);
    if (result.installed) {
      const ver = result.version ? ` (${result.version})` : "";
      console.log(`✓ ${mod.meta.name} installed${ver}`);
      console.log(`  Use: ${mod.meta.usage}`);
      console.log(`  More: brian module help ${mod.meta.id}`);
    } else {
      console.log(`⚠ ${mod.meta.name} not ready after install`);
      for (const issue of result.issues ?? []) {
        console.log(`  → ${issue}`);
      }
      console.log(`  See: brian module help ${mod.meta.id}`);
    }
  } catch (err) {
    console.error(`✗ ${mod.meta.name} install failed: ${err}`);
    console.error(`  Retry: brian module install ${mod.meta.id}`);
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
      if (result.installed) {
        const ver = result.version ? ` (${result.version})` : "";
        console.log(`✓ ${mod.meta.name}${ver}`);
      } else {
        console.log(`✗ ${mod.meta.name}`);
        for (const issue of result.issues ?? []) {
          console.log(`  → ${issue}`);
        }
        console.log(`  Install: brian module install ${mod.meta.id}`);
      }
    } catch (err) {
      console.log(`✗ ${mod.meta.name}: check failed — ${err}`);
    }
  }
}

async function handleModuleHelp(name: string): Promise<void> {
  const mod = getModule(name);
  if (!mod) {
    console.error(
      `Unknown module: ${name}\nAvailable: ${registry.map((m) => m.meta.id).join(", ")}`
    );
    process.exit(1);
  }
  console.log(mod.meta.help);
}

// ─────────────────────────────────────────────────
// redeploy / doctor / sync
// ─────────────────────────────────────────────────

async function handleRedeploy(): Promise<void> {
  const ctx = resolveContext();

  console.log("Pulling latest...");
  execSync(`git -C ${ctx.repoDir} pull origin main`, { stdio: "inherit" });

  console.log("Installing dependencies...");
  execSync(`cd ${ctx.repoDir} && npm install`, { stdio: "inherit" });

  console.log("Building...");
  execSync(`cd ${ctx.repoDir} && npm run build`, { stdio: "inherit" });

  console.log("Validating configuration...");
  try {
    await checkModelConfig();
    console.log("✓ Config is valid");
  } catch (err) {
    console.error(`✗ Config check failed: ${(err as Error).message}`);
    process.exit(1);
  }

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

async function handleConfigCheck(): Promise<void> {
  try {
    await checkModelConfig();
    console.log("✓ Config and model connectivity check passed");
  } catch (err) {
    console.error(`✗ Config check failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function handleDoctor(): Promise<void> {
  const name = process.env.BRIAN_NAME ?? "(not set)";
  const provider = process.env.MODEL_PROVIDER ?? "?";
  const project = process.env.GCP_PROJECT ?? "(not set)";

  console.log(`${name} @ ${project}`);
  console.log(`  Model: ${provider}`);
  console.log(`  Config: /etc/brian/env`);
  console.log(`  To change: edit /etc/brian/env, then brian redeploy`);
  console.log();
  await handleModuleCheck();
}

async function handleSync(args: string[]): Promise<void> {
  const ctx = resolveContext();
  const force = args.includes("--force");

  if (args.includes("--check")) {
    console.log("Checking fork status...");
    await syncCheck(ctx);
    console.log("✓ Status written to context/fork-status.md");
    return;
  }

  console.log("Syncing fork with upstream...");
  try {
    if (force) {
      console.log("Force mode: discarding local working tree changes...");
      execFileSync("git", ["-C", ctx.repoDir, "reset", "--hard"], {
        stdio: "inherit",
      });
      execFileSync("git", ["-C", ctx.repoDir, "clean", "-fd"], {
        stdio: "inherit",
      });
    }

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
        " merge upstream/main (or retry with: brian sync --force)"
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
    case "redeploy":
      await handleRedeploy();
      break;
    case "config":
      if (subcommand === "check") {
        await handleConfigCheck();
        break;
      }
      console.error("Usage: brian config check");
      process.exit(1);
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
        case "help":
          if (!rest[0]) {
            console.error("Usage: brian module help <name>");
            process.exit(1);
          }
          await handleModuleHelp(rest[0]);
          break;
        default:
          console.error("Usage: brian module <list|install|check|help>");
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
