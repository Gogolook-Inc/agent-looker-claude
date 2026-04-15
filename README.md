# Agent Looker - Claude Code Plugin

A [Claude Code](https://claude.ai/code) plugin that protects AI agents from unsafe URLs, malicious content, and prompt injection attacks via the [Agent Looker](https://agent-looker.whoscall.com/) MCP server.

## What it does

Agent Looker adds two layers of protection to your Claude Code sessions:

**Hooks (automatic)** -- System-level guards that run without Claude's involvement:

- **PreToolUse** -- Before every `WebFetch`, the URL is checked against threat databases. Unsafe URLs are blocked before Claude ever sees the response.
- **PostToolUse** -- After every `WebFetch` and `WebSearch`, the returned content is scanned for prompt injection, jailbreak attempts, PII leaks, and other risks.

**Skills (Claude-driven)** -- Four skills that teach Claude when and how to call Agent Looker's MCP tools:

| Skill | Trigger | Purpose |
|-------|---------|---------|
| `check-url-safety` | Before accessing any URL (curl, wget, git clone, etc.) | Covers URL access paths that hooks don't intercept |
| `check-text-safety` | When processing external text from any source | Covers content sources beyond WebFetch/WebSearch |
| `report-risk-url` | Proactively, when a suspicious URL is discovered | Phishing, malware, scam, suspicious redirects |
| `report-risk-text` | Proactively, when suspicious text is discovered | Prompt injection, jailbreak, data leaks |

Together, hooks enforce protection on the most common paths (`WebFetch`, `WebSearch`), while skills extend coverage to everything else.

## How protection works

```
WebFetch(url)
      |
      v
PreToolUse hook: web-checker
      |
      +-- check_url_safety --> UNSAFE --> blocked (Claude never fetches)
      |                    --> SAFE   --> allowed
      v
   WebFetch executes
      |
      v
PostToolUse hook: text-checker
      |
      +-- check_text_safety --> BLOCK/FLAG --> Claude warned via additionalContext
                            --> ALLOW     --> pass through
```

A safe URL can still serve malicious content. URL checks and content checks are two independent layers.

## Requirements

- [Node.js](https://nodejs.org) >= 18
- [Claude Code](https://claude.ai/code) CLI or VS Code extension
- An Agent Looker account (sign up at the dashboard)

## Installation

### Option A — Let Claude Code install for you

Paste the following prompt directly into your Claude Code agent:

```
Please install the Agent Looker plugin by running these 3 commands in order:

1. Run: claude plugin marketplace add Gogolook-Inc/agent-looker-claude
2. Run: claude plugin install agent-looker
3. Run: node ~/.claude/plugins/marketplaces/agent-looker-marketplace/bin/setup.mjs
   IMPORTANT: run step 3 with run_in_background: true, then immediately use the Monitor tool on the returned PID to stream its output. When a line containing an authentication URL appears, show it to me and remind me to open it in my browser. Keep monitoring until I confirm I have signed in, then check that the process exited successfully.

After all steps complete, remind me to restart Claude Code to activate the plugin.
```

---

### Option B — CLI (manual)

#### 1. Install the plugin

```bash
claude plugin marketplace add Gogolook-Inc/agent-looker-claude
claude plugin install agent-looker
```

To install a pre-release version, specify the branch:

```bash
claude plugin marketplace add Gogolook-Inc/agent-looker-claude@develop
```

#### 2. Authenticate

After installing the plugin, run the setup script to authenticate:

```bash
node ~/.claude/plugins/marketplaces/agent-looker-marketplace/bin/setup.mjs
```

This will:
1. Open your browser to sign in (or let you paste a token manually)
2. Save your credentials to `~/.agent-looker.cfg`
3. Install security rules into `~/.claude/CLAUDE.md`

#### 3. Restart Claude Code

Then **restart Claude Code** to activate.

## Uninstall

```bash
node ~/.claude/plugins/marketplaces/agent-looker-claude/bin/setup.mjs --uninstall
```

This removes `~/.agent-looker.cfg`, the CLAUDE.md security rules, cached skills, and the MCP config entry.

## Project structure

```
.claude-plugin/
  plugin.json          # Plugin metadata
  marketplace.json     # Marketplace listing
.mcp.json              # MCP server connection config
hooks/
  hooks.json           # PreToolUse / PostToolUse hook definitions
bin/
  setup.mjs            # Authentication and setup CLI
  web-checker.mjs      # PreToolUse hook — URL safety check
  text-checker.mjs     # PostToolUse hook — content safety check
  append.md            # CLAUDE.md security rules template
lib/
  config.mjs           # Shared config loader (cfg file, env vars, defaults)
  client-info.mjs      # MCP client name and version
skills/
  check-url-safety/    # Skill: check URLs before access
  check-text-safety/   # Skill: check text content safety
  report-risk-url/     # Skill: report suspicious URLs
  report-risk-text/    # Skill: report suspicious text
```

## License

GPL-3.0 -- see [LICENSE](LICENSE) for details.
