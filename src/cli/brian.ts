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
    appDir: process.env.BRIAN_APP_DIR ?? resolve(home, "app"),
    stateDir: process.env.BRIAN_STATE_DIR ?? resolve(home, ".brian"),
    frameworkDir:
      process.env.BRIAN_FRAMEWORK_DIR ?? resolve(__dirname, "../.."),
  };
}

function printUsage(): void {
  console.log(`brian — manage your brian instance

Commands:
  setup                       Scaffold app, install modules, start daemon
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
  const brianDep = `file:${ctx.frameworkDir}`;

  if (await isDirectory(resolve(ctx.appDir, ".git"))) {
    console.log("Updating existing project...");
    execSync(`git -C ${ctx.appDir} fetch origin main -q`, { stdio: "inherit" });
    execSync(`git -C ${ctx.appDir} reset --hard origin/main -q`, {
      stdio: "inherit",
    });
  } else {
    console.log("Scaffolding project...");
    await scaffoldProject(ctx.appDir, brianDep, name);

    if (process.env.GITHUB_TOKEN && process.env.GITHUB_ORG) {
      await createGitHubRepo(ctx.appDir, name);
    }
  }

  console.log("Building...");
  execSync(`cd ${ctx.appDir} && npm install --silent ${brianDep} && npm run build --silent`, {
    stdio: "inherit",
  });

  console.log("Installing default modules...");
  for (const mod of registry.filter((m) => m.meta.default)) {
    try {
      await mod.install(ctx);
      console.log(`  ✓ ${mod.meta.name}`);
    } catch (err) {
      console.error(`  ✗ ${mod.meta.name}: ${err}`);
    }
  }

  await installService(name, ctx.appDir);

  console.log(`\n${name} is running!`);
}

async function scaffoldProject(
  appDir: string,
  brianDep: string,
  name: string
): Promise<void> {
  await fs.mkdir(resolve(appDir, "src"), { recursive: true });
  await fs.mkdir(resolve(appDir, "mcp"), { recursive: true });
  await fs.mkdir(resolve(appDir, "setup"), { recursive: true });

  const provider = process.env.MODEL_PROVIDER ?? "vertex-ai";
  const org = process.env.GITHUB_ORG ?? "";

  const modelSdkDep =
    provider === "vertex-ai"
      ? '"@google/genai": "^1.42.0"'
      : '"@anthropic-ai/sdk": "^0.78.0"';

  await fs.writeFile(
    resolve(appDir, "package.json"),
    JSON.stringify(
      {
        name,
        version: "0.1.0",
        private: true,
        type: "module",
        main: "dist/main.js",
        scripts: {
          build: "tsc",
          start: "node --env-file=.env dist/main.js",
          dev: "tsx --env-file=.env src/main.ts",
          typecheck: "tsc --noEmit",
        },
        engines: { node: ">=22" },
        dependencies: {
          brian: brianDep,
          ...(provider === "vertex-ai"
            ? { "@google/genai": "^1.42.0" }
            : { "@anthropic-ai/sdk": "^0.78.0" }),
        },
        devDependencies: {
          "@types/node": "^22.0.0",
          tsx: "^4.21.0",
          typescript: "^5.9.3",
        },
      },
      null,
      2
    ) + "\n"
  );

  await fs.writeFile(
    resolve(appDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2024",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          outDir: "dist",
          rootDir: "src",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
        },
        include: ["src/**/*"],
        exclude: ["node_modules", "dist"],
      },
      null,
      2
    ) + "\n"
  );

  const modelImport =
    provider === "vertex-ai"
      ? `import { VertexAIModel } from 'brian/models/vertex-ai';\n`
      : `import { AnthropicModel } from 'brian/models/anthropic';\n`;

  const modelConfig =
    provider === "vertex-ai"
      ? `  model: new VertexAIModel({
    project: process.env.GCP_PROJECT!,
    region: process.env.VERTEX_AI_LOCATION,
  }),`
      : `  model: new AnthropicModel({
    apiKey: process.env.ANTHROPIC_API_KEY,
  }),`;

  await fs.writeFile(
    resolve(appDir, "src/main.ts"),
    `import { Brian, AutonomousWake, bash, selfDeploy } from 'brian';
${modelImport}
const brian = new Brian({
  name: process.env.BRIAN_NAME || '${name}',

${modelConfig}

  wake: new AutonomousWake(),

  tools: [bash, selfDeploy()],

  mcp: './mcp/',
  instructions: './instructions.md',
});

await brian.start();
`
  );

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

When you identify improvements that would benefit all brians, make changes
in the fork and open a PR to upstream.
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

  await fs.writeFile(resolve(appDir, "instructions.md"), instructions);

  await fs.writeFile(
    resolve(appDir, ".gitignore"),
    "node_modules/\ndist/\n.env\n"
  );

  await fs.writeFile(
    resolve(appDir, "setup/deploy-self.sh"),
    `#!/bin/bash
set -e
cd "$(dirname "$0")/.."
PREVIOUS=$(git rev-parse HEAD)
git pull origin main
npm install
npm run build
sudo systemctl restart brian
sleep 20
if ! systemctl is-active --quiet brian; then
  echo "New version failed, rolling back to $PREVIOUS"
  git checkout "$PREVIOUS"
  npm install
  npm run build
  sudo systemctl restart brian
fi
`
  );
  await fs.chmod(resolve(appDir, "setup/deploy-self.sh"), 0o755);
}

async function createGitHubRepo(
  appDir: string,
  name: string
): Promise<void> {
  const org = process.env.GITHUB_ORG!;
  const token = process.env.GITHUB_TOKEN!;

  console.log("Creating GitHub repo...");
  try {
    const res = await fetch(
      `https://api.github.com/repos/${org}/${name}`,
      { headers: { Authorization: `token ${token}` } }
    );
    if (res.status !== 200) {
      await fetch(`https://api.github.com/orgs/${org}/repos`, {
        method: "POST",
        headers: {
          Authorization: `token ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, private: true }),
      });
    }

    execSync(
      [
        `cd ${appDir}`,
        "git init -q",
        "git add -A",
        `git commit -q -m 'initial ${name}'`,
        `git remote add origin https://github.com/${org}/${name}.git 2>/dev/null || true`,
        "git push -u origin main -q 2>/dev/null || git push -u origin main --force-with-lease -q 2>/dev/null",
      ].join(" && "),
      { stdio: "inherit" }
    );
  } catch (err) {
    console.error("GitHub repo creation failed:", err);
  }
}

async function installService(
  name: string,
  appDir: string
): Promise<void> {
  const unit = `[Unit]
Description=${name}
After=network.target

[Service]
Type=simple
User=brian
WorkingDirectory=${appDir}
EnvironmentFile=/etc/brian/env
ExecStart=/usr/bin/node dist/main.js
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
      "Systemd not available — start manually: node dist/main.js"
    );
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
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
// doctor / sync
// ─────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const [command, subcommand, ...rest] = process.argv.slice(2);

  switch (command) {
    case "setup":
      await handleSetup();
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
