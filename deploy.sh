#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

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

VM="brian"
ZONE="${GCE_ZONE:-europe-west1-b}"
MACHINE_TYPE="${GCE_MACHINE_TYPE:-e2-small}"
REPO="grovina/brian"

SSH="gcloud compute ssh $VM --zone=$ZONE --command"
SCP="gcloud compute scp --zone=$ZONE"

# Create VM if it doesn't exist
if ! gcloud compute instances describe "$VM" --zone="$ZONE" &>/dev/null; then
  echo "Creating VM..."
  gcloud compute instances create "$VM" \
    --zone="$ZONE" \
    --machine-type="$MACHINE_TYPE" \
    --image-family="debian-12" \
    --image-project="debian-cloud" \
    --scopes="https://www.googleapis.com/auth/cloud-platform" \
    --tags="brian"

  echo "Waiting for SSH..."
  for i in {1..30}; do
    if $SSH "true" &>/dev/null; then break; fi
    sleep 5
  done
fi

echo "Installing system packages..."
$SSH "
  sudo apt-get update &&
  sudo apt-get install -y curl git docker.io docker-compose-plugin build-essential &&
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - &&
  sudo apt-get install -y nodejs
"

echo "Setting up brian user..."
$SSH "
  id brian &>/dev/null || sudo useradd -m -s /bin/bash brian &&
  sudo usermod -aG docker brian &&
  sudo systemctl enable docker &&
  sudo systemctl start docker
"

echo "Deploying environment..."
$SCP "$ENV_FILE" "$VM:/tmp/brian.env"
$SSH "
  sudo mkdir -p /etc/brian &&
  sudo mv /tmp/brian.env /etc/brian/env &&
  sudo chmod 600 /etc/brian/env
"

echo "Cloning and building..."
$SSH "
  sudo -u brian bash -c '
    set -e
    if [ -d /home/brian/app ]; then
      cd /home/brian/app && git pull origin main
    else
      git clone https://${GITHUB_TOKEN}@github.com/${REPO}.git /home/brian/app
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

$SSH "systemctl is-active brian"
echo "Brian is running!"
