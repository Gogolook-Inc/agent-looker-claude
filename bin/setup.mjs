#!/usr/bin/env node
import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
import http from "http";
import tty from "tty";
import { createInterface } from "readline";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { CFG_PATH } from "../lib/config.mjs";

const DEFAULT_MCP_URL = "https://agent-looker.whoscall.com/mcp";
const DEFAULT_DASHBOARD_URL = "https://agent-looker.whoscall.com/dashboard";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const CLAUDE_MD_PATH = path.join(CLAUDE_DIR, "CLAUDE.md");

// ── Parse CLI flags ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { mcpUrl: null, dashboardUrl: null, uninstall: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--uninstall") {
      args.uninstall = true;
    } else if (argv[i] === "--mcp-url" && argv[i + 1]) {
      args.mcpUrl = argv[++i];
    } else if (argv[i] === "--dashboard-url" && argv[i + 1]) {
      args.dashboardUrl = argv[++i];
    }
  }
  return args;
}

const cliArgs = parseArgs(process.argv);

// ── Load / save cfg ─────────────────────────────────────────────────────────

function loadCfg() {
  try {
    return JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveCfg(cfg) {
  fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

// ── Resolve MCP / Dashboard URLs ────────────────────────────────────────────

const existingCfg = loadCfg();

const MCP_URL = cliArgs.mcpUrl
  ?? existingCfg.mcpUrl
  ?? DEFAULT_MCP_URL;

const DASHBOARD_URL = cliArgs.dashboardUrl
  ?? existingCfg.dashboardUrl
  ?? DEFAULT_DASHBOARD_URL;

// ── Uninstall ───────────────────────────────────────────────────────────────

if (cliArgs.uninstall) {
  // 1. Remove ~/.agent-looker.cfg
  if (fs.existsSync(CFG_PATH)) {
    fs.unlinkSync(CFG_PATH);
  }

  // 2. Remove agent-looker from ~/.claude/.mcp.json
  const mcpPath = path.join(CLAUDE_DIR, ".mcp.json");
  if (fs.existsSync(mcpPath)) {
    try {
      const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
      if (mcp.mcpServers?.["agent-looker"]) {
        delete mcp.mcpServers["agent-looker"];
        if (Object.keys(mcp.mcpServers).length === 0) {
          fs.unlinkSync(mcpPath);
        } else {
          fs.writeFileSync(mcpPath, JSON.stringify(mcp, null, 2));
        }
      }
    } catch {}
  }

  // 3. Remove security rules from ~/.claude/CLAUDE.md
  const BEGIN_FLAG = "<!-- BEGIN:agent-looker-security -->";
  const END_FLAG = "<!-- END:agent-looker-security -->";

  if (fs.existsSync(CLAUDE_MD_PATH)) {
    const content = fs.readFileSync(CLAUDE_MD_PATH, "utf8");
    if (content.includes(BEGIN_FLAG)) {
      const re = new RegExp(`\\n?${BEGIN_FLAG}[\\s\\S]*?${END_FLAG}\\n?`, "m");
      const cleaned = content.replace(re, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (cleaned.length === 0) {
        fs.unlinkSync(CLAUDE_MD_PATH);
      } else {
        fs.writeFileSync(CLAUDE_MD_PATH, cleaned + "\n");
      }
    }
  }

  // 4. Remove agent-looker skills
  const skillsDir = path.join(CLAUDE_DIR, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir)) {
      if (entry.startsWith("agent-looker-")) {
        fs.rmSync(path.join(skillsDir, entry), { recursive: true, force: true });
      }
    }
  }

  // 5. Try uninstalling Claude Code plugin
  try {
    execSync("claude plugin uninstall agent-looker 2>/dev/null", {
      stdio: "pipe",
      timeout: 15000,
    });
  } catch {}

  console.log("✓ agent-looker fully uninstalled");
  console.log("Restart Claude Code to apply.");
  process.exit(0);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function verifyToken(token) {
  return new Promise((resolve) => {
    const parsed = new URL(MCP_URL);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(MCP_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }, (res) => resolve(res.statusCode !== 401));
    req.on("error", () => resolve(false));
    req.end();
  });
}

function promptHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    try {
      const fd = fs.openSync("/dev/tty", "r+");
      const stream = new tty.ReadStream(fd);
      stream.setRawMode(true);
      stream.resume();
      let buf = "";
      stream.on("data", (chunk) => {
        const char = chunk.toString();
        if (char === "\n" || char === "\r") {
          stream.setRawMode(false);
          stream.destroy();
          process.stdout.write("\n");
          resolve(buf);
        } else if (char === "\u0003") {
          process.exit();
        } else {
          buf += char;
        }
      });
    } catch {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question("", (ans) => { rl.close(); resolve(ans.trim()); });
    }
  });
}

function promptChoice(question, options) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log(question);
    options.forEach((o, i) => console.log(`  ${i + 1}) ${o.label}`));
    rl.question("Choose [1]: ", (ans) => {
      rl.close();
      const raw = parseInt(ans || "1", 10);
      const idx = isNaN(raw) ? 0 : Math.max(0, Math.min(raw - 1, options.length - 1));
      resolve(options[idx].value);
    });
  });
}

function canOpenBrowser() {
  if (process.env.SSH_CLIENT || process.env.SSH_TTY) return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

function openBrowser(url) {
  try {
    const cmd = process.platform === "darwin" ? "open"
      : process.platform === "win32" ? "start"
      : "xdg-open";
    execSync(`${cmd} "${url}"`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ── Browser auth flow ───────────────────────────────────────────────────────

const RESERVED_PORTS = new Set([
  3000, 3001, 3333, 4000, 4200, 4321, 5000, 5173, 5174, 5500,
  8000, 8080, 8081, 8443, 8888, 9000, 9090,
]);

function findPort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => {
        if (RESERVED_PORTS.has(port)) {
          findPort().then(resolve).catch(reject);
        } else {
          resolve(port);
        }
      });
    });
    server.on("error", reject);
  });
}

function browserAuth(timeoutMs = 120_000) {
  return new Promise(async (resolve, reject) => {
    const port = await findPort();
    let settled = false;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }

      const token = url.searchParams.get("token");
      const email = url.searchParams.get("email") ?? "";

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent-Looker — Authenticated</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,.1), 0 1px 2px rgba(0,0,0,.06);
      padding: 48px 40px;
      text-align: center;
      max-width: 420px;
      width: 100%;
    }
    .icon {
      width: 56px; height: 56px;
      background: #ecfdf5;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      font-size: 28px;
    }
    h1 { font-size: 20px; font-weight: 600; color: #111827; margin-bottom: 8px; }
    .email { font-size: 14px; color: #6b7280; margin-bottom: 16px; }
    .hint {
      font-size: 13px;
      color: #9ca3af;
      border-top: 1px solid #f3f4f6;
      padding-top: 16px;
      margin-top: 8px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#x2714;</div>
    <h1>Authenticated</h1>
    ${email ? '<p class="email">' + email.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</p>' : ''}
    <p class="hint">You can close this tab and return to the terminal.</p>
  </div>
  <script>setTimeout(()=>window.close(),3000)</script>
</body>
</html>`);

      settled = true;
      server.close();
      clearTimeout(timer);
      resolve({ token, email });
    });

    server.listen(port, "127.0.0.1", () => {
      const authUrl = `${DASHBOARD_URL.replace(/\/dashboard$/, "")}/auth/cli?port=${port}`;
      console.log(`\nOpening browser to authenticate...`);
      console.log(`If the browser didn't open, visit: ${authUrl}\n`);
      openBrowser(authUrl);
      console.log("Waiting for authentication...");
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
        reject(new Error("Timed out waiting for browser authentication"));
      }
    }, timeoutMs);

    server.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

// ── Manual token flow ───────────────────────────────────────────────────────

async function manualTokenFlow() {
  const tokenUrl = `${DASHBOARD_URL}/tokens`;
  console.log("");
  console.log(`Create a token at: ${tokenUrl}`);
  console.log("");

  while (true) {
    const token = await promptHidden("Paste your token here (input hidden): ");
    process.stdout.write("Verifying... ");
    const ok = await verifyToken(token);
    if (ok) {
      console.log("OK");
      return { token, email: "" };
    } else {
      console.log(`Token rejected by ${MCP_URL} (401). Try again.`);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

let result;
let skipAuth = false;

if (existingCfg.token) {
  process.stdout.write("Verifying existing token... ");
  const ok = await verifyToken(existingCfg.token);
  if (ok) {
    console.log("Token valid.");
    result = { token: existingCfg.token, email: "" };
    skipAuth = true;
  } else {
    console.log("Invalid (401). Please re-authenticate.");
  }
}

if (!skipAuth) {
  if (canOpenBrowser()) {
    const method = await promptChoice("\nHow to authenticate:", [
      { label: "Open browser (recommended)", value: "browser" },
      { label: "Paste token manually", value: "manual" },
    ]);

    if (method === "browser") {
      try {
        result = await browserAuth();
      } catch (err) {
        console.log(`\n${err.message}`);
        console.log("Falling back to manual token...\n");
        result = await manualTokenFlow();
      }
    } else {
      result = await manualTokenFlow();
    }
  } else {
    result = await manualTokenFlow();
  }

  if (!result.token) {
    console.log("No token received.");
    process.exit(1);
  }

  if (result.email) {
    process.stdout.write("Verifying token... ");
    const ok = await verifyToken(result.token);
    if (!ok) {
      console.log("Token verification failed.");
      process.exit(1);
    }
    console.log("OK");
  }
}

// ── 1. Save to ~/.agent-looker.cfg ──────────────────────────────────────────

const newCfg = {
  token: result.token,
  mcpUrl: MCP_URL,
  dashboardUrl: DASHBOARD_URL,
};
saveCfg(newCfg);
console.log(`✓ Config saved to ${CFG_PATH}`);

// ── 2. Update plugin .mcp.json if --mcp-url was provided ────────────────────

const BIN_DIR = path.dirname(fileURLToPath(import.meta.url));

function updateMcpJson(mcpPath, newUrl) {
  if (!fs.existsSync(mcpPath)) return false;
  try {
    const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    if (!mcp.mcpServers?.["agent-looker"]) return false;
    mcp.mcpServers["agent-looker"].url = newUrl;
    fs.writeFileSync(mcpPath, JSON.stringify(mcp, null, 2) + "\n");
    console.log(`✓ Updated .mcp.json at ${mcpPath} → ${newUrl}`);
    return true;
  } catch (e) {
    console.error(`✗ Failed to update ${mcpPath}:`, e.message);
    return false;
  }
}

if (cliArgs.mcpUrl) {
  // 2a. Update the marketplace source .mcp.json (source of truth for future installs)
  updateMcpJson(path.join(BIN_DIR, "..", ".mcp.json"), MCP_URL);

  // 2b. Update every cached installed copy: ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/.mcp.json
  // Claude Code reads from the cache, not the marketplace source, so this is what actually takes effect.
  const cacheRoot = path.join(CLAUDE_DIR, "plugins", "cache");
  if (fs.existsSync(cacheRoot)) {
    for (const marketplaceDir of fs.readdirSync(cacheRoot)) {
      const pluginDir = path.join(cacheRoot, marketplaceDir, "agent-looker");
      if (!fs.existsSync(pluginDir)) continue;
      for (const versionDir of fs.readdirSync(pluginDir)) {
        updateMcpJson(path.join(pluginDir, versionDir, ".mcp.json"), MCP_URL);
      }
    }
  }
}

// ── 3. CLAUDE.md security rules ─────────────────────────────────────────────
const appendSource = path.join(BIN_DIR, "append.md");
const BEGIN_FLAG = "<!-- BEGIN:agent-looker-security -->";
const END_FLAG = "<!-- END:agent-looker-security -->";

if (fs.existsSync(appendSource)) {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  const appendContent = fs.readFileSync(appendSource, "utf8");
  let existingMd = "";
  if (fs.existsSync(CLAUDE_MD_PATH)) {
    existingMd = fs.readFileSync(CLAUDE_MD_PATH, "utf8");
  }

  if (!existingMd.includes(BEGIN_FLAG)) {
    const separator = existingMd.length > 0 && !existingMd.endsWith("\n") ? "\n" : "";
    fs.writeFileSync(CLAUDE_MD_PATH, existingMd + separator + appendContent);
  } else {
    const re = new RegExp(`${BEGIN_FLAG}[\\s\\S]*?${END_FLAG}`, "m");
    fs.writeFileSync(CLAUDE_MD_PATH, existingMd.replace(re, appendContent.trim()));
  }
  console.log("✓ CLAUDE.md rules installed");
}

// ── Done ────────────────────────────────────────────────────────────────────

if (result.email) {
  console.log(`✓ Logged in as ${result.email}`);
}

if (MCP_URL !== DEFAULT_MCP_URL) {
  console.log(`✓ MCP endpoint: ${MCP_URL}`);
}

console.log("");
console.log("Restart Claude Code to activate.");
process.exit(0);
