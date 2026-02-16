#!/bin/bash
set -euo pipefail

# Deploy Brian to a local/home server via SSH
# Usage: ./deploy-local.sh user@hostname

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 user@hostname"
  echo ""
  echo "Example: $0 brian@192.168.1.100"
  echo "         $0 brian@minipc.local"
  exit 1
fi

TARGET="$1"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing .env file. Copy .env.example to .env and fill in your values."
  exit 1
fi

source "$ENV_FILE"

for var in TELEGRAM_BOT_TOKEN TELEGRAM_OWNER_ID ANTHROPIC_API_KEY GITHUB_TOKEN; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing $var in .env"
    exit 1
  fi
done

REPO="grovina/brian"
SSH="ssh $TARGET"
SCP="scp"

echo "Testing SSH connection to $TARGET..."
if ! $SSH "true" 2>/dev/null; then
  echo "Cannot connect to $TARGET. Make sure:"
  echo "  1. SSH is enabled on the target"
  echo "  2. You can SSH without password (ssh-copy-id $TARGET)"
  echo "  3. Target hostname/IP is correct"
  exit 1
fi

echo "Checking sudo access..."
if ! $SSH "sudo -n true" 2>/dev/null; then
  echo "User needs passwordless sudo. Run on target:"
  echo "  echo '$USER ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/$USER"
  exit 1
fi

echo "Installing system packages..."
$SSH "
  sudo apt-get update &&
  sudo apt-get install -y curl git build-essential ca-certificates gnupg &&
  sudo install -m 0755 -d /etc/apt/keyrings &&
  curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg 2>/dev/null || true &&
  echo 'deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable' | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null || true &&
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - &&
  sudo apt-get update &&
  sudo apt-get install -y nodejs docker-ce docker-ce-cli containerd.io docker-compose-plugin
"

echo "Setting up brian user..."
$SSH "
  id brian &>/dev/null || sudo useradd -m -s /bin/bash brian &&
  sudo usermod -aG docker brian &&
  sudo systemctl enable docker &&
  sudo systemctl start docker &&
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
  sudo -u brian git config --global user.name 'Brian' &&
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

echo "Waiting for Brian to come alive..."
sleep 10

if $SSH "systemctl is-active brian" &>/dev/null; then
  echo "✓ Brian is running!"
  echo ""
  echo "Next steps:"
  echo "1. Install Ollama: ssh $TARGET 'docker run -d --name ollama -p 11434:11434 -v ollama:/root/.ollama ollama/ollama'"
  echo "2. Pull model: ssh $TARGET 'docker exec ollama ollama pull llama3.3:70b-instruct-q4_K_M'"
  echo "3. Check logs: ssh $TARGET 'journalctl -u brian -f'"
else
  echo "✗ Brian failed to start. Check logs:"
  echo "  ssh $TARGET 'journalctl -u brian -n 50'"
  exit 1
fi
