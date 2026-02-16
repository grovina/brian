# Deployment Guide

Brian can run on cloud VMs or local hardware (mini PC, home server, etc).

## Option 1: Google Cloud VM

Best for: Always-on availability, no home network setup

**Requirements:**
- GCP account with billing
- gcloud CLI installed
- `.env` file configured

**Recommended specs for local LLM:**
- Machine: n2-standard-4 (4 vCPU, 16GB RAM)
- Disk: 50GB
- Cost: ~$140/month (~$42/month with preemptible)

**Deploy:**
```bash
./deploy.sh
```

The script will:
- Create VM if needed
- Install dependencies
- Clone repo and build
- Set up systemd service
- Start Brian

## Option 2: Local/Home Server

Best for: Cost savings, you own the hardware, privacy

**Hardware recommendations:**
- Mini PC (Beelink, Minisforum, NUC, etc)
- 16GB+ RAM (for llama 70b quantized)
- 100GB+ storage (for models + data)
- Always-on, stable network

**Setup target machine:**
1. Install Ubuntu/Debian
2. Enable SSH: `sudo apt install openssh-server`
3. Set up passwordless SSH: `ssh-copy-id brian@hostname`
4. Set up passwordless sudo:
   ```bash
   echo 'brian ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/brian
   ```

**Deploy:**
```bash
./deploy-local.sh brian@hostname
# or
./deploy-local.sh brian@192.168.1.100
```

## After Deployment

### Install Ollama (for local LLM)

**On GCP:**
```bash
gcloud compute ssh brian --zone=europe-west1-b --command="
  docker run -d --name ollama -p 11434:11434 -v ollama:/root/.ollama ollama/ollama &&
  docker exec ollama ollama pull llama3.3:70b-instruct-q4_K_M
"
```

**On local server:**
```bash
ssh brian@hostname "
  docker run -d --name ollama -p 11434:11434 -v ollama:/root/.ollama ollama/ollama &&
  docker exec ollama ollama pull llama3.3:70b-instruct-q4_K_M
"
```

Model download is ~40GB, takes a while.

### Check logs

**GCP:**
```bash
gcloud compute ssh brian --zone=europe-west1-b --command="journalctl -u brian -f"
```

**Local:**
```bash
ssh brian@hostname "journalctl -u brian -f"
```

## Cost Comparison

### Cloud VM (n2-standard-4)
- **Standard:** ~$140/month
- **Preemptible:** ~$42/month (can be terminated)
- **Spot:** ~$30/month (aggressive savings, may terminate)

### Home Mini PC
- **Hardware:** $200-500 one-time
- **Electricity:** ~$5-10/month (24/7, depends on power/location)
- **Break-even:** 2-4 months vs cloud
- **Benefits:** Own it, privacy, can upgrade

## Updating Brian

Brian can self-deploy from Telegram:
```
hey update yourself
```

Or manually:
```bash
# GCP
gcloud compute ssh brian --zone=europe-west1-b --command="/home/brian/deploy-self.sh"

# Local
ssh brian@hostname "/home/brian/deploy-self.sh"
```

## Troubleshooting

### SSH connection fails
- Check firewall rules
- Verify SSH keys are set up
- Try with `-v` flag for verbose output

### Out of disk space
- Clean docker: `docker system prune -a`
- Check disk: `df -h`
- Increase disk size (cloud) or add storage (local)

### Out of memory
- Reduce model size (use smaller quant like q4_K_S)
- Upgrade RAM
- Use cloud VM with more memory

### Brian won't start
- Check logs: `journalctl -u brian -n 100`
- Verify env vars: `sudo cat /etc/brian/env`
- Test manually: `cd /home/brian/app && npm start`
