# Vertex AI Setup

Configure Google Cloud so brian can use Gemini via Vertex AI.

## 1. Create or select a GCP project

- Go to [console.cloud.google.com](https://console.cloud.google.com)
- Create a new project or select an existing one
- Note the **project ID** — this is your `GCP_PROJECT`

## 2. Enable the Vertex AI API

- Go to **APIs & Services** → **Enable APIs and Services**
- Search for **Vertex AI API** and enable it

## 3. Authenticate locally

For local development, authenticate with your own Google account:

```bash
gcloud auth application-default login
```

This creates credentials at `~/.config/gcloud/application_default_credentials.json` that the Vertex AI SDK picks up automatically.

## 4. Authenticate on a VM (production)

For GCP VMs, brian authenticates via the VM's service account. The `./please deploy gcp` script creates the VM with the right scopes automatically. No extra setup needed.

For non-GCP servers, create a service account:

- Go to **IAM & Admin** → **Service Accounts**
- Create a service account with the **Vertex AI User** role
- Generate a JSON key
- Set `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json` in your environment
