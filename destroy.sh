#!/bin/bash
set -euo pipefail

PROJECT="brian-agent"
ZONE="${1:-europe-west1-b}"

echo "Destroying Brian VM ($PROJECT in $ZONE)..."

gcloud compute instances delete "$PROJECT" --zone="$ZONE" --quiet

echo "Done."
