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
# Upgraded to n2-standard-4 for local LLM support:
# - 4 vCPUs (needed for llama 70b inference)
# - 16 GB RAM (minimum for 70b quantized models)
# - 50 GB disk (for models + data)
# Cost: ~$140/month (can use preemptible for ~$42/month if acceptable)
MACHINE_TYPE="${GCE_MACHINE_TYPE:-n2-standard-4}"
BOOT_DISK_SIZE="${GCE_BOOT_DISK_SIZE:-50GB}"
REPO="grovina/brian"

SSH="gcloud compute ssh $VM --zone=$ZONE --command"
SCP="gcloud compute scp --zone=$ZONE"

# Create VM if it doesn't exist
if ! gcloud compute instances describe "$VM" --zone="$ZONE" &>/dev/null; then
  echo "Creating VM..."
  echo "Machine type: $MACHINE_TYPE (4 vCPU, 16GB RAM)"
  echo "Disk size: $BOOT_DISK_SIZE"
  echo "Estimated cost: ~$140/month (standard) or ~$42/month (preemptible)"
  
  gcloud compute instances create "$VM" \
    --zone="$ZONE" \
    --machine-type="$MACHINE_TYPE" \
    --boot-disk-size="$BOOT_DISK_SIZE" \
    --image-family="debian-12" \
    --image-project="debian-cloud" \
    --scopes="https://www.googleapis.com/auth/cloud-platform" \
    --tags="brian"
    # Add --preemptible flag for 70% cost savings (VM may be terminated)

  echo "Waiting for SSH..."
  for i in {1..30}; do
    if $SSH "true" &>/dev/null; then break; fi
    sleep 5
  done
fi

echo "Installing system packages..."
$SSH "
  sudo apt-get update &&
  sudo apt-get install -y curl git build-essential ca-certificates gnupg &&
  sudo install -m 0755 -d /etc/apt/keyrings &&
  curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg &&
  echo 'deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable' | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null &&
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
$SCP "$ENV_FILE" "$VM:/tmp/brian.env"
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

$SSH "systemctl is-active brian"
echo "Brian is running!"
echo ""
echo "Next steps:"
echo "1. Install Ollama in Docker: docker run -d --name ollama -p 11434:11434 -v ollama:/root/.ollama ollama/ollama"
echo "2. Pull model: docker exec ollama ollama pull llama3.3:70b-instruct-q4_K_M"
echo "3. Model will be ~40GB, fits in 16GB RAM when quantized"
