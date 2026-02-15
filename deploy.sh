#!/bin/bash
set -euo pipefail

# Brian deployment script
# Usage: ./deploy.sh --telegram-token "..." --anthropic-key "..." --github-token "..." --owner-telegram-id "..."

PROJECT="grovina-brian"
ZONE="europe-west1-b"
MACHINE_TYPE="e2-small"
IMAGE_FAMILY="debian-12"
IMAGE_PROJECT="debian-cloud"
SERVICE_ACCOUNT_SCOPES="https://www.googleapis.com/auth/cloud-platform"
REPO="grovina/brian"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --telegram-token) TELEGRAM_TOKEN="$2"; shift 2 ;;
    --anthropic-key) ANTHROPIC_KEY="$2"; shift 2 ;;
    --github-token) GITHUB_TOKEN="$2"; shift 2 ;;
    --owner-telegram-id) OWNER_ID="$2"; shift 2 ;;
    --zone) ZONE="$2"; shift 2 ;;
    --machine-type) MACHINE_TYPE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

if [[ -z "${TELEGRAM_TOKEN:-}" || -z "${ANTHROPIC_KEY:-}" || -z "${GITHUB_TOKEN:-}" || -z "${OWNER_ID:-}" ]]; then
  echo "Usage: ./deploy.sh --telegram-token TOKEN --anthropic-key KEY --github-token TOKEN --owner-telegram-id ID"
  exit 1
fi

# Check if VM already exists
if gcloud compute instances describe "$PROJECT" --zone="$ZONE" &>/dev/null; then
  echo "VM exists, updating..."

  gcloud compute ssh "$PROJECT" --zone="$ZONE" --command="
    cd /home/brian/app &&
    git pull origin main &&
    npm ci &&
    npm run build &&
    sudo systemctl restart brian
  "

  echo "Updated and restarted."
  exit 0
fi

echo "Creating VM..."

gcloud compute instances create "$PROJECT" \
  --zone="$ZONE" \
  --machine-type="$MACHINE_TYPE" \
  --image-family="$IMAGE_FAMILY" \
  --image-project="$IMAGE_PROJECT" \
  --scopes="$SERVICE_ACCOUNT_SCOPES" \
  --tags="brian" \
  --metadata=startup-script='#!/bin/bash
    # This runs once on first boot
    apt-get update
    apt-get install -y curl git docker.io docker-compose-plugin build-essential

    # Install Node.js 22
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs

    # Create brian user
    useradd -m -s /bin/bash brian
    usermod -aG docker brian

    # Enable docker
    systemctl enable docker
    systemctl start docker
  '

echo "Waiting for VM to be ready..."
sleep 30

# Wait for startup script to finish
for i in {1..60}; do
  if gcloud compute ssh "$PROJECT" --zone="$ZONE" --command="which node" &>/dev/null; then
    break
  fi
  echo "Waiting for setup to complete... ($i)"
  sleep 10
done

echo "Setting up Brian..."

# Write environment file
gcloud compute ssh "$PROJECT" --zone="$ZONE" --command="
  sudo mkdir -p /etc/brian
  sudo tee /etc/brian/env > /dev/null << 'ENVEOF'
TELEGRAM_BOT_TOKEN=${TELEGRAM_TOKEN}
TELEGRAM_OWNER_ID=${OWNER_ID}
ANTHROPIC_API_KEY=${ANTHROPIC_KEY}
GITHUB_TOKEN=${GITHUB_TOKEN}
BRIAN_MODEL=claude-sonnet-4-20250514
HEARTBEAT_INTERVAL_MINUTES=30
HEARTBEAT_ACTIVE_HOURS_START=08:00
HEARTBEAT_ACTIVE_HOURS_END=22:00
ENVEOF
  sudo chmod 600 /etc/brian/env
"

# Clone repo and build
gcloud compute ssh "$PROJECT" --zone="$ZONE" --command="
  sudo -u brian bash -c '
    git clone https://${GITHUB_TOKEN}@github.com/${REPO}.git /home/brian/app
    cd /home/brian/app
    npm ci
    npm run build
    mkdir -p /home/brian/secrets /home/brian/projects
    cp deploy-self.sh /home/brian/deploy-self.sh
    chmod +x /home/brian/deploy-self.sh
  '
"

# Install systemd service
gcloud compute ssh "$PROJECT" --zone="$ZONE" --command="
  sudo cp /home/brian/app/setup/brian.service /etc/systemd/system/brian.service
  sudo systemctl daemon-reload
  sudo systemctl enable brian
  sudo systemctl start brian
"

echo "Waiting for Brian to come alive..."
sleep 10

gcloud compute ssh "$PROJECT" --zone="$ZONE" --command="systemctl is-active brian"

echo "Brian is running!"
