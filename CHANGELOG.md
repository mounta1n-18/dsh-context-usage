# 变更记录

## 1.1.3 — 2026-11-14

- 面板开合状态跨重启保留：Web GUI 每次启动换端口，`localStorage` 绑在 origin 上会丢，所以改成宿主侧记账——`GET/POST /__context-usage/panels` 读写 `~/.local/state/dsh-context-usage/panels.json`（按 sessionId 记，去抖 400ms，最多 200 条）。请求失败只是「本次刷新内记得」，不影响面板本身。
- 面板上下留白：卡片顶边到输入内容 12px，输入内容到用量条 ~10px（卡片 `padding-top:8px` + 输入区 `.input{padding-top:4px}` = 12px；输入单行时框内还有 8px 余量，用量条用 `margin-top:-9.8px` 抵掉再收 15%），条与权限栏之间 6.8px（`margin-bottom:-7.2px`）。

## 1.1.2 — 2026-11-14

- 面板完全嵌入作曲器卡片内部：位置在「输入内容」与「权限栏 / 发送键」之间，成为卡片的 flex 子元素，不再是卡片上方的一张独立卡。宿主没有这个位置的槽位，因此用 React portal 把面板插到控制行之前；宿主改结构时锚点需要跟着调（`[data-composer-card]` + 最后一个含按钮的直接子元素）。
- 去掉面板自己的圆环、百分比与标题：圆环和占比在作曲器按钮上已有同款，卡片上下文里也不需要重复标题。总览行只留 `used / capacity`、本轮增量与右侧累积账。
- 面板不再自带边框、底色和圆角，直接继承卡片表面；占用条 14px → 12px。

## 1.1.1 — 2026-11-14

- 修复：`developer/message`（工具增删这类控制消息）不再顶替系统提示词。以前它和 `system/message` 一起进 `sys`，而 `liveSystem` 只取最后一条，所以紧跟系统提示词的工具删除通知（约 74 token）会让面板显示「系统提示词 74」。现在系统提示词只取最后一条 `system/message`，控制消息计入工具桶，并由下一次 `request/header` 收编。
- 删除 `scripts/probe-system.mjs`（与 `replay-session.mjs` 的事件计数重复），`probe-sysprice.mjs` 保留并写进 README「排查」一节。

## 1.1.0 — 2026-11-14

- 面板改为三行：总览行、单行连续占用条、图标图例 + 本轮新增。
- 180 格进度条换成单行堆叠条（四段纯色、1px 内模糊），不再有格子取整抖动。
- 新增 Host 半投影 `contextUsage`：按事件流把系统提示词、工具定义、工具结果、对话消息分开计价，并按 `contextPressure` 的实测占用校正；`/compact`、billion-context 等压缩走 `compaction/*` 事件结算。
- 配色改为四段冷色（紫 / 蓝 / 青 / 绿），深色主题各有一套。

## 1.0.10 — 2026-11-13

- 基线：36 列 × 5 行格子的上下文进度条。
