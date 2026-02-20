# Setup Guide (for humans)

How to get Brian running. This is the one-time setup a human does before deploying a brian. You need two tokens: Slack and GitHub.

## 1. Slack Token (`SLACK_TOKEN`)

Brian uses a Slack **user token** (`xoxp-`), not a bot token. This means Brian appears as a real person in Slack — no "BOT" badge, full user identity.

### Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name it anything (e.g. "Brian Agent") and pick your workspace
4. Go to **OAuth & Permissions**

### Add User Token Scopes

Under **User Token Scopes** (not Bot Token Scopes), add:

| Scope | Why |
|---|---|
| `channels:history` | Read messages in public channels |
| `channels:read` | List and discover public channels |
| `chat:write` | Post messages |
| `reactions:write` | Add emoji reactions |
| `users:read` | Resolve user names |
| `users.profile:read` | Read user profiles |
| `groups:read` | List private channels |
| `groups:history` | Read messages in private channels |
| `im:read` | List direct messages |
| `im:history` | Read direct messages |
| `mpim:read` | List group DMs |
| `mpim:history` | Read group DMs |
| `files:read` | Download shared images |

### Install and get the token

1. Click **Install to Workspace**
2. Authorize as the user you want Brian to be (e.g. `pickle@klauvi.com`)
3. Copy the **User OAuth Token** — starts with `xoxp-`

That's your `SLACK_TOKEN`.

### Identity matters

The token is tied to whoever authorizes the app. If you want Brian to appear as `pickle@klauvi.com`, that account needs to be the one clicking "Allow" during install. If you're a workspace admin with access to that account, just log in as pickle and install.

Brian auto-discovers all channels the token's user is a member of. Invite the user to channels you want Brian to participate in.

## 2. GitHub Token (`GITHUB_TOKEN`)

Brian uses a GitHub **personal access token** (classic or fine-grained) to interact with repos via the GitHub MCP server.

### Option A: Fine-grained token (recommended)

1. Go to [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta)
2. Click **Generate new token**
3. Name it (e.g. "brian-klauvi")
4. Set **Resource owner** to your org (e.g. `klauvi`)
5. Under **Repository access**, choose the repos Brian should work with (or "All repositories")
6. Under **Permissions**, grant:

| Permission | Access | Why |
|---|---|---|
| Contents | Read and write | Read/write code |
| Pull requests | Read and write | Create and review PRs |
| Issues | Read and write | Create and manage issues |
| Metadata | Read-only | Required for all tokens |

7. Click **Generate token** and copy it — starts with `github_pat_`

### Option B: Classic token (simpler)

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **Generate new token (classic)**
3. Select scopes: `repo` (full control)
4. Generate and copy — starts with `ghp_`

Either token type works. Fine-grained gives you tighter control over which repos Brian can access.

## 3. Anthropic API Key (`ANTHROPIC_API_KEY`)

1. Go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
2. Create a new API key
3. Copy it — starts with `sk-ant-`

## Put it together

```bash
# .env
BRIAN_NAME=pickle
SLACK_TOKEN=xoxp-...
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_TOKEN=github_pat_...
GITHUB_ORG=klauvi
```

```bash
npm install && npm run build && npm start
```

Brian will discover its Slack channels, connect to GitHub, and start working.

## Deploying to a VM

See `./please help` for deployment commands:

```bash
./please deploy gcp              # Create and deploy to a GCP VM
./please deploy local user@host  # Deploy to any server via SSH
```
