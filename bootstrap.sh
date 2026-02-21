#!/bin/bash
set -euo pipefail

# --- helpers ---

bold() { printf "\033[1m%s\033[0m" "$1"; }
dim() { printf "\033[2m%s\033[0m" "$1"; }
green() { printf "\033[32m%s\033[0m" "$1"; }

ask() {
  local prompt="$1" default="${2:-}" var_name="$3"
  if [[ -n "$default" ]]; then
    printf "  %s %s: " "$(bold "$prompt")" "$(dim "(default: $default)")"
  else
    printf "  %s: " "$(bold "$prompt")"
  fi
  read -r value
  eval "$var_name=\"${value:-$default}\""
}

ask_secret() {
  local prompt="$1" var_name="$2"
  printf "  %s: " "$(bold "$prompt")"
  read -rs value
  echo
  eval "$var_name=\"$value\""
}

check() { green "  ✓ $1"; echo; }

# --- main ---

echo
echo "  ┌─────────────────────────┐"
echo "  │   create a new brian    │"
echo "  └─────────────────────────┘"
echo

ask "brian name" "brian" BRIAN_NAME
ask "project directory" "${BRIAN_NAME}" PROJECT_DIR
echo
ask_secret "slack token (xoxp-...)" SLACK_TOKEN
ask "gcp project" "" GCP_PROJECT
ask "gcp region" "europe-west1" GCP_REGION
ask "github token (optional)" "" GITHUB_TOKEN
ask "github org (optional)" "" GITHUB_ORG
echo

# --- scaffold ---

mkdir -p "$PROJECT_DIR/src" "$PROJECT_DIR/mcp" "$PROJECT_DIR/setup"

# package.json
cat > "$PROJECT_DIR/package.json" << PKGJSON
{
  "name": "${BRIAN_NAME}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/main.js",
    "dev": "tsx src/main.ts",
    "typecheck": "tsc --noEmit"
  },
  "engines": {
    "node": ">=22"
  },
  "dependencies": {
    "brian": "github:grovina/brian"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3"
  }
}
PKGJSON
check "package.json"

# tsconfig.json
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
check "tsconfig.json"

# src/main.ts
cat > "$PROJECT_DIR/src/main.ts" << MAIN
import { Brian, VertexAI, PeriodicWake, bash, selfDeploy } from 'brian';

const brian = new Brian({
  name: process.env.BRIAN_NAME || '${BRIAN_NAME}',

  model: new VertexAI({
    project: process.env.GCP_PROJECT!,
    region: process.env.GCP_REGION || 'europe-west1',
  }),

  wake: new PeriodicWake({
    intervalMinutes: 3,
    maxIntervalMinutes: 60,
  }),

  tools: [bash, selfDeploy()],

  mcp: './mcp/',
  instructions: './instructions.md',
});

await brian.start();
MAIN
check "src/main.ts"

# instructions.md
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
check "instructions.md"

# MCP configs
if [[ -n "$SLACK_TOKEN" ]]; then
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
  check "mcp/slack.json"
fi

if [[ -n "$GITHUB_TOKEN" ]]; then
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
  check "mcp/github.json"
fi

# .env
cat > "$PROJECT_DIR/.env" << DOTENV
BRIAN_NAME=${BRIAN_NAME}
SLACK_TOKEN=${SLACK_TOKEN}
GCP_PROJECT=${GCP_PROJECT}
GCP_REGION=${GCP_REGION}
GITHUB_TOKEN=${GITHUB_TOKEN}
GITHUB_ORG=${GITHUB_ORG}
DOTENV
check ".env"

# .env.example
cat > "$PROJECT_DIR/.env.example" << 'DOTENVEX'
BRIAN_NAME=brian
SLACK_TOKEN=xoxp-...
GCP_PROJECT=your-project
GCP_REGION=europe-west1
GITHUB_TOKEN=ghp_...
GITHUB_ORG=your-org
DOTENVEX
check ".env.example"

# .gitignore
cat > "$PROJECT_DIR/.gitignore" << 'GITIGNORE'
node_modules/
dist/
.env
GITIGNORE
check ".gitignore"

# setup/deploy-self.sh
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
check "setup/deploy-self.sh"

# setup/brian.service
cat > "$PROJECT_DIR/setup/brian.service" << SERVICE
[Unit]
Description=Brian AI Agent (${BRIAN_NAME})
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
check "setup/brian.service"

# please
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
  for var in SLACK_TOKEN GCP_PROJECT; do
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
    REPO_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_ORG}/brian.git"
  else
    REPO_URL="$(git remote get-url origin 2>/dev/null || echo '')"
  fi

  echo "Configuring git..."
  $REMOTE_SSH "
    sudo -u brian git config --global user.name '${BRIAN_NAME}' &&
    sudo -u brian git config --global user.email 'brian@$(echo ${GITHUB_ORG:-local}).com'
  "

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
check "please"

# --- install ---

echo
echo "  Installing dependencies..."
cd "$PROJECT_DIR"
npm install --silent 2>&1 | tail -1
check "npm install"

echo
echo "  ┌─────────────────────────────────────────┐"
echo "  │  $(green "Done!") Your brian is ready.              │"
echo "  │                                         │"
echo "  │  cd $PROJECT_DIR"
echo "  │  npm run dev        # run locally        │"
echo "  │  ./please deploy gcp  # deploy to GCP   │"
echo "  │                                         │"
echo "  │  ${BRIAN_NAME} will introduce itself on Slack  │"
echo "  │  and help you set up everything else.   │"
echo "  └─────────────────────────────────────────┘"
echo
