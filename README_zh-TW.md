# Agent Looker - Claude Code Plugin

透過 [Agent Looker](https://agent-looker.whoscall.com/) MCP server，保護你的 [Claude Code](https://claude.ai/code) AI agent 免於不安全的 URL、惡意內容和 prompt injection 攻擊。

## 功能介紹

Agent Looker 為你的 Claude Code 對話加上兩層防護：

**Hooks（自動攔截）**——系統層級的防護，不需要 Claude 介入：

- **PreToolUse**——每次 `WebFetch` 前，URL 會先經過威脅資料庫比對。不安全的 URL 會直接被攔截，Claude 根本不會拿到回應內容。
- **PostToolUse**——每次 `WebFetch` 和 `WebSearch` 完成後，回傳的內容會被掃描是否包含 prompt injection、jailbreak 嘗試、PII 洩漏等風險。

**Skills（Claude 主動驅動）**——四個 skill 教 Claude 何時以及如何呼叫 Agent Looker 的 MCP tools：

| Skill | 觸發時機 | 用途 |
|-------|---------|------|
| `check-url-safety` | 用任何方式存取 URL 前（curl、wget、git clone 等） | 涵蓋 hooks 攔截不到的 URL 存取路徑 |
| `check-text-safety` | 處理來自任何來源的外部文字時 | 涵蓋 WebFetch/WebSearch 以外的內容來源 |
| `report-risk-url` | 主動發現可疑 URL 時 | 釣魚、惡意軟體、詐騙、可疑重新導向 |
| `report-risk-text` | 主動發現可疑文字時 | Prompt injection、jailbreak、資料洩漏 |

Hooks 在最常見的路徑（`WebFetch`、`WebSearch`）上強制執行防護，skills 則將覆蓋範圍延伸到其他所有情況。

## 防護流程

```
WebFetch(url)
      |
      v
PreToolUse hook: web-checker
      |
      +-- check_url_safety --> 不安全 --> 攔截（Claude 不會取得內容）
      |                    --> 安全   --> 放行
      v
   WebFetch 執行
      |
      v
PostToolUse hook: text-checker
      |
      +-- check_text_safety --> BLOCK/FLAG --> 透過 additionalContext 警告 Claude
                            --> ALLOW     --> 正常通過
```

安全的 URL 仍然可能提供惡意內容。URL 檢查和內容檢查是兩層獨立的防護。

## 系統需求

- [Node.js](https://nodejs.org) >= 18
- [Claude Code](https://claude.ai/code) CLI 或 VS Code 擴充套件
- Agent Looker 帳號（在 dashboard 註冊）

## 安裝

### 方式 A — 讓 Claude Code 幫你安裝

將以下 prompt 直接貼入你的 Claude Code agent：

```
Please install the Agent Looker plugin by running these 3 commands in order:

1. Run: claude plugin marketplace add Gogolook-Inc/agent-looker-claude
2. Run: claude plugin install agent-looker
3. Run: node ~/.claude/plugins/marketplaces/agent-looker-marketplace/bin/setup.mjs
   IMPORTANT: run step 3 with run_in_background: true, then immediately use the Monitor tool on the returned PID to stream its output. When a line containing an authentication URL appears, show it to me and remind me to open it in my browser. Keep monitoring until I confirm I have signed in, then check that the process exited successfully.

After all steps complete, remind me to restart Claude Code to activate the plugin.
```

---

### 方式 B — CLI（手動）

#### 1. 安裝 Plugin

```bash
claude plugin marketplace add Gogolook-Inc/agent-looker-claude
claude plugin install agent-looker
```

如需安裝非穩定版本，可以指定分支：

```bash
claude plugin marketplace add Gogolook-Inc/agent-looker-claude@develop
```

#### 2. 認證

安裝 plugin 後，執行 setup script 進行認證：

```bash
node ~/.claude/plugins/marketplaces/agent-looker-marketplace/bin/setup.mjs
```

這會：
1. 開啟瀏覽器登入（或讓你手動貼上 token）
2. 將認證資訊存到 `~/.agent-looker.cfg`
3. 將安全規則寫入 `~/.claude/CLAUDE.md`

#### 3. 重新啟動 Claude Code

完成後**重新啟動 Claude Code** 即可生效。

## 解除安裝

```bash
node ~/.claude/plugins/marketplaces/agent-looker-marketplace/bin/setup.mjs --uninstall
```

這會移除 `~/.agent-looker.cfg`、CLAUDE.md 中的安全規則、已快取的 skills 和 MCP config 設定。

## 專案結構

```
.claude-plugin/
  plugin.json          # Plugin 後設資料
  marketplace.json     # Marketplace 列表
.mcp.json              # MCP server 連線設定
hooks/
  hooks.json           # PreToolUse / PostToolUse hook 定義
bin/
  setup.mjs            # 認證與設定 CLI
  web-checker.mjs      # PreToolUse hook — URL 安全檢查
  text-checker.mjs     # PostToolUse hook — 內容安全檢查
  append.md            # CLAUDE.md 安全規則範本
lib/
  config.mjs           # 共用設定載入器（cfg 檔、環境變數、預設值）
  client-info.mjs      # MCP client 名稱與版本
skills/
  check-url-safety/    # Skill：存取前檢查 URL 安全性
  check-text-safety/   # Skill：檢查文字內容安全性
  report-risk-url/     # Skill：回報可疑 URL
  report-risk-text/    # Skill：回報可疑文字
```

## 授權條款

GPL-3.0——詳見 [LICENSE](LICENSE)。
