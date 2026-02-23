#!/bin/bash
set -euo pipefail

bold() { printf "\033[1m%s\033[0m" "$1"; }
dim() { printf "\033[2m%s\033[0m" "$1"; }
green() { printf "\033[32m%s\033[0m" "$1"; }
red() { printf "\033[31m%s\033[0m" "$1"; }

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

ask_required() {
  local prompt="$1" default="${2:-}" var_name="$3"
  while true; do
    ask "$prompt" "$default" "$var_name"
    eval "local val=\$$var_name"
    [[ -n "$val" ]] && return
    fail "Required"
  done
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
# Prerequisites
# ─────────────────────────────────────────────────

echo
echo "  ┌─────────────────────────┐"
echo "  │   create a new brian    │"
echo "  └─────────────────────────┘"

step "Checking prerequisites"

HAS_GH=false

if ! command -v gcloud &>/dev/null; then
  fail "gcloud not found — install from https://cloud.google.com/sdk/docs/install"
  exit 1
fi
if ! gcloud auth print-access-token &>/dev/null; then
  fail "gcloud not authenticated — run $(bold "gcloud auth login")"
  exit 1
fi
ok "gcloud"

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
# Configuration
# ─────────────────────────────────────────────────

step "Configuration"

ask "GitHub org (repos will be created here)" "" GITHUB_ORG

while true; do
  ask_required "bot name (also the repo and VM name)" "" BRIAN_NAME
  if [[ "$BRIAN_NAME" == "brian" ]]; then
    fail "Name can't be 'brian' — it conflicts with the framework fork repo"
    info "Pick a name that's unique to your org (e.g. brianna, jarvis, friday)"
    BRIAN_NAME=""
  else
    break
  fi
done

ask_required "GCP project" "" GCP_PROJECT
ask "GCP region" "europe-west1" GCP_REGION

if ! gcloud projects describe "$GCP_PROJECT" &>/dev/null; then
  fail "Cannot access GCP project '$GCP_PROJECT'"
  info "Check the project ID and your permissions, then re-run."
  exit 1
fi
ok "GCP project $GCP_PROJECT"

info "Enabling required APIs..."
gcloud services enable compute.googleapis.com --project="$GCP_PROJECT" 2>/dev/null
ok "Compute Engine API"

echo
ask_choice "model provider" MODEL_CHOICE "Vertex AI (Gemini)" "Anthropic (Claude)"

if (( MODEL_CHOICE == 0 )); then
  MODEL_PROVIDER="vertex-ai"
  gcloud services enable aiplatform.googleapis.com --project="$GCP_PROJECT" 2>/dev/null
  ok "Vertex AI API"
else
  MODEL_PROVIDER="anthropic"
fi

# ─────────────────────────────────────────────────
# Generate .env, pause for secrets
# ─────────────────────────────────────────────────

mkdir -p ~/.brian
ENV_FILE=~/.brian/${BRIAN_NAME}.env

if [[ -f "$ENV_FILE" ]]; then
  skip "Using existing $(bold "$ENV_FILE")"
else
  DOCS_BASE="https://github.com/grovina/brian/blob/main/docs"

  {
    echo "BRIAN_NAME=${BRIAN_NAME}"
    echo "GITHUB_ORG=${GITHUB_ORG}"
    echo "MODEL_PROVIDER=${MODEL_PROVIDER}"
    echo ""
    echo "# GCP"
    echo "GCP_PROJECT=${GCP_PROJECT}"
    echo "GCP_REGION=${GCP_REGION}"
    echo ""
    if [[ "$MODEL_PROVIDER" == "vertex-ai" ]]; then
      echo "# Vertex AI — ${DOCS_BASE}/vertex-ai-setup.md"
    else
      echo "# Anthropic — ${DOCS_BASE}/anthropic-setup.md"
      echo "ANTHROPIC_API_KEY=    # sk-ant-..."
      echo ""
    fi
    echo "# Slack user token — ${DOCS_BASE}/slack-setup.md"
    echo "SLACK_TOKEN=    # xoxp-..."
    echo ""
    echo "# GitHub PAT for brian — ${DOCS_BASE}/github-setup.md"
    echo "GITHUB_TOKEN=    # ghp_..."
  } > "$ENV_FILE"

  step "Fill in your tokens"
  echo
  info "Created $(bold "$ENV_FILE") — fill in the empty values."
  info "Each field has a setup guide linked in the comments."

  if [[ "$(uname)" == "Darwin" ]]; then
    open -t "$ENV_FILE" < /dev/null
  elif command -v xdg-open &>/dev/null; then
    xdg-open "$ENV_FILE" < /dev/null 2>/dev/null || true
  else
    info "Edit: $(bold "$ENV_FILE")"
  fi

  wait_for_enter "Press Enter when ready..."
fi

source "$ENV_FILE"

MISSING=()
[[ -z "${SLACK_TOKEN:-}" ]] && MISSING+=("SLACK_TOKEN")
if [[ "$MODEL_PROVIDER" == "anthropic" ]]; then
  [[ -z "${ANTHROPIC_API_KEY:-}" ]] && MISSING+=("ANTHROPIC_API_KEY")
fi

if (( ${#MISSING[@]} > 0 )); then
  fail "Still missing: ${MISSING[*]}"
  exit 1
fi

# ─────────────────────────────────────────────────
# Fork framework
# ─────────────────────────────────────────────────

BRIAN_REPO="grovina/brian"

if [[ -n "$GITHUB_ORG" ]] && $HAS_GH; then
  step "Forking framework"
  BRIAN_REPO="${GITHUB_ORG}/brian"

  if gh repo view "$BRIAN_REPO" &>/dev/null; then
    FORK_PARENT=$(gh repo view "$BRIAN_REPO" --json parent --jq '.parent.owner.login + "/" + .parent.name' 2>/dev/null)
    if [[ "$FORK_PARENT" == "grovina/brian" ]]; then
      skip "Fork ${BRIAN_REPO} already exists"
    else
      fail "${BRIAN_REPO} already exists but is not a fork of grovina/brian"
      exit 1
    fi
  else
    gh repo fork grovina/brian --org "$GITHUB_ORG" --clone=false 2>/dev/null
    ok "Forked → ${BRIAN_REPO}"
  fi
fi

# ─────────────────────────────────────────────────
# Deploy to GCP
# ─────────────────────────────────────────────────

step "Deploying to GCP"

VM="${BRIAN_NAME}"
ZONE="${GCP_REGION}-b"
MACHINE_TYPE="${GCE_MACHINE_TYPE:-e2-small}"
BOOT_DISK_SIZE="${GCE_BOOT_DISK_SIZE:-20GB}"
GCP_FLAGS="--project=$GCP_PROJECT --zone=$ZONE"

if ! gcloud compute instances describe "$VM" $GCP_FLAGS &>/dev/null; then
  info "Creating VM $(bold "$VM") ($MACHINE_TYPE, $BOOT_DISK_SIZE)..."
  gcloud compute instances create "$VM" \
    $GCP_FLAGS \
    --machine-type="$MACHINE_TYPE" \
    --boot-disk-size="$BOOT_DISK_SIZE" \
    --image-family="debian-12" \
    --image-project="debian-cloud" \
    --scopes="https://www.googleapis.com/auth/cloud-platform" \
    --tags="brian"
  ok "VM created"
else
  ok "VM $VM already exists"
fi

info "Waiting for SSH access..."
SSH_READY=false
for i in {1..30}; do
  if gcloud compute ssh "$VM" $GCP_FLAGS --command "true" < /dev/null 2>/dev/null; then
    SSH_READY=true
    break
  fi
  sleep 5
done

if ! $SSH_READY; then
  fail "Could not connect to VM via SSH"
  info "Try manually: gcloud compute ssh $VM $GCP_FLAGS"
  exit 1
fi
ok "SSH connected"

info "Copying environment to VM..."
gcloud compute scp $GCP_FLAGS "$ENV_FILE" "${VM}:/tmp/brian.env" < /dev/null

info "Running setup on VM..."
gcloud compute ssh "$VM" $GCP_FLAGS --command "
  sudo mkdir -p /etc/brian &&
  sudo mv /tmp/brian.env /etc/brian/env &&
  sudo chmod 600 /etc/brian/env &&
  git clone https://github.com/${BRIAN_REPO}.git /tmp/brian 2>/dev/null ||
    git -C /tmp/brian pull &&
  /tmp/brian/please setup
" < /dev/null

if gcloud compute ssh "$VM" $GCP_FLAGS --command "systemctl is-active brian" < /dev/null &>/dev/null; then
  ok "${BRIAN_NAME} is running"
else
  fail "${BRIAN_NAME} failed to start"
  info "Check logs: gcloud compute ssh $VM $GCP_FLAGS --command 'journalctl -u brian -n 50'"
  exit 1
fi

# ─────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────

step "Done!"
echo
info "$(bold "$BRIAN_NAME") is running on GCP."
echo
info "$(dim "manage (from the VM):")"
info "  gcloud compute ssh $VM $GCP_FLAGS"
echo
