import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "..", "config.json");
const CFG_PATH = path.join(os.homedir(), ".agent-looker.cfg");

const DEFAULT_MCP_URL = "https://agent-looker.whoscall.com/mcp";
const DEFAULT_DASHBOARD_URL = "https://agent-looker.whoscall.com/dashboard";

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function loadCfg() {
  try {
    return JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));
  } catch {
    return {};
  }
}

const config = loadConfig();
const cfg = loadCfg();

// Priority: env var > ~/.agent-looker.cfg > config.json > hardcoded default
export const MCP_URL = process.env.MCP_SERVER_URL ?? cfg.mcpUrl ?? config.mcpServerUrl ?? DEFAULT_MCP_URL;
export const DASHBOARD_URL = process.env.DASHBOARD_URL ?? cfg.dashboardUrl ?? config.dashboardUrl ?? DEFAULT_DASHBOARD_URL;
export const MCP_TOKEN = process.env.AGENT_LOOKER_API_TOKEN ?? cfg.token ?? "";

export { CFG_PATH };
