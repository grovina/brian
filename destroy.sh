#!/bin/bash
set -euo pipefail

VM="brian"
ZONE="${1:-europe-west1-b}"

echo "Destroying VM ($VM in $ZONE)..."
gcloud compute instances delete "$VM" --zone="$ZONE" --quiet
echo "Done."
