#!/bin/bash
set -e

cd /home/brian/app
PREVIOUS=$(git rev-parse HEAD)

git pull origin main
npm ci
npm run build

sudo systemctl restart brian

sleep 20

if ! systemctl is-active --quiet brian; then
  echo "New version failed to start, rolling back to $PREVIOUS"
  git checkout "$PREVIOUS"
  npm ci
  npm run build
  sudo systemctl restart brian
fi
