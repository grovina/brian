#!/usr/bin/env node

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { execFileSync, execSync } from "child_process";
import { promisify } from "util";
import { execFile } from "child_process";
import { checkModelConfig } from "../model.js";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Context {
  repoDir: string;
  stateDir: string;
}

function resolveContext(): Context {
  const home = process.env.HOME ?? "/home/brian";
  return {
    repoDir: process.env.BRIAN_REPO_DIR ?? resolve(__dirname, "../.."),
    stateDir: process.env.BRIAN_STATE_DIR ?? resolve(home, ".brian"),
  };
}

function printUsage(): void {
  console.log(`brian — manage your brian instance

Commands:
  setup                       Initialize state and start daemon
  redeploy                    Pull, build, restart (with rollback)
  config check                Validate runtime config and model connectivity
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
  await fs.mkdir(resolve(ctx.stateDir, "context"), { recursive: true });
  await fs.mkdir(resolve(ctx.stateDir, "logs"), { recursive: true });

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
  console.log();

  try {
    await checkModelConfig();
    console.log("  ✓ Model connectivity");
  } catch (err) {
    console.log(`  ✗ Model: ${(err as Error).message}`);
  }

  if (process.env.SLACK_TOKEN) {
    console.log("  ✓ Slack configured");
  } else {
    console.log("  · Slack not configured (SLACK_TOKEN not set)");
  }

  const ctx = resolveContext();
  try {
    await execFileAsync("git", ["-C", ctx.repoDir, "rev-parse", "--is-inside-work-tree"], { timeout: 5000 });
    console.log("  ✓ Git repo");
  } catch {
    console.log("  ✗ Not a git repo");
  }
}

// ─────────────────────────────────────────────────
// sync
// ─────────────────────────────────────────────────

async function runGit(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", dir, ...args], {
    timeout: 15_000,
  });
  return stdout.trim();
}

async function syncCheck(ctx: Context): Promise<void> {
  const contextDir = resolve(ctx.stateDir, "context");
  await fs.mkdir(contextDir, { recursive: true });
  const statusFile = resolve(contextDir, "fork-status.md");

  try {
    await runGit(ctx.repoDir, ["fetch", "--all", "--prune"]);

    let upstream = "upstream";
    try {
      await runGit(ctx.repoDir, ["remote", "get-url", upstream]);
    } catch {
      upstream = "origin";
    }

    const branch = "main";
    const range = `origin/${branch}...${upstream}/${branch}`;
    const counts = await runGit(ctx.repoDir, [
      "rev-list",
      "--left-right",
      "--count",
      range,
    ]);
    const [aheadRaw, behindRaw] = counts.split(/\s+/);
    const ahead = parseInt(aheadRaw ?? "0", 10) || 0;
    const behind = parseInt(behindRaw ?? "0", 10) || 0;

    const now = new Date().toISOString();
    let status = `## Fork Status\n\nChecked: ${now}\n`;

    if (behind > 0) {
      status += `\nFork is **${behind} commits behind** ${upstream}/${branch}. Consider syncing: \`brian sync\`\n`;
    }
    if (ahead > 0) {
      status += `\nFork is **${ahead} commits ahead** of ${upstream}/${branch}. Consider opening a PR to upstream.\n`;
    }
    if (ahead === 0 && behind === 0) {
      status += `\nFork is up to date with ${upstream}/${branch}.\n`;
    }

    await fs.writeFile(statusFile, status);
  } catch (err) {
    await fs.writeFile(
      statusFile,
      `## Fork Status\n\nCheck failed: ${(err as Error).message}\n`
    );
  }
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
