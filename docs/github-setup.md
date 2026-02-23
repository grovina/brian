# GitHub Setup

Brian needs its own GitHub account to read repos, open PRs, and push code.

## 1. Create a GitHub account

- Go to [github.com/signup](https://github.com/signup)
- Use brian's email (the same one you used for Slack, e.g. `bottini@yourorg.com`)
- Pick a username that matches your brian's name

## 2. Create a classic personal access token

- Go to **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
- Click **Generate new token (classic)**
- Give it a descriptive name (e.g. "brian automation")
- Set expiration as needed
- Select scopes:
  - `repo` — full access to repos (read, write, PRs)
  - `workflow` — update GitHub Actions workflows (if needed)
- Click **Generate token** and copy it (`ghp_...`)
- This is your `GITHUB_TOKEN`

## 3. Add brian to your org

- Invite the brian account to your GitHub org
- Give it appropriate repository access (write access to repos brian should work on)
