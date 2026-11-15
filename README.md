# dsh-context-usage

一个 **DeepSeek Harness** 的 Web 插件：把「这条对话到底把上下文烧到哪了」做成一屏可读的可视化面板 —— `/context` 斜杠命令、作曲器里的占用按钮、以及嵌在作曲器卡片里的用量条。

> 对标 Claude Code 的 `/context`：同样的**分段占用 + 容量占比**，但补齐了它在 DSH 里缺失的部分 —— 累计计费用量、轮数/步数/输出速度、账户余额。

![面板截图](docs/screenshot.png)

---

## 它解决什么

DSH 原生的上下文信息散落在作曲器下方那条底栏里：一个圆环 + 三个计费药丸。你知道"用了多少"，但不知道 **用在哪**（系统提示词？工具定义？对话历史？），也看不到本会话的累计消耗和速度。

这个插件把那些数字集中成一块面板，并把官方底栏整行隐藏、把纵向空间还给对话区（隐藏项全部有去处，见下）。

## 功能

- **`/context` 斜杠命令** —— 带插件自有的图标与中文简介，一键开合面板
- **占用按钮** —— 作曲器控件行（发送键与模型选择器之间）的 `◔ 67%`，实时跟随，点击开合
- **开合状态记得住** —— 按会话记在宿主侧（`GET/POST /__context-usage/panels` → `~/.local/state/dsh-context-usage/panels.json`），关掉 DSH 再开，上次开着的会话仍然开着
- **用量面板** —— 嵌在作曲器卡片**内部**，夹在「输入内容」与「权限栏 / 发送键」之间（宿主没有这个位置的空槽位，所以用 React portal 插到控制行之前，宿主改结构时锚点要跟着调）；没有自己的边框、底色和圆角，就是卡片里的一条信息区。三行读完：
  - **总览行**：`101.4K / 1M` + `本轮 +19.6K (1.9%)`，右侧一行累积账（未命中 / 命中 / 命中率 / 输出，provider 计费口径）。没有圆环和百分比——作曲器按钮上已经有一个同款的
  - **占用条**：单行连续堆叠带，四段——系统提示词（紫）/ 工具定义（蓝）/ 工具结果（青）/ 对话消息（绿，含用户消息、助手回复与压缩摘要）。纯色填充，命中「冷色家族」的一段接一段，条内加 1px 高斯模糊柔化接缝。本轮新增不再单独占一段，只在总览行给一个 `本轮 +X (占比)` 的文字
  - **图例行**：四段 chips（各自配一枚同色线稿图标，非零才出现）+ 剩余空间 + `轮数 · 步数 · tok/s`

- **余额药丸** —— 作曲器右侧显示账户余额，前台每 10 秒刷新，悬停显示取样时间；未登录/无钱包/接口异常都有明确状态
- **零依赖、无构建** —— 手写纯 JavaScript，只 `require('react')`，样式只用宿主主题 token。没有 `src/`、没有 `pnpm install`、没有 `pnpm run build`

## 安装

> 安装**只能**通过 DSH 的 `plugin_manager` 工具完成 —— 这是官方唯一支持的路径（官方技能明确禁止手改 profile 的 `package.json` / `cordis.patch.yml`，也禁止在 profile 里自己跑 pnpm）。

**开发模式**（文件夹链接，改代码即时生效）：

```jsonc
plugin_manager { "action": "install_bundle", "target": "<本仓库的绝对路径>" }
```

**发布模式**（tarball 独立副本，本体可删可移）：

```powershell
powershell -File scripts\pack.ps1        # 生成 local-dsh-context-usage-<version>.tgz
```

```jsonc
plugin_manager { "action": "install_bundle", "target": "<tgz 的绝对路径>" }
```

装好后敲 `/context`，或点作曲器右下角（模型选择器与发送键之间）的 `◔ xx%` 按钮。

完整的验证 / 升级 / 卸载 / 迁移步骤见 **[INSTALL.md](INSTALL.md)**（那份是写给 agent 读的）。

## 它隐藏了官方底栏，那些信息去哪了

挂载时本插件会整行隐藏作曲器下方那条官方底栏（原版占用圆环 + 轮/步/速度药丸 + 计费用量药丸），信息全部有去处：

| 官方底栏 | 去向 |
|---|---|
| 占用率圆环 | 作曲器占用按钮 |
| 未命中 / 命中 / 输出 / 计费 | 面板「本会话累计」 |
| 轮数 / 步数 / 输出速度 | 面板图例行右端 |
| 账户余额 | 作曲器控件行（占用按钮右侧） |

官方没有可用的开关 —— `ui-conversation` 的 Config 只有 `busyEnter` 一项；`conversation.input.activity` 槽虽然能抑制圆环，但同一处 `hidden: activity` 会把模型选择器和本插件按钮一起藏掉。

所以实现方式是**本插件自有的一张样式表**，作用域由本插件放进该 dock 的锚点元素限定：

```css
[class$="_dock"]:has([data-context-usage="composer-dock-anchor"]) { display: none !important }
```

- 只可能命中本插件锚点所在的那个 dock，不会波及其他面板
- 想恢复官方底栏：把 `client.js` 里的 `HIDE_SHIPPED_DOCK` 改成 `false`
- 依赖 `_dock` 这个 CSS Module 命名后缀，**DSH 大版本升级后需要复核一次**

## 数据来源与口径

数据全部来自宿主投影，没有埋点、不发额外请求。其中「四段构成」由**本插件自带的 Host 投影**算出来（`index.js` 注册的 `contextUsage`），其余都是宿主原生投影：

| 面板元素 | 来源 | 口径 |
|---|---|---|
| 容量 / 占用 | `contextPressure.contextWindow`、`projectedTokens ?? pressureTokens` | provider 每次请求上报的**实测** prompt 大小，换模型自动跟随 |
| 系统提示词 / 工具定义 / 工具结果 / 对话消息 | **本插件的 `contextUsage` 投影** | 按事件流逐块计价（见下）；面板把用户消息、助手回复、压缩摘要合并成「对话消息」一段 |
| 本轮新增 | 同一投影的 `turn` 增量 | 相对上一次 `turn/start` 的差值 |
| 未命中 / 命中 / 命中率 / 输出 | `tokenUsage` | provider 上报的**计费**口径（本会话累计） |
| 轮数 / 步数 / 输出速度 | `sessionStats` | 宿主统计 |
| 余额 | `ctx.remote.account.getBalance` | 宿主直连 Platform，**宿主侧无缓存** |

构成是怎么算的、为什么可信：

1. **计价**：Host 半跟着会话事件流走，每块内容按 4 字符/token 折算（与宿主 `contextBreakdown` 同口径），系统提示词、工具定义（canonical header 的 `tools`）、用户消息、助手回复（含 tool-call 参数）、工具结果分别落到六个计价桶里；面板再把其中三个合并成「对话消息」这一段显示，饼图上永远不会有细到看不见的碎片。系统提示词只取**最后一条 `system/message`**；`developer/message`（工具增删这类控制消息）不算系统提示词，计入工具桶，下一次 `request/header` 会把它们并回工具清单。
2. **压缩**：遇到 `compaction/summary` / `compaction/prune`，被影子替换的节点按 `shadowedTokenCount` 从对应桶里扣除，紧接着的替换写入落到「压缩摘要」桶 —— `/compact`、billion-context 这类代理侧压缩都走这条事件，所以压完不会留下已经不在上下文里的账。
3. **对齐实测**：六桶之和会按 `contextPressure` 的实测占用做一次校正 —— 系统提示词与工具定义保留原值，消息类等比缩放，使四段之和**精确等于**真实注入量。压缩代理怎么改消息体，条和图例都跟着实测值走。


两点如实说明：

1. **总量是实测，构成是估算**：占用率来自 provider 上报，构成是字符折算后按实测总量校正的结果，分类之间的比例是估算，边界不严格等价于真实 token 切分。
2. **"本会话累计"与"占用构成"不同源**：前者是计费口径的累计值，后者是当前请求的上下文构成。两者不该互相验算，这是有意保留的。

## 已知边界

- 只在 **Web / 桌面 GUI** 里有命令面（纯客户端命令），headless / CLI 没有该命令
- 上下文容量取自 provider 上报值，模型没上报时该行按缺失处理
- Host 半（`index.js`）没随插件重载时，面板自动退回三分类（系统 / 工具 / 消息），不会报错
- 面板开合记在宿主侧（`~/.local/state/dsh-context-usage/panels.json`，经 `GET/POST /__context-usage/panels` 读写），因为 Web GUI 每次启动换端口、`localStorage` 会跟着丢。宿主文件的写失败只是"本次刷新内记得"
- 余额药丸里的 `CLIENT_VERSION` 硬编码为 `0.2.0-rc.2`（客户端插件运行时读不到 shell 版本）。DSH 升级后若平台拒收，药丸会显示 `余额 接口异常·<code>`，改这一处常量即可
- 包名 `@local/dsh-context-usage` 里的 `@local` 是"只装进本机 profile、从不发布到 npm"的意思，不是真实的 npm scope；`private: true` 同理

## 目录结构

```
package.json        # 包清单：dsh.bundle.patch（Host 行）+ dsh.client（浏览器半）+ icon + locale
cordis.patch.yml    # 一行 insert，把本包挂进 profile 条目树
index.js            # Host 半：注册 contextUsage 投影（六类计价 + 本轮增量）+ 面板状态的小路由
client.js           # Client 半：全部 UI（单行占用条、图例、切换按钮、余额药丸）
locale/zh.json      # 插件页展示的标题与描述
locale/en.json
icon.svg            # 插件页图标（三段圆环）
scripts/pack.ps1    # 打包成可独立安装的 tarball
scripts/check-*.mjs # 两个无头自测：投影折叠 / 面板取值（不依赖浏览器）
scripts/replay-session.mjs # 离线回放会话日志，对照 provider 实测 prompt
scripts/probe-sysprice.mjs # 逐条打印系统提示词类节点的价格（排查用）
scripts/session-frames.mjs # 多帧 zstd 会话日志的解码底座
INSTALL.md          # 写给 agent 的安装/卸载/迁移说明
docs/               # README 配图
```

## 开发

改 `client.js` → 开发模式下页面自动热更；如果页面仍跑着旧 bundle（浏览器会按 id 去重注册），在插件管理里 disable → enable 再 `Ctrl+R`。改 `index.js`（Host 半）同样 disable → enable 即可：重新启用时宿主会重新 `import()` 这个模块、重新注册投影（已实测，不必重启 DSH）。判据是面板显示四段；若退回三分类（系统 / 工具 / 消息），说明 Host 半没生效。

改完先跑自测，再重载验收：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& 'C:\Users\ROSE\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe' scripts\check-projection.mjs
& 'C:\Users\ROSE\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe' scripts\check-client.mjs
```

## 排查

面板数字不对时，先离线回放会话日志，别猜：

```powershell
# 整份日志过一遍投影：事件计数、四段折叠值、provider 实测 prompt、倍率
& '...\DeepSeek Harness.exe' scripts\replay-session.mjs <session.v4.jsonl.zstd>
# 只看系统提示词类节点：逐条价格、最后一条（即 liveSystem）是谁
& '...\DeepSeek Harness.exe' scripts\probe-sysprice.mjs <session.v4.jsonl.zstd> 8
```

`replay-session.mjs` 打印的 `folded total` 通常远大于 provider prompt —— 那正说明压缩代理在途改写了消息体，面板靠实测占用校正，不是投影算错。`probe-sysprice.mjs` 用来定位「系统提示词 74」这类被控制消息顶替的问题。

## 卸载

```jsonc
plugin_manager { "action": "remove_bundle", "target": "@local/dsh-context-usage" }
```

然后检查 `~/.dsh/profiles/<profile>/cordis.patch.yml`，删掉 plugin_manager 追加的覆盖项：

```yaml
- id: context-usage
  disabled: false
```

开发模式下**先卸载再删文件夹**。详见 [INSTALL.md](INSTALL.md)。

## License

[MIT](LICENSE)

