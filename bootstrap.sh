#!/bin/bash
set -euo pipefail

bold() { printf "\033[1m%s\033[0m" "$1"; }
dim() { printf "\033[2m%s\033[0m" "$1"; }
green() { printf "\033[32m%s\033[0m" "$1"; }
red() { printf "\033[31m%s\033[0m" "$1"; }
yellow() { printf "\033[33m%s\033[0m" "$1"; }

step() { printf "\n  %s %s\n" "$(bold "→")" "$(bold "$1")"; }
ok() { printf "    %s %s\n" "$(green "✓")" "$1"; }
skip() { printf "    %s %s\n" "$(dim "·")" "$(dim "$1")"; }
fail() { printf "    %s %s\n" "$(red "✗")" "$1"; }
info() { printf "    %s\n" "$1"; }

ask() {
  local prompt="$1" default="${2:-}" var_name="$3"
  if [[ -n "$default" ]]; then
    printf "    %s %s: " "$(bold "$prompt")" "$(dim "$default")"
  else
    printf "    %s: " "$(bold "$prompt")"
  fi
  read -r value < /dev/tty
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  eval "$var_name=\"${value:-$default}\""
}

ask_choice() {
  local prompt="$1" var_name="$2"
  shift 2
  local options=("$@")
  printf "    %s\n" "$(bold "$prompt")"
  for i in "${!options[@]}"; do
    printf "      %s) %s\n" "$((i+1))" "${options[$i]}"
  done
  printf "    %s: " "$(bold "choice")"
  read -r choice < /dev/tty
  choice="${choice#"${choice%%[![:space:]]*}"}"
  choice="${choice%"${choice##*[![:space:]]}"}"
  local idx=$(( ${choice:-1} - 1 ))
  if (( idx < 0 || idx >= ${#options[@]} )); then
    idx=0
  fi
  eval "$var_name=\"$idx\""
}

confirm() {
  printf "\n  %s " "$(bold "$1 (Y/n)")"
  read -r answer < /dev/tty
  [[ -z "$answer" || "$answer" =~ ^[Yy] ]]
}

wait_for_enter() {
  printf "\n  %s " "$(bold "$1")"
  read -r _ < /dev/tty
}

# ─────────────────────────────────────────────────
# Phase 1: Prerequisites
# ─────────────────────────────────────────────────

echo
echo "  ┌─────────────────────────┐"
echo "  │   create a new brian    │"
echo "  └─────────────────────────┘"

step "Checking prerequisites"

HAS_GH=false

if ! command -v node &>/dev/null; then
  fail "node not found — install Node.js 22+ from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if (( NODE_VERSION < 22 )); then
  fail "node $(node -v) found — need v22+"
  exit 1
fi
ok "node $(node -v)"

if ! command -v npm &>/dev/null; then
  fail "npm not found"
  exit 1
fi
ok "npm $(npm -v)"

if ! command -v git &>/dev/null; then
  fail "git not found"
  exit 1
fi
ok "git"

if command -v gh &>/dev/null; then
  if gh auth status &>/dev/null; then
    HAS_GH=true
    ok "gh (authenticated)"
  else
    skip "gh found but not authenticated — skipping GitHub steps"
    info "Run $(bold "gh auth login") to enable GitHub integration"
  fi
else
  skip "gh not found — skipping GitHub steps"
  info "Install from https://cli.github.com to enable GitHub integration"
fi

# ─────────────────────────────────────────────────
# Phase 2: Decisions
# ─────────────────────────────────────────────────

step "Configuration"

ask "github org" "" GITHUB_ORG
ask "bot name" "" BRIAN_NAME

if [[ -z "$BRIAN_NAME" ]]; then
  fail "A name is required"
  exit 1
fi

if [[ "$BRIAN_NAME" == "brian" ]]; then
  fail "Name can't be 'brian' — it conflicts with the framework fork repo"
  info "Pick a name that's unique to your org (e.g. brianna, jarvis, friday)"
  exit 1
fi

echo
ask_choice "model provider" MODEL_CHOICE "Vertex AI (Gemini)" "Anthropic (Claude)"

if (( MODEL_CHOICE == 0 )); then
  MODEL_PROVIDER="vertex-ai"
  ask "gcp project" "" GCP_PROJECT
  ask "gcp region" "europe-west1" GCP_REGION
  if [[ -z "$GCP_PROJECT" ]]; then
    fail "GCP project is required for Vertex AI"
    exit 1
  fi
else
  MODEL_PROVIDER="anthropic"
  GCP_PROJECT=""
  GCP_REGION=""
fi

# ─────────────────────────────────────────────────
# Phase 3: Generate .env, pause for secrets
# ─────────────────────────────────────────────────

PROJECT_DIR="${BRIAN_NAME}"
DOCS_BASE="https://github.com/grovina/brian/blob/main/docs"
mkdir -p "$PROJECT_DIR"

{
  echo "BRIAN_NAME=${BRIAN_NAME}"
  echo "GITHUB_ORG=${GITHUB_ORG}"
  echo ""
  if [[ "$MODEL_PROVIDER" == "vertex-ai" ]]; then
    echo "# Vertex AI — ${DOCS_BASE}/vertex-ai-setup.md"
    echo "GCP_PROJECT=${GCP_PROJECT}"
    echo "GCP_REGION=${GCP_REGION}"
  else
    echo "# Anthropic — ${DOCS_BASE}/anthropic-setup.md"
    echo "ANTHROPIC_API_KEY=    # sk-ant-..."
  fi
  echo ""
  echo "# Slack user token — ${DOCS_BASE}/slack-setup.md"
  echo "SLACK_TOKEN=    # xoxp-..."
  echo ""
  echo "# GitHub PAT for brian — ${DOCS_BASE}/github-setup.md"
  echo "GITHUB_TOKEN=    # ghp_..."
} > "$PROJECT_DIR/.env"

step "Fill in your tokens"
echo
info "Created $(bold "${PROJECT_DIR}/.env") — open it and fill in the empty values."
info "Each field has a setup guide linked in the comments."

wait_for_enter "Press Enter when ready..."

# ─────────────────────────────────────────────────
# Phase 4: Read .env, validate, plan
# ─────────────────────────────────────────────────

source "$PROJECT_DIR/.env"

MISSING=()
[[ -z "${SLACK_TOKEN:-}" ]] && MISSING+=("SLACK_TOKEN")
if [[ "$MODEL_PROVIDER" == "anthropic" ]]; then
  [[ -z "${ANTHROPIC_API_KEY:-}" ]] && MISSING+=("ANTHROPIC_API_KEY")
fi

if (( ${#MISSING[@]} > 0 )); then
  fail "Still missing in .env: ${MISSING[*]}"
  info "Fill them in and re-run $(bold "./bootstrap.sh")"
  exit 1
fi

BRIAN_DEP="github:grovina/brian"

step "Plan"

if [[ -n "$GITHUB_ORG" ]] && $HAS_GH; then
  BRIAN_DEP="github:${GITHUB_ORG}/brian"

  echo
  info "This creates two repos in $(bold "$GITHUB_ORG"):"
  echo
  info "  $(bold "${GITHUB_ORG}/brian")    fork of the framework — shared, editable"
  info "                       ${BRIAN_NAME} uses this as a dependency and can"
  info "                       improve it directly, then PR back to upstream"
  echo
  info "  $(bold "${GITHUB_ORG}/${BRIAN_NAME}")   ${BRIAN_NAME}'s own project — private, org-specific"
  info "                       name, instructions, MCP configs, deploy scripts"
  echo
fi

info "$(dim "actions:")"
if [[ -n "$GITHUB_ORG" ]] && $HAS_GH; then
  info "  Fork $(bold "grovina/brian") → $(bold "${GITHUB_ORG}/brian")"
  info "  Create repo $(bold "${GITHUB_ORG}/${BRIAN_NAME}") (private)"
fi
info "  Scaffold $(bold "${PROJECT_DIR}/") — src/main.ts, instructions, mcp, deploy"
info "  Model: $(bold "$MODEL_PROVIDER")"
info "  Install npm packages"

if ! confirm "Proceed?"; then
  echo "  Cancelled."
  exit 0
fi

# ─────────────────────────────────────────────────
# Phase 5: Execute
# ─────────────────────────────────────────────────

# --- Fork ---

if [[ -n "$GITHUB_ORG" ]] && $HAS_GH; then
  step "Forking framework"

  if gh repo view "${GITHUB_ORG}/brian" &>/dev/null; then
    skip "Fork ${GITHUB_ORG}/brian already exists"
  else
    gh repo fork grovina/brian --org "$GITHUB_ORG" --clone=false 2>/dev/null
    ok "Forked → ${GITHUB_ORG}/brian"
  fi
fi

# --- Scaffold files ---

step "Scaffolding project"

mkdir -p "$PROJECT_DIR/src" "$PROJECT_DIR/mcp" "$PROJECT_DIR/setup"

MODEL_SDK_DEP=""
if [[ "$MODEL_PROVIDER" == "vertex-ai" ]]; then
  MODEL_SDK_DEP='"@google/genai": "^1.42.0"'
else
  MODEL_SDK_DEP='"@anthropic-ai/sdk": "^0.78.0"'
fi

cat > "$PROJECT_DIR/package.json" << PKGJSON
{
  "name": "${BRIAN_NAME}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc",
    "start": "node --env-file=.env dist/main.js",
    "dev": "tsx --env-file=.env src/main.ts",
    "typecheck": "tsc --noEmit"
  },
  "engines": {
    "node": ">=22"
  },
  "dependencies": {
    "brian": "${BRIAN_DEP}",
    ${MODEL_SDK_DEP}
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3"
  }
}
PKGJSON
ok "package.json"

cat > "$PROJECT_DIR/tsconfig.json" << 'TSCONFIG'
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
TSCONFIG
ok "tsconfig.json"

if [[ "$MODEL_PROVIDER" == "vertex-ai" ]]; then
  cat > "$PROJECT_DIR/src/main.ts" << MAIN
import { Brian, AutonomousWake, bash, selfDeploy } from 'brian';
import { VertexAIModel } from 'brian/models/vertex-ai';

const brian = new Brian({
  name: process.env.BRIAN_NAME || '${BRIAN_NAME}',

  model: new VertexAIModel({
    project: process.env.GCP_PROJECT!,
    region: process.env.GCP_REGION || 'europe-west1',
  }),

  wake: new AutonomousWake(),

  tools: [bash, selfDeploy()],

  mcp: './mcp/',
  instructions: './instructions.md',
});

await brian.start();
MAIN
else
  cat > "$PROJECT_DIR/src/main.ts" << MAIN
import { Brian, AutonomousWake, bash, selfDeploy } from 'brian';
import { AnthropicModel } from 'brian/models/anthropic';

const brian = new Brian({
  name: process.env.BRIAN_NAME || '${BRIAN_NAME}',

  model: new AnthropicModel({
    apiKey: process.env.ANTHROPIC_API_KEY,
  }),

  wake: new AutonomousWake(),

  tools: [bash, selfDeploy()],

  mcp: './mcp/',
  instructions: './instructions.md',
});

await brian.start();
MAIN
fi
ok "src/main.ts"

if [[ -n "$GITHUB_ORG" ]]; then
  cat > "$PROJECT_DIR/instructions.md" << INSTRUCTIONS
## First Run

This is your first deployment. Introduce yourself on Slack, explain what you
can do, and ask the team what they need. Once you've done that, remove this
section and commit the change.

## About

You're built on the brian framework. Your org has a fork at
github.com/${GITHUB_ORG}/brian (upstream: github.com/grovina/brian).

When you identify improvements that would benefit all brians, make changes
in the fork and open a PR to upstream. Keep the fork in sync with upstream
by periodically pulling from grovina/brian.
INSTRUCTIONS
else
  cat > "$PROJECT_DIR/instructions.md" << 'INSTRUCTIONS'
## First Run

This is your first deployment. Introduce yourself on Slack, explain what you
can do, and ask the team what they need. Once you've done that, remove this
section and commit the change.

## About

You're built on the brian framework (github.com/grovina/brian). When you
identify improvements that would benefit all brians, clone the framework
repo, make changes, and open a PR.
INSTRUCTIONS
fi
ok "instructions.md"

if [[ -n "${SLACK_TOKEN:-}" ]]; then
  cat > "$PROJECT_DIR/mcp/slack.json" << 'MCPSLACK'
{
  "name": "slack",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-slack"],
  "env": {
    "SLACK_BOT_TOKEN": "${SLACK_TOKEN}"
  }
}
MCPSLACK
  ok "mcp/slack.json"
fi

if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  cat > "$PROJECT_DIR/mcp/github.json" << 'MCPGITHUB'
{
  "name": "github",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
  }
}
MCPGITHUB
  ok "mcp/github.json"
fi

# .env already has the user's values from Phase 3 — no need to rewrite it
ok ".env"

cat > "$PROJECT_DIR/.gitignore" << 'GITIGNORE'
node_modules/
dist/
.env
GITIGNORE
ok ".gitignore"

cat > "$PROJECT_DIR/setup/deploy-self.sh" << 'DEPLOY'
#!/bin/bash
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
DEPLOY
chmod +x "$PROJECT_DIR/setup/deploy-self.sh"
ok "setup/deploy-self.sh"

cat > "$PROJECT_DIR/setup/brian.service" << SERVICE
[Unit]
Description=${BRIAN_NAME}
After=network.target

[Service]
Type=simple
User=brian
WorkingDirectory=/home/brian/app
EnvironmentFile=/etc/brian/env
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5
StartLimitBurst=5
StartLimitIntervalSec=60

[Install]
WantedBy=multi-user.target
SERVICE
ok "setup/brian.service"

cat > "$PROJECT_DIR/please" << 'PLEASE'
#!/bin/bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/.env"

load_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Missing .env file. Copy .env.example and fill in your values."
    exit 1
  fi
  source "$ENV_FILE"
  for var in SLACK_TOKEN; do
    if [[ -z "${!var:-}" ]]; then
      echo "Missing $var in .env"
      exit 1
    fi
  done
  BRIAN_NAME="${BRIAN_NAME:-brian}"
}

gcp_vars() {
  VM="${BRIAN_NAME}"
  ZONE="${GCE_ZONE:-europe-west1-b}"
  MACHINE_TYPE="${GCE_MACHINE_TYPE:-e2-small}"
  BOOT_DISK_SIZE="${GCE_BOOT_DISK_SIZE:-20GB}"
}

run_provision() {
  echo "Installing system packages..."
  $REMOTE_SSH "
    sudo apt-get update &&
    sudo apt-get install -y curl git build-essential ca-certificates gnupg &&
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - &&
    sudo apt-get install -y nodejs
  "

  echo "Setting up brian user..."
  $REMOTE_SSH "
    id brian &>/dev/null || sudo useradd -m -s /bin/bash brian &&
    echo 'brian ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart brian, /usr/bin/systemctl stop brian, /usr/bin/systemctl start brian, /usr/bin/systemctl daemon-reload' | sudo tee /etc/sudoers.d/brian > /dev/null &&
    sudo chmod 440 /etc/sudoers.d/brian
  "

  echo "Deploying environment..."
  $REMOTE_SCP "$ENV_FILE" "${REMOTE_TARGET}:/tmp/brian.env"
  $REMOTE_SSH "
    sudo mkdir -p /etc/brian &&
    sudo mv /tmp/brian.env /etc/brian/env &&
    sudo chmod 600 /etc/brian/env
  "

  local REPO_URL
  if [[ -n "${GITHUB_ORG:-}" && -n "${GITHUB_TOKEN:-}" ]]; then
    REPO_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_ORG}/${BRIAN_NAME}.git"
  else
    REPO_URL="$(git remote get-url origin 2>/dev/null || echo '')"
  fi

  echo "Configuring git..."
  $REMOTE_SSH "
    sudo -u brian git config --global user.name '${BRIAN_NAME}' &&
    sudo -u brian git config --global user.email '${BRIAN_NAME}@${GITHUB_ORG:-local}.com'
  "

  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    $REMOTE_SSH "
      sudo -u brian git config --global credential.helper store &&
      echo 'https://x-access-token:${GITHUB_TOKEN}@github.com' | sudo -u brian tee /home/brian/.git-credentials > /dev/null &&
      sudo chmod 600 /home/brian/.git-credentials
    "
  fi

  if [[ -n "$REPO_URL" ]]; then
    echo "Cloning and building..."
    $REMOTE_SSH "
      sudo -u brian bash -c '
        set -e
        if [ -d /home/brian/app ]; then
          cd /home/brian/app && git pull origin main
        else
          git clone $REPO_URL /home/brian/app
          cd /home/brian/app
        fi
        npm install && npm run build
        mkdir -p /home/brian/projects
        cp setup/deploy-self.sh /home/brian/deploy-self.sh
        chmod +x /home/brian/deploy-self.sh
      '
    "
  fi

  echo "Installing systemd service..."
  $REMOTE_SSH "
    sudo cp /home/brian/app/setup/brian.service /etc/systemd/system/brian.service &&
    sudo systemctl daemon-reload &&
    sudo systemctl enable brian &&
    sudo systemctl restart brian
  "

  echo "Waiting for startup..."
  sleep 10
}

cmd_deploy_gcp() {
  load_env && gcp_vars

  REMOTE_SSH="gcloud compute ssh $VM --zone=$ZONE --command"
  REMOTE_SCP="gcloud compute scp --zone=$ZONE"
  REMOTE_TARGET="$VM"

  if ! gcloud compute instances describe "$VM" --zone="$ZONE" &>/dev/null; then
    echo "Creating VM '$VM' ($MACHINE_TYPE, $BOOT_DISK_SIZE)..."
    gcloud compute instances create "$VM" \
      --zone="$ZONE" \
      --machine-type="$MACHINE_TYPE" \
      --boot-disk-size="$BOOT_DISK_SIZE" \
      --image-family="debian-12" \
      --image-project="debian-cloud" \
      --scopes="https://www.googleapis.com/auth/cloud-platform" \
      --tags="brian"

    echo "Waiting for SSH..."
    for i in {1..30}; do
      if $REMOTE_SSH "true" &>/dev/null; then break; fi
      sleep 5
    done
  fi

  run_provision
  $REMOTE_SSH "systemctl is-active brian"
  echo "${BRIAN_NAME} is running on GCP!"
}

cmd_deploy_local() {
  local target="${1:?Usage: ./please deploy local user@hostname}"
  load_env

  REMOTE_SSH="ssh $target"
  REMOTE_SCP="scp"
  REMOTE_TARGET="$target"

  echo "Testing connection to $target..."
  if ! $REMOTE_SSH "true" 2>/dev/null; then
    echo "Cannot connect to $target."
    exit 1
  fi

  run_provision

  if $REMOTE_SSH "systemctl is-active brian" &>/dev/null; then
    echo "${BRIAN_NAME} is running!"
  else
    echo "Failed to start. Check: ssh $target 'journalctl -u brian -n 50'"
    exit 1
  fi
}

cmd_destroy() {
  load_env && gcp_vars
  echo "Destroying VM ($VM in $ZONE)..."
  gcloud compute instances delete "$VM" --zone="$ZONE" --quiet
  echo "Done."
}

cmd_logs() { load_env && gcp_vars && gcloud compute ssh "$VM" --zone="$ZONE" --command "journalctl -u brian -f"; }
cmd_ssh() { load_env && gcp_vars && gcloud compute ssh "$VM" --zone="$ZONE"; }

cmd_status() {
  load_env && gcp_vars
  echo -n "${BRIAN_NAME} on ${VM} (${ZONE}): "
  gcloud compute ssh "$VM" --zone="$ZONE" --command "systemctl is-active brian" 2>/dev/null || echo "not running"
}

cmd_restart() {
  load_env && gcp_vars
  echo "Restarting ${BRIAN_NAME}..."
  gcloud compute ssh "$VM" --zone="$ZONE" --command "sudo -u brian /home/brian/deploy-self.sh"
}

cmd_help() {
  cat <<'EOF'
./please — deploy and manage your brian

Commands:
  deploy gcp                Deploy to a GCP VM
  deploy local user@host    Deploy to a local server
  restart                   Pull latest and restart (GCP)
  destroy                   Destroy the GCP VM
  logs                      Tail logs (GCP)
  ssh                       SSH into the VM (GCP)
  status                    Check if running (GCP)
  help                      This message
EOF
}

case "${1:-help}" in
  deploy) case "${2:-gcp}" in
    gcp)   cmd_deploy_gcp ;;
    local) cmd_deploy_local "${3:-}" ;;
    *)     echo "Unknown target: $2" ;;
  esac ;;
  restart) cmd_restart ;;
  destroy) cmd_destroy ;;
  logs)    cmd_logs ;;
  ssh)     cmd_ssh ;;
  status)  cmd_status ;;
  help|*)  cmd_help ;;
esac
PLEASE
chmod +x "$PROJECT_DIR/please"
ok "please"

# --- Git + GitHub ---

if [[ -n "$GITHUB_ORG" ]] && $HAS_GH; then
  step "Creating GitHub repo"

  cd "$PROJECT_DIR"

  if [[ ! -d .git ]]; then
    git init -q
  fi

  git add -A
  git commit -q -m "initial ${BRIAN_NAME}" --allow-empty 2>/dev/null || true

  if gh repo view "${GITHUB_ORG}/${BRIAN_NAME}" &>/dev/null; then
    skip "Repo ${GITHUB_ORG}/${BRIAN_NAME} already exists"
    git remote add origin "https://github.com/${GITHUB_ORG}/${BRIAN_NAME}.git" 2>/dev/null || true
    git push -u origin main 2>/dev/null || true
  else
    gh repo create "${GITHUB_ORG}/${BRIAN_NAME}" --private --source=. --push
    ok "Created ${GITHUB_ORG}/${BRIAN_NAME}"
  fi
else
  cd "$PROJECT_DIR"
  if [[ ! -d .git ]]; then
    git init -q
    git add -A
    git commit -q -m "initial ${BRIAN_NAME}"
    ok "Initialized local git repo"
  fi
fi

# --- Install ---

step "Installing dependencies"

npm install 2>&1 | tail -3
ok "npm install"

# ─────────────────────────────────────────────────
# Phase 6: Summary
# ─────────────────────────────────────────────────

step "Done!"
echo
info "$(bold "$BRIAN_NAME") is ready in $(bold "./$PROJECT_DIR/")"
echo

if [[ -n "$GITHUB_ORG" ]] && $HAS_GH; then
  info "$(dim "repos:")"
  info "  $(bold "${GITHUB_ORG}/brian")          framework fork"
  info "  $(bold "${GITHUB_ORG}/${BRIAN_NAME}")   ${BRIAN_NAME}'s project"
  echo
fi

info "$(dim "next steps:")"
info "  $(bold "cd ${PROJECT_DIR}")"
info "  $(bold "npm run dev")              run locally"
info "  $(bold "./please deploy gcp")      deploy to a GCP VM"
echo
info "${BRIAN_NAME} will introduce itself on Slack"
info "and help set up everything else."
echo
