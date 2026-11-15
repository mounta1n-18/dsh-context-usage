# dsh-context-usage — 软安装包

一个 DeepSeek Harness **Web 插件包**：`/context` 斜杠命令、作曲器控件行的占用按钮与账户余额药丸、以及嵌在作曲器卡片里的上下文用量面板（含轮数/步数/输出速度）。

**零依赖、无构建**：Host 半（`index.js`）只注册一个 session 投影，界面全在 `client.js`（手写纯 JavaScript，只 `require('react')`，样式只用宿主主题 token）。整包自包含，不含 `src/`、不需要 `pnpm install`、不需要 `pnpm run build`。

---

## 1. 安装（两种模式，二选一）

安装动作**只能**通过 DSH 的 `plugin_manager` 工具完成——这是官方唯一支持的路径（官方技能明确禁止手改 profile 的 `package.json` / `cordis.patch.yml`，也禁止在 profile 里自己跑 pnpm）。

### A. 开发模式：文件夹链接安装（改代码即时生效）

```jsonc
plugin_manager { "action": "install_bundle", "target": "<本文件夹的绝对路径>" }
```

- pnpm 会把依赖记为 `link:` 软链，**本体始终是本文件夹**：改 `client.js` 后页面会自动热更，无需重装
- 代价：**删除或移动本文件夹前必须先卸载**，否则该 profile 启动时会报缺包

### B. 发布模式：tarball 独立副本安装（本体可删可移）

```powershell
powershell -File scripts\pack.ps1        # 生成 local-dsh-context-usage-<version>.tgz
```

```jsonc
plugin_manager { "action": "install_bundle", "target": "<tgz 的绝对路径>" }
```

- pnpm 会把 tarball **解压安装**进 profile，profile 里从此是一份独立副本 → **本文件夹可以任意删除或移动**
- 升级：改 `package.json` 的 `version` → 重新 `pack.ps1` → 再 `install_bundle`
- 代价：改代码不再自动生效，必须重新 pack + 安装

> 迁移到另一台机器/另一个 DSH：整个文件夹拷过去（或只拷那个 `.tgz`），在新 profile 上重复对应模式的安装步骤即可。插件不依赖任何宿主包，也不需要构建。

---

## 2. 验证安装成功

- 结构校验（无需审批）：`cordis_inspect_query` → `client` / `Slots` / `listSubTree`，`root` = `conversation.input.dock`，应看到 `id: context-usage` 且 `active: true`
- 行为校验（需要你在界面上看）：敲 /context，或点作曲器右下（模型选择器与发送键之间）的 ◔ xx% 按钮 → 作曲器卡片内、输入框与权限栏之间出现用量条
- **改过 index.js 后**：在插件管理里 disable → enable（宿主会重新 `import()`，已实测，不必重启 DSH），再 `Ctrl+R` 刷新页面。面板应出现 4 段图例（系统提示词 / 工具定义 / 工具结果 / 对话消息，对话消息由用户消息、助手回复、压缩摘要合并而来）；若只看到 3 类（系统提示词 / 工具定义 / 对话消息）且数字明显偏高，说明 Host 半没重载，走的是兼容回退
- 持久化校验：开着面板的会话关掉 DSH 再打开，面板仍是开着的（状态在 `~/.local/state/dsh-context-usage/panels.json`，经 `/__context-usage/panels` 读写）

## 3. 卸载

1. `plugin_manager { "action": "remove_bundle", "target": "@local/dsh-context-usage" }`
2. 检查 `~/.dsh/profiles/<profile>/cordis.patch.yml`，若残留下面这种覆盖项（切换插件开关时由 plugin_manager 追加），删掉它：
   ```yaml
   - id: context-usage
     disabled: false
   ```
3. 开发模式：**先卸载再删文件夹**；发布模式：随时可删文件夹
4. 求彻底：可再看 `~/.dsh/profiles/<profile>/.plugin-manager/logs/`

安装会在该 profile 留下这些痕迹，`remove_bundle` 会逆向它们：`package.json` 的一条依赖、`pnpm-lock.yaml` 的更新、`node_modules/@local/dsh-context-usage`（软链或解压副本）、`.plugin-manager/logs/` 一份日志、以及上面那条 patch 覆盖。

## 4. 已知边界

- 只在 **Web / 桌面 GUI** 里有命令面（纯客户端命令）；headless / CLI 没有该命令
- 余额药丸里的 `CLIENT_VERSION` 硬编码为 `0.2.0-rc.2`（客户端插件在运行时读不到 shell 版本）。DSH 升级后若平台拒收，药丸会显示 `余额 接口异常·<code>`，改这一处常量即可
- 上下文容量取自 `contextPressure.contextWindow`（provider 每次请求上报），**换模型自动跟随**，包内没有硬编码容量
- 构成是 4 字符/token 启发式估算，再按 contextPressure 的实测占用等比校正（系统提示词与工具定义不缩放），所以四段之和恒等于实测占用；「本会话累计」四格是 provider 上报的计费口径，两者不同源
- 没有 	urn/start 基线的会话（fork、或日志从中途开始）不显示「本轮」增量，宁缺毋滥

## 5. 两处需要知道的行为

**隐藏官方作曲器底栏（`HIDE_SHIPPED_DOCK`）**
本包挂载时会**整行隐藏**作曲器下方那条官方底栏（原版上下文占用圆环 + 轮/步/速度统计药丸 + 计费用量药丸），把这段垂直空间还给对话区。

官方没有开关可用——`ui-conversation` 的 Config 只有 `busyEnter` 一项；`conversation.input.activity` 槽虽然能抑制圆环，但同一处 `hidden: activity` 会把模型选择器和本包按钮一起藏掉。

因此实现方式是**本包自有的一张样式表**（由 `ctx.effect` 创建/销毁，带 `data-plugin` 标记），作用域由本包在该 dock 内放置的锚点元素限定：

```css
[class$="_dock"]:has([data-context-usage="composer-dock-anchor"]) { display: none !important }
```

被隐藏的信息**全部有去处**：占用率 → 面板与作曲器按钮；未命中/命中/命中率/输出 → 面板中间栏；轮数/步数/输出速度 → 面板图例行右端；余额 → 移到作曲器控件行（占用按钮右侧）。

- 只可能命中本包锚点所在的那个 dock，不会波及其他面板
- 依赖 `_dock` 这个 CSS Module 命名后缀，**DSH 大版本升级后需要复核一次**
- 想恢复官方底栏：把 `client.js` 里的 `HIDE_SHIPPED_DOCK` 改成 `false` 即可

**余额刷新**
`ctx.remote.account.getBalance` 是宿主直连 Platform 的 HTTP 请求（已核实 `getDetail → requestAccount`，**宿主侧无缓存**），前台可见时每 10 秒一次，前台不可见时零请求。鼠标悬停在余额上会显示**取样时间**（`DeepSeek 余额 · HH:MM:SS`）——用它可以分辨"轮询没跑"和"平台返回的就是旧值"。

## 6. 文件清单

| 文件 | 作用 |
|---|---|
| `package.json` | 包清单：`dsh.bundle.patch`（Host 行）+ `dsh.client`（浏览器半）+ `icon` + `locale` |
| `cordis.patch.yml` | 一行 insert，把本包挂进 profile 条目树 |
| `index.js` | Host 半：注册 `contextUsage` 投影（六类计价 + 本轮增量 + 压缩声明结算）+ `/__context-usage/panels` 面板状态路由 |
| `client.js` | Client 半：`/context` 命令、占用按钮、用量面板、余额药丸 |
| `scripts/check-projection.mjs` | 无头自测：投影折叠 / 压缩声明 / 引用稳定 |
| `scripts/check-client.mjs` | 无头自测：面板取值、缩放、图例（可喂真实会话日志） |
| `scripts/replay-session.mjs` | 把真实会话日志回放进投影，对比 provider 实测 prompt |
| `locale/zh.json`、`locale/en.json` | 插件页展示的标题与描述 |
| `icon.svg` | 插件页图标（三段圆环） |
| `scripts/pack.ps1` | 打包成可独立安装的 tarball |
| `INSTALL.md` | 本文件 |

