import os from "os";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginPath = path.join(__dirname, "..", ".claude-plugin", "plugin.json");
const plugin = JSON.parse(fs.readFileSync(pluginPath, "utf8"));

const username = os.userInfo().username;
const hostname = os.hostname();

export const CLIENT_NAME = `${plugin.name}-${username}@${hostname}`;
export const CLIENT_VERSION = plugin.version;
