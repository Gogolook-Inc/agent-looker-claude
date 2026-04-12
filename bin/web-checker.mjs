#!/usr/bin/env node
/**
 * web-tracker hook (PreToolUse)
 * Calls agent_looker MCP server to check URL safety.
 * Reads Claude Code hook JSON payload from stdin.
 * Outputs allow/deny JSON to stdout.
 */

import http from "http";
import https from "https";
import fs from "fs";
import { URL } from "url";
import { CLIENT_NAME, CLIENT_VERSION } from "../lib/client-info.mjs";
import { MCP_URL, MCP_TOKEN } from "../lib/config.mjs";

// ── HTTP helper ───────────────────────────────────────────────────────────────

function request(urlStr, options, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(urlStr, options, (res) => {
      const sessionId = res.headers["mcp-session-id"] ?? null;
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => resolve({ status: res.statusCode, sessionId, body: raw }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function parseSSE(raw) {
  for (const line of raw.split("\n")) {
    if (line.startsWith("data:")) {
      return JSON.parse(line.slice(5).trim());
    }
  }
  throw new Error("No data line in SSE response");
}

// ── MCP call ──────────────────────────────────────────────────────────────────

async function checkUrl(url) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "Authorization": `Bearer ${MCP_TOKEN}`,
  };

  const initBody = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
    },
  });

  const init = await request(MCP_URL, { method: "POST", headers }, initBody);
  if (!init.sessionId) throw new Error("No session ID from MCP server");

  const callHeaders = { ...headers, "mcp-session-id": init.sessionId };
  const callBody = JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "check_url_safety", arguments: { url } },
  });

  const result = await request(MCP_URL, { method: "POST", headers: callHeaders }, callBody);
  const data = parseSSE(result.body);

  request(MCP_URL, { method: "DELETE", headers: callHeaders }, null).catch(() => {});

  return data;
}

// ── Result parsing ────────────────────────────────────────────────────────────

function isUnsafe(mcpResult) {
  const content = mcpResult?.result?.content ?? [];
  for (const item of content) {
    try {
      const parsed = JSON.parse(item.text ?? "");
      if ("isSafe" in parsed) {
        if (parsed.isSafe) return { unsafe: false };
        const first = parsed.threats?.[0];
        const reason = (typeof first === "string" ? first : first?.threatType) ?? "UNSAFE";
        return { unsafe: true, reason };
      }
    } catch { /* not JSON, skip */ }
  }
  return { unsafe: false };
}

// ── Hook output ───────────────────────────────────────────────────────────────

const allow = () => console.log(JSON.stringify({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
}));

const block = (reason) => console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: `URL blocked by safety check: ${reason}`,
  },
}));

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  let data;
  try {
    const stdin = fs.readFileSync(process.stdin.fd, "utf8");
    data = JSON.parse(stdin);
  } catch {
    allow(); return;
  }

  const toolName = data.tool_name ?? "";
  const input = data.tool_input ?? {};

  if (toolName !== "WebFetch") { allow(); return; }

  const url = input.url ?? "";
  if (!url) { allow(); return; }

  try {
    const result = await checkUrl(url);
    const { unsafe, reason } = isUnsafe(result);
    if (unsafe) {
      block(reason);
    } else {
      allow();
    }
  } catch (err) {
    process.stderr.write(`[web-tracker] MCP check failed: ${err.message}\n`);
    allow(); // fail open
  }
}

main();
