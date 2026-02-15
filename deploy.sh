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

PROJECT="grovina-brian"
ZONE="${GCE_ZONE:-europe-west1-b}"
MACHINE_TYPE="${GCE_MACHINE_TYPE:-e2-small}"
REPO="grovina/brian"

# Update existing VM
if gcloud compute instances describe "$PROJECT" --zone="$ZONE" &>/dev/null; then
  echo "VM exists, updating..."

  gcloud compute scp "$ENV_FILE" "$PROJECT:/tmp/brian.env" --zone="$ZONE"
  gcloud compute ssh "$PROJECT" --zone="$ZONE" --command="
    sudo mkdir -p /etc/brian &&
    sudo mv /tmp/brian.env /etc/brian/env &&
    sudo chmod 600 /etc/brian/env &&
    cd /home/brian/app &&
    sudo -u brian git pull origin main &&
    sudo -u brian npm ci &&
    sudo -u brian npm run build &&
    sudo systemctl restart brian
  "

  echo "Updated and restarted."
  exit 0
fi

# Create new VM
echo "Creating VM..."

gcloud compute instances create "$PROJECT" \
  --zone="$ZONE" \
  --machine-type="$MACHINE_TYPE" \
  --image-family="debian-12" \
  --image-project="debian-cloud" \
  --scopes="https://www.googleapis.com/auth/cloud-platform" \
  --tags="brian" \
  --metadata=startup-script='#!/bin/bash
    apt-get update
    apt-get install -y curl git docker.io docker-compose-plugin build-essential
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
    useradd -m -s /bin/bash brian
    usermod -aG docker brian
    systemctl enable docker
    systemctl start docker
  '

echo "Waiting for VM to be ready..."
sleep 30

for i in {1..60}; do
  if gcloud compute ssh "$PROJECT" --zone="$ZONE" --command="which node" &>/dev/null; then
    break
  fi
  echo "Waiting for setup to complete... ($i)"
  sleep 10
done

echo "Setting up Brian..."

# Copy .env to VM
gcloud compute scp "$ENV_FILE" "$PROJECT:/tmp/brian.env" --zone="$ZONE"
gcloud compute ssh "$PROJECT" --zone="$ZONE" --command="
  sudo mkdir -p /etc/brian &&
  sudo mv /tmp/brian.env /etc/brian/env &&
  sudo chmod 600 /etc/brian/env
"

# Clone, build, install
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
