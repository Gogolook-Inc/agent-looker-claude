#!/usr/bin/env node
import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
import http from "http";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { CFG_PATH } from "../lib/config.mjs";

const DEFAULT_MCP_URL = "https://agent-looker.whoscall.com/mcp";
const DEFAULT_DASHBOARD_URL = "https://agent-looker.whoscall.com/dashboard";

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
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

// ── Device flow ─────────────────────────────────────────────────────────────

function deviceFlowRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(url, options, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function deviceFlow() {
  const baseUrl = MCP_URL.replace(/\/mcp$/, "");

  // 1. Request a device code
  const initRes = await deviceFlowRequest(`${baseUrl}/auth/device`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  if (initRes.status !== 200) {
    throw new Error(`Device flow init failed (${initRes.status}): ${initRes.body}`);
  }

  const { device_code, verification_url, expires_in, interval } = JSON.parse(initRes.body);

  console.log("");
  console.log("Open the following URL in your browser to authorize:");
  console.log("");
  console.log(`  ${verification_url}`);
  console.log("");
  console.log(`Waiting for authorization (expires in ${expires_in}s)...`);

  // 2. Poll until approved or expired
  const pollUrl = `${baseUrl}/auth/device/token?code=${encodeURIComponent(device_code)}`;
  const pollIntervalMs = (interval ?? 3) * 1000;
  const deadline = Date.now() + expires_in * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const pollRes = await deviceFlowRequest(pollUrl);
    const data = JSON.parse(pollRes.body);

    if (data.status === "ok") {
      console.log("Authorized.");
      return { token: data.token, email: "" };
    }
    if (data.status === "expired") {
      throw new Error("Authorization expired. Run setup again.");
    }
    // status === "pending" — keep waiting
  }

  throw new Error("Timed out waiting for authorization.");
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
  result = await deviceFlow();

}

// ── 1. Save to ~/.agent-looker.cfg ──────────────────────────────────────────

const newCfg = {
  token: result.token,
  mcpUrl: MCP_URL,
  dashboardUrl: DASHBOARD_URL,
};
saveCfg(newCfg);
console.log(`✓ Config saved to ${CFG_PATH}`);

// ── Helpers: .mcp.json writers ──────────────────────────────────────────────

const BIN_DIR = path.dirname(fileURLToPath(import.meta.url));

function updateMcpJson(mcpPath, mutate) {
  if (!fs.existsSync(mcpPath)) return false;
  try {
    const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    if (!mcp.mcpServers?.["agent-looker"]) return false;
    mutate(mcp.mcpServers["agent-looker"]);
    fs.writeFileSync(mcpPath, JSON.stringify(mcp, null, 2) + "\n");
    return true;
  } catch (e) {
    console.error(`✗ Failed to update ${mcpPath}:`, e.message);
    return false;
  }
}

function updateAllMcpCopies(mutate) {
  // Active user config
  updateMcpJson(path.join(CLAUDE_DIR, ".mcp.json"), mutate);

  // Every cached installed copy: ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/.mcp.json
  // Claude Code reads from the cache, not the marketplace source, so this is what actually takes effect.
  const cacheRoot = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR ?? path.join(CLAUDE_DIR, "plugins", "cache");
  if (fs.existsSync(cacheRoot)) {
    for (const marketplaceDir of fs.readdirSync(cacheRoot)) {
      const pluginDir = path.join(cacheRoot, marketplaceDir, "agent-looker");
      if (!fs.existsSync(pluginDir)) continue;
      for (const versionDir of fs.readdirSync(pluginDir)) {
        updateMcpJson(path.join(pluginDir, versionDir, ".mcp.json"), mutate);
      }
    }
  }
}

// ── 1b. Write auth token to all .mcp.json copies ────────────────────────────

updateAllMcpCopies((entry) => {
  entry.headers = { Authorization: `Bearer ${result.token}` };
});
console.log("✓ MCP auth header written");

// ── 2. Update plugin .mcp.json if --mcp-url was provided ────────────────────

if (cliArgs.mcpUrl) {
  // Also update the marketplace source .mcp.json (source of truth for future installs)
  updateMcpJson(path.join(BIN_DIR, "..", ".mcp.json"), (entry) => { entry.url = MCP_URL; });
  updateAllMcpCopies((entry) => { entry.url = MCP_URL; });
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
