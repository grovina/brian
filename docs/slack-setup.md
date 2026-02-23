# Slack Setup

Brian should be a regular member of your Slack workspace — a coworker with its own account, not a bot.

## 1. Create an email for brian

Set up a dedicated email for your brian, e.g. `bottini@yourorg.com`. This will be its identity across services.

## 2. Invite brian to Slack

Invite that email to your Slack workspace as a regular member. Brian shows up like any other teammate — with a name, profile picture, and presence.

## 3. Create a Slack app

- Go to [api.slack.com/apps](https://api.slack.com/apps)
- Click **Create New App** → **From scratch**
- Name it anything (e.g. "Brian Internal") — this is just the app, not what people see in Slack
- Select your workspace

## 4. Add user token scopes

Under **OAuth & Permissions** → **User Token Scopes** (not Bot Token Scopes), add:

- `channels:history` — read messages in public channels
- `channels:read` — list public channels
- `channels:write` — join channels
- `chat:write` — send messages
- `groups:history` — read messages in private channels
- `groups:read` — list private channels
- `im:history` — read direct messages
- `im:read` — list DM conversations
- `im:write` — open DMs
- `reactions:read` — see emoji reactions
- `reactions:write` — add emoji reactions
- `users:read` — look up user info

## 5. Install and authorize as brian

- Click **Install to Workspace**
- Log in as brian's Slack account (the one tied to `bottini@yourorg.com`)
- Authorize the app
- Copy the **User OAuth Token** (`xoxp-...`)
- This is your `SLACK_TOKEN`

Messages brian sends will appear as coming from brian's account — just like any other team member.
