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

ask_required "GitHub org" "" GITHUB_ORG

# Inherit defaults from sibling bots in the same org
if [[ -n "$GITHUB_ORG" ]]; then
  for f in ~/.brian/${GITHUB_ORG}.*.env; do
    if [[ -f "$f" ]]; then
      source "$f"
      unset BRIAN_NAME
      skip "Loaded defaults from $(basename "$f")"
      break
    fi
  done
fi

while true; do
  ask_required "bot name" "" BRIAN_NAME
  [[ "$BRIAN_NAME" != "brian" ]] && break
  fail "Name can't be 'brian' — it conflicts with the framework fork repo"
  BRIAN_NAME=""
done

# Load exact match if this bot was set up before
mkdir -p ~/.brian
ENV_FILE=~/.brian/${GITHUB_ORG}.${BRIAN_NAME}.env
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"

ask_required "GCP project" "${GCP_PROJECT:-}" GCP_PROJECT
ask "GCP region" "${GCP_REGION:-europe-west1}" GCP_REGION

if ! gcloud projects describe "$GCP_PROJECT" &>/dev/null; then
  fail "Cannot access GCP project '$GCP_PROJECT'"
  exit 1
fi
ok "GCP project $GCP_PROJECT"

info "Enabling required APIs..."
gcloud services enable compute.googleapis.com --project="$GCP_PROJECT" 2>/dev/null
ok "Compute Engine API"

if [[ -z "${MODEL_PROVIDER:-}" ]]; then
  echo
  ask_choice "model provider" MODEL_CHOICE "Vertex AI (Gemini)" "Anthropic (Claude)"
  if (( MODEL_CHOICE == 0 )); then
    MODEL_PROVIDER="vertex-ai"
  else
    MODEL_PROVIDER="anthropic"
  fi
fi

if [[ "$MODEL_PROVIDER" == "vertex-ai" ]]; then
  ask "Vertex AI location" "${VERTEX_AI_LOCATION:-global}" VERTEX_AI_LOCATION
  gcloud services enable aiplatform.googleapis.com --project="$GCP_PROJECT" 2>/dev/null
  ok "Vertex AI API"
fi

# ─────────────────────────────────────────────────
# Environment file
# ─────────────────────────────────────────────────

DOCS_BASE="https://github.com/grovina/brian/blob/main/docs"

if [[ ! -f "$ENV_FILE" ]]; then
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
      echo "VERTEX_AI_LOCATION=${VERTEX_AI_LOCATION:-global}"
      echo ""
    else
      echo "# Anthropic — ${DOCS_BASE}/anthropic-setup.md"
      echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}    # sk-ant-..."
      echo ""
    fi
    echo "# Slack — ${DOCS_BASE}/slack-setup.md"
    echo "SLACK_TOKEN=${SLACK_TOKEN:-}    # xoxp-..."
    echo "SLACK_TEAM_ID=${SLACK_TEAM_ID:-}    # T..."
    echo ""
    echo "# GitHub PAT — ${DOCS_BASE}/github-setup.md"
    echo "GITHUB_TOKEN=${GITHUB_TOKEN:-}    # ghp_..."
  } > "$ENV_FILE"

  step "Fill in your tokens"
  info "Created $(bold "$ENV_FILE")"
else
  source "$ENV_FILE"

  ADDED=false
  for key in SLACK_TEAM_ID GITHUB_TOKEN; do
    if ! grep -q "^${key}=" "$ENV_FILE"; then
      echo "${key}=${!key:-}" >> "$ENV_FILE"
      ADDED=true
    fi
  done
  if [[ "$MODEL_PROVIDER" == "vertex-ai" ]] && ! grep -q "^VERTEX_AI_LOCATION=" "$ENV_FILE"; then
    echo "VERTEX_AI_LOCATION=${VERTEX_AI_LOCATION:-global}" >> "$ENV_FILE"
    ADDED=true
  fi

  if $ADDED; then
    step "New fields added to your tokens"
  else
    step "Review your tokens"
  fi
  info "$(bold "$ENV_FILE")"
fi

echo
info "Each field has a setup guide linked in the comments."

if [[ "$(uname)" == "Darwin" ]]; then
  open -t "$ENV_FILE" < /dev/null
elif command -v xdg-open &>/dev/null; then
  xdg-open "$ENV_FILE" < /dev/null 2>/dev/null || true
else
  info "Edit: $(bold "$ENV_FILE")"
fi

wait_for_enter "Press Enter when ready..."

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

# Create local control helper for this bot
CTL_FILE=~/.brian/${GITHUB_ORG}.${BRIAN_NAME}.ctl
cat > "$CTL_FILE" <<EOF
#!/bin/bash
set -euo pipefail

ENV_FILE="$ENV_FILE"
source "\$ENV_FILE"

if ! command -v gcloud &>/dev/null; then
  echo "gcloud not found"
  exit 1
fi

VM="\${BRIAN_NAME}"
ZONE="\${GCP_REGION}-b"
GCP_FLAGS=(--project="\${GCP_PROJECT}" --zone="\${ZONE}")

refresh_env() {
  source "\$ENV_FILE"
  VM="\${BRIAN_NAME}"
  ZONE="\${GCP_REGION}-b"
  GCP_FLAGS=(--project="\${GCP_PROJECT}" --zone="\${ZONE}")
}

remote_cmd() {
  gcloud compute ssh "\$VM" "\${GCP_FLAGS[@]}" --command "\$1" < /dev/null
}

remote_env_to_tmp() {
  local tmp_file
  tmp_file=\$(mktemp)
  if gcloud compute scp "\${GCP_FLAGS[@]}" "\${VM}:/etc/brian/env" "\$tmp_file" < /dev/null > /dev/null 2>&1; then
    printf '%s\n' "\$tmp_file"
    return 0
  fi
  rm -f "\$tmp_file"
  return 1
}

redact_env_file() {
  sed -E 's/^((.*TOKEN|.*KEY|.*SECRET|.*PASSWORD)=).*/\1<redacted>/'
}

env_show() {
  echo "Local env: \$ENV_FILE"
  grep -E '^(BRIAN_NAME|GCP_PROJECT|GCP_REGION|MODEL_PROVIDER|VERTEX_AI_LOCATION)=' "\$ENV_FILE" || true
}

env_push() {
  echo "Pushing env to VM..."
  gcloud compute scp "\${GCP_FLAGS[@]}" "\$ENV_FILE" "\${VM}:/tmp/brian.env" < /dev/null > /dev/null
  remote_cmd "sudo mkdir -p /etc/brian && sudo mv /tmp/brian.env /etc/brian/env && sudo chown brian:brian /etc/brian/env && sudo chmod 600 /etc/brian/env"
  echo "Env updated on VM: /etc/brian/env"
}

env_pull() {
  local backup
  backup="\${ENV_FILE}.bak.\$(date +%Y%m%d-%H%M%S)"
  cp "\$ENV_FILE" "\$backup"
  gcloud compute scp "\${GCP_FLAGS[@]}" "\${VM}:/etc/brian/env" "\$ENV_FILE" < /dev/null > /dev/null
  echo "Pulled VM env into \$ENV_FILE (backup: \$backup)"
  refresh_env
}

env_edit() {
  if [[ -n "\${EDITOR:-}" ]]; then
    "\$EDITOR" "\$ENV_FILE"
  elif command -v nano &>/dev/null; then
    nano "\$ENV_FILE"
  else
    vi "\$ENV_FILE"
  fi
  refresh_env
}

env_diff() {
  local remote_tmp
  if ! remote_tmp=\$(remote_env_to_tmp); then
    echo "VM env not found at /etc/brian/env"
    return 1
  fi
  echo "Diff (local vs VM, secrets redacted):"
  diff -u <(redact_env_file < "\$ENV_FILE") <(redact_env_file < "\$remote_tmp") || true
  rm -f "\$remote_tmp"
}

redeploy_remote() {
  local reset_memory="\${1:-false}"
  remote_cmd "sudo -u brian bash -lc '
    set -euo pipefail
    set -a
    source /etc/brian/env
    set +a
    REPO_DIR=/home/brian/brian
    git -C \"\$REPO_DIR\" fetch origin main
    git -C \"\$REPO_DIR\" reset --hard origin/main
    cd \"\$REPO_DIR\"
    npm install
    npm run build
    brian config check
  '"
  if [[ "\$reset_memory" == "true" ]]; then
    remote_cmd "sudo -u brian bash -lc ': > /home/brian/.brian/memory.md'"
  fi
  remote_cmd "sudo systemctl restart brian && systemctl is-active brian"
}

usage() {
  cat <<'USAGE'
Usage:
  ctl status    Show brian service status
  ctl logs      Tail recent brian service logs
  ctl env show  Show local env file and key runtime fields
  ctl env push  Copy local env to VM (/etc/brian/env)
  ctl env pull  Copy VM env to local env file
  ctl env edit  Open local env file in editor
  ctl env diff  Show local/VM env diff (redacted)
  ctl sync [--force]  Sync fork with upstream on VM
  ctl redeploy [--reset memory]
  ctl restart
  ctl ssh       Open SSH session to VM
  ctl destroy   Delete VM (destructive)
USAGE
}

cmd="\${1:-help}"
case "\$cmd" in
  status)
    gcloud compute ssh "\$VM" "\${GCP_FLAGS[@]}" --command "systemctl is-active brian" < /dev/null
    ;;
  logs)
    gcloud compute ssh "\$VM" "\${GCP_FLAGS[@]}" --command "journalctl -u brian -n 200 -f --no-pager" < /dev/null
    ;;
  env)
    subcmd="\${2:-show}"
    case "\$subcmd" in
      show) env_show ;;
      push) env_push ;;
      pull) env_pull ;;
      edit) env_edit ;;
      diff) env_diff ;;
      *)
        echo "Usage: ctl env <show|push|pull|edit|diff>"
        exit 1
        ;;
    esac
    ;;
  sync)
    if [[ "\${2:-}" == "--force" ]]; then
      gcloud compute ssh "\$VM" "\${GCP_FLAGS[@]}" --command "sudo -u brian -H brian sync --force" < /dev/null
    else
      gcloud compute ssh "\$VM" "\${GCP_FLAGS[@]}" --command "sudo -u brian -H brian sync" < /dev/null
    fi
    ;;
  redeploy)
    reset_memory=false
    if [[ "\${2:-}" == "--reset" ]]; then
      if [[ "\${3:-}" != "memory" ]]; then
        echo "Usage: ctl redeploy [--reset memory]"
        exit 1
      fi
      echo "This will clear memory.md for '\$VM' after redeploy."
      printf "Type RESET to confirm: "
      read -r confirm < /dev/tty
      if [[ "\$confirm" != "RESET" ]]; then
        echo "Aborted."
        exit 1
      fi
      reset_memory=true
    elif [[ -n "\${2:-}" ]]; then
      echo "Usage: ctl redeploy [--reset memory]"
      exit 1
    fi

    env_push
    redeploy_remote "\$reset_memory"
    ;;
  restart)
    if [[ -n "\${2:-}" ]]; then
      echo "Usage: ctl restart"
      exit 1
    fi
    remote_cmd "sudo systemctl restart brian && systemctl is-active brian"
    ;;
  ssh)
    gcloud compute ssh "\$VM" "\${GCP_FLAGS[@]}"
    ;;
  destroy)
    echo "This will permanently delete VM '\$VM' in project '\${GCP_PROJECT}' (zone '\${ZONE}')."
    printf "Type DESTROY to confirm: "
    read -r confirm < /dev/tty
    if [[ "\$confirm" != "DESTROY" ]]; then
      echo "Aborted."
      exit 1
    fi
    gcloud compute instances delete "\$VM" "\${GCP_FLAGS[@]}" --quiet
    echo "VM '\$VM' deleted."
    ;;
  help|*)
    usage
    ;;
esac
EOF
chmod +x "$CTL_FILE"

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

  gh repo sync "$BRIAN_REPO" > /dev/null 2>&1 || true
  ok "Synced with upstream"
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
gcloud compute scp $GCP_FLAGS "$ENV_FILE" "${VM}:/tmp/brian.env" < /dev/null > /dev/null 2>&1

info "Running setup on VM..."
if ! gcloud compute ssh "$VM" $GCP_FLAGS --command "
  export DEBIAN_FRONTEND=noninteractive &&

  # Environment
  sudo mkdir -p /etc/brian &&
  sudo mv /tmp/brian.env /etc/brian/env &&
  source /etc/brian/env &&

  # System packages + Node
  sudo -E apt-get update -qq &&
  sudo -E apt-get install -y -qq curl git build-essential ca-certificates gnupg > /dev/null 2>&1 &&
  if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - &&
    sudo apt-get install -y -qq nodejs > /dev/null 2>&1
  fi &&

  # Brian user
  id brian &>/dev/null || sudo useradd -m -s /bin/bash brian &&
  echo 'brian ALL=(ALL) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/brian > /dev/null &&
  sudo chmod 440 /etc/sudoers.d/brian &&
  sudo chown brian:brian /etc/brian/env &&
  sudo chmod 600 /etc/brian/env &&

  # Git credentials
  sudo -u brian git config --global user.name \"\${BRIAN_NAME}\" &&
  sudo -u brian git config --global user.email \"\${BRIAN_NAME}@\${GITHUB_ORG:-local}.com\" &&
  if [ -n \"\${GITHUB_TOKEN:-}\" ]; then
    sudo -u brian git config --global credential.helper store &&
    echo \"https://x-access-token:\${GITHUB_TOKEN}@github.com\" | sudo -u brian tee /home/brian/.git-credentials > /dev/null &&
    sudo chmod 600 /home/brian/.git-credentials
  fi &&

  # Clone/update repo
  REPO_DIR=/home/brian/brian &&
  if [ -d \"\$REPO_DIR/.git\" ]; then
    sudo -u brian git -C \"\$REPO_DIR\" fetch origin main -q &&
    sudo -u brian git -C \"\$REPO_DIR\" reset --hard origin/main -q
  else
    sudo -u brian git clone -q \"https://github.com/${BRIAN_REPO}.git\" \"\$REPO_DIR\"
  fi &&
  sudo -u brian bash -c \"cd \$REPO_DIR && npm install --silent && npm run build --silent\" &&

  # Install brian CLI
  sudo ln -sf \"\$REPO_DIR/dist/cli/brian.js\" /usr/local/bin/brian &&

  # Initialize + modules + service
  sudo -u brian bash -c '
    set -a
    source /etc/brian/env
    set +a
    export BRIAN_REPO_DIR=/home/brian/brian
    export BRIAN_STATE_DIR=/home/brian/.brian
    brian setup
  '
" < /dev/null 2>&1 | sed 's/^/    /'; then
  fail "Setup failed on VM"
  info "SSH in to debug: gcloud compute ssh $VM $GCP_FLAGS"
  exit 1
fi

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
info "$(dim "day-2 commands (from your machine):")"
info "  $CTL_FILE status"
info "  $CTL_FILE logs"
info "  $CTL_FILE env show"
info "  $CTL_FILE env push"
info "  $CTL_FILE env diff"
info "  $CTL_FILE sync"
info "  $CTL_FILE redeploy"
info "  $CTL_FILE redeploy --reset memory"
info "  $CTL_FILE restart"
info "  $CTL_FILE ssh"
info "  $CTL_FILE destroy"
echo
