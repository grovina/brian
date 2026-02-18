#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 user@hostname"
  exit 1
fi

TARGET="$1"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing .env file. Copy .env.example to .env and fill in your values."
  exit 1
fi

source "$ENV_FILE"

for var in SLACK_BOT_TOKEN SLACK_CHANNEL_ID ANTHROPIC_API_KEY GITHUB_TOKEN; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing $var in .env"
    exit 1
  fi
done

BRIAN_NAME="${BRIAN_NAME:-brian}"
REPO="grovina/brian"
SSH="ssh $TARGET"
SCP="scp"

echo "Testing SSH connection to $TARGET..."
if ! $SSH "true" 2>/dev/null; then
  echo "Cannot connect to $TARGET."
  exit 1
fi

echo "Installing system packages..."
$SSH "
  sudo apt-get update &&
  sudo apt-get install -y curl git build-essential ca-certificates gnupg &&
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - &&
  sudo apt-get install -y nodejs
"

echo "Setting up brian user..."
$SSH "
  id brian &>/dev/null || sudo useradd -m -s /bin/bash brian &&
  echo 'brian ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart brian, /usr/bin/systemctl stop brian, /usr/bin/systemctl start brian, /usr/bin/systemctl daemon-reload' | sudo tee /etc/sudoers.d/brian > /dev/null &&
  sudo chmod 440 /etc/sudoers.d/brian
"

echo "Deploying environment..."
$SCP "$ENV_FILE" "$TARGET:/tmp/brian.env"
$SSH "
  sudo mkdir -p /etc/brian &&
  sudo mv /tmp/brian.env /etc/brian/env &&
  sudo chmod 600 /etc/brian/env
"

echo "Configuring git..."
$SSH "
  sudo -u brian git config --global user.name '${BRIAN_NAME}' &&
  sudo -u brian git config --global user.email 'brian@grovina.com' &&
  sudo -u brian git config --global credential.helper store &&
  echo 'https://x-access-token:${GITHUB_TOKEN}@github.com' | sudo -u brian tee /home/brian/.git-credentials > /dev/null &&
  sudo chmod 600 /home/brian/.git-credentials
"

echo "Cloning and building..."
$SSH "
  sudo -u brian bash -c '
    set -e
    if [ -d /home/brian/app ]; then
      cd /home/brian/app
      git remote set-url origin https://github.com/${REPO}.git
      git pull origin main
    else
      git clone https://github.com/${REPO}.git /home/brian/app
      cd /home/brian/app
    fi
    npm ci
    npm run build
    mkdir -p /home/brian/secrets /home/brian/projects
    cp deploy-self.sh /home/brian/deploy-self.sh
    chmod +x /home/brian/deploy-self.sh
  '
"

echo "Installing systemd service..."
$SSH "
  sudo cp /home/brian/app/setup/brian.service /etc/systemd/system/brian.service &&
  sudo systemctl daemon-reload &&
  sudo systemctl enable brian &&
  sudo systemctl restart brian
"

echo "Waiting for startup..."
sleep 10

if $SSH "systemctl is-active brian" &>/dev/null; then
  echo "${BRIAN_NAME} is running!"
  echo "Logs: ssh $TARGET 'journalctl -u brian -f'"
else
  echo "Failed to start. Check: ssh $TARGET 'journalctl -u brian -n 50'"
  exit 1
fi
