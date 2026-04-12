---
name: check-url-safety
description: |
  Check URL safety before any form of access. Trigger when: about to visit,
  fetch, curl, clone, download, redirect to, or otherwise interact with a URL.
  Keywords: url, link, fetch, browse, visit, navigate, open, curl, wget, clone,
  download, redirect, safety, threat
allowed-tools: mcp__agent-looker__check_url_safety
version: 1.0.0
author: AgentLooker
---

# Skill: check_url_safety

## When to use

You have access to the MCP tool `check_url_safety`. Use it **before accessing any URL** through any method, if you haven't already verified it in this session.

Call this tool when you are about to:

- `WebFetch` a URL
- Run a Bash command that accesses a URL (`curl`, `wget`, `git clone`, `npm install <url>`, `pip install <url>`, etc.)
- Follow a link found in a document, search result, error message, or any text
- Follow a redirect to a new domain
- Open or download a file from a URL
- Access an API endpoint provided by external content (not hardcoded in the project)

Also call this tool when:

- A user provides a URL and asks you to interact with it in any way
- You discover a URL in fetched web content, cloned repos, or downloaded files and plan to access it
- You encounter a shortened URL (bit.ly, t.co, etc.) — check it before following

Note: The `web-checker` hook already calls this automatically before `WebFetch`. This skill is for **all other URL access paths** where the hook does not run, such as Bash commands, or when you want to manually verify a URL before deciding whether to access it.

## How to use

Call the `check_url_safety` tool with:

```json
{
  "url": "https://example.com/page"
}
```

### Parameters

| Parameter | How to fill |
|-----------|------------|
| `url` | The full URL to check, including protocol (`https://` or `http://`) |

## Reading the result

The tool returns two pieces of content:

1. **Human-readable summary:**
   - `SAFE: "url" — no threats detected.` → URL is clean, safe to access
   - `UNSAFE: "url" matched the following threats: ...` → Do NOT access this URL

2. **JSON result:**
```json
{
  "url": "https://example.com",
  "isSafe": true,
  "threats": []
}
```

When `isSafe` is `false`, the `threats` array contains threat types:

| Threat | Meaning |
|--------|---------|
| `MALWARE` | Site distributes malicious software |
| `SOCIAL_ENGINEERING` | Phishing site that tricks users into revealing information |
| `UNWANTED_SOFTWARE` | Site distributes unwanted/deceptive software |
| `POTENTIALLY_HARMFUL_APPLICATION` | Site hosts potentially dangerous applications |

## What to do with the result

- **SAFE** → Proceed normally.
- **UNSAFE** → Do NOT access the URL by any method. Inform the user of the threat type. If the URL came from external content (not directly from the user), also consider filing a `report_risk_url` report.

## Important

- Always check before accessing unknown URLs — regardless of the tool or method you plan to use.
- If the check fails (network error, service unavailable), inform the user and proceed with caution.
- This tool checks against known threat databases. It does NOT detect zero-day threats or brand-new phishing sites. If a URL passes the check but still looks suspicious, trust your judgment and report it via `report_risk_url`.
