/**
 * Client half of the `@local/dsh-context-usage` bundle.
 *
 * One compact card, three bands:
 *
 *   1. overview — ring, title, `used / window`, percent, this turn's addition,
 *      and the token ledger (uncached, cached, hit rate, output);
 *   2. occupancy — a single continuous stacked bar over the whole context
 *      window, one deep colour per bucket and a pale sliver at each bucket's
 *      right edge for what the current turn added;
 *   3. legend — one chip per non-empty bucket, the free remainder, and the
 *      session pace.
 *
 * The buckets come from this bundle's own Host projection (`contextUsage`,
 * see `index.js`): system prompt, tool definitions, user messages, assistant
 * replies, tool results and compaction summaries. The client rescales those
 * rough prices onto the provider-reported prompt size — the only exact number
 * in the stack — so the legend always sums to the occupancy the request
 * actually paid for, even after `/compact` or a proxy-side compactor folded
 * the log between the report and the display.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-context-usage',
  factory(require) {
    const React = require('react')
    /* The maximized pane portals to the document body: every surface it would
     * otherwise sit in carries a backdrop filter, which makes that ancestor the
     * containing block for a fixed overlay and would mis-place it. */
    const ReactDOM = (() => {
      try {
        return require('react-dom')
      } catch (error) {
        return undefined
      }
    })()
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    /* ---------------------------------------------------------------------- */
    /* Constants                                                              */
    /* ---------------------------------------------------------------------- */

    const NS = 'context-usage'
    const CLIENT_VERSION = '0.2.0-rc.2'
    const BALANCE_REFRESH_MS = 10000
    const HIDE_SHIPPED_DOCK = true
    const DOCK_MARKER = 'composer-dock-anchor'
    const DOCK_STYLE_ID = '@local/dsh-context-usage/dock-override.css'

    /** This bundle's outline-rail stylesheet identity. */
    const OUTLINE_STYLE_ID = '@local/dsh-context-usage/outline.css'
    const PALETTE_STYLE_ID = '@local/dsh-context-usage/palette.css'

    const RING_RADIUS = 5.2
    const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

    /** Fixed pitch between neighbouring outline marks, as the shipped chat rail uses. */
    const RAIL_PITCH_PX = 10

    /* Painted left to right. Four groups only: a bucket so thin that it reads as
     * a scratch is worse than no bucket at all, so user messages, assistant
     * replies and compaction summaries share one "messages" band. Tool
     * definitions and tool results stay adjacent — they are one story. */
    const BUCKETS = [
      { key: 'system', label: 'system', sources: ['system'] },
      { key: 'tools', label: 'tools', sources: ['tools'] },
      { key: 'tool', label: 'tool', sources: ['tool'] },
      { key: 'messages', label: 'messages', sources: ['user', 'assistant', 'compact'] },
    ]

    /** Buckets shown when the Host projection is unavailable (older Host half). */
    const LEGACY_BUCKETS = [
      { key: 'system', label: 'system', sources: ['system'] },
      { key: 'tools', label: 'tools', sources: ['tools'] },
      { key: 'messages', label: 'messages', sources: ['assistant'] },
    ]


    /**
     * Role tints for one transcript block. These are content colors, not state
     * colors: `state-idle-primary` is near-white (#d4d4d4) and
     * `state-danger-primary` resolves to near-black in this theme, so the state
     * ramp cannot distinguish a covered tool call from a failed one. Each role
     * instead takes a hue with real contrast against both pane backgrounds.
     */
    const ROLE_COLOR = {
      user: 'var(--dsw-alias-state-business-primary)',
      assistant: 'var(--dsw-alias-state-success-primary)',
      context: 'var(--dsw-alias-state-warn-primary)',
      tool: 'var(--dsw-alias-label-tertiary)',
      toolFailed: 'var(--dsw-alias-state-error-primary)',
    }

    /* ---------------------------------------------------------------------- */
    /* Palette                                                                */
    /* ---------------------------------------------------------------------- */

    /* Every band is painted in a light, low-saturation fill; what the current
     * turn added is painted in that band's `ink` at the band's right edge. The
     * four hues were picked as one sequence — violet → blue → amber → green —
     * so neighbours never fight: the warm amber never lands next to the green,
     * and the red that used to sit beside it is gone entirely. */
    const PALETTE_CSS = `
:root {
  --cu-system: #7c3aed;
  --cu-tools: #2563eb;
  --cu-tool: #0891b2;
  --cu-messages: #059669;
  --cu-track: rgba(0, 0, 0, 0.07);
  --cu-turn: #047857;
  --cu-ring: #4d8df5;
}
body[data-ds-dark-theme] {
  --cu-system: #6d28d9;
  --cu-tools: #1d4ed8;
  --cu-tool: #0e7490;
  --cu-messages: #047857;
  --cu-track: rgba(255, 255, 255, 0.10);
  --cu-turn: #6ee7b7;
  --cu-ring: #7fb2ff;
}
`


    /* ---------------------------------------------------------------------- */
    /* Copy                                                                   */
    /* ---------------------------------------------------------------------- */

    const zh = {
      title: '上下文用量',
      commandDescription: '查看本会话的上下文占用明细',
      running: '统计中…',
      failed: '统计失败',
      system: '系统提示词',
      tools: '工具定义',
      user: '用户消息',
      assistant: '助手回复',
      tool: '工具结果',
      compact: '压缩摘要',
      messages: '对话消息',
      free: '剩余空间',
      noSample: '暂无样本',
      tipUsed: '已用 / 容量',
      tipFree: '剩余空间',
      tipExpandHint: '悬停查看完整内容',
      miss: '未命中',
      hit: '命中',
      hitRate: '命中率',
      output: '输出',
      turns: '轮',
      steps: '步',
      tps: 'tok/s',
      turnNew: '本轮',
      estimated: '估算',
      balanceTitle: 'DeepSeek 余额',
      balanceSignedOut: '余额 未登录',
      balanceEmpty: '余额 无钱包',
      balanceFailed: '余额 读取失败',
      balanceError: '余额 接口异常',
    }

    const en = {
      title: 'Context usage',
      commandDescription: 'Show what this session has in context',
      running: 'Measuring…',
      failed: 'Measurement failed',
      system: 'System prompt',
      tools: 'Tool definitions',
      user: 'User messages',
      assistant: 'Assistant replies',
      tool: 'Tool results',
      compact: 'Compaction',
      messages: 'Messages',
      free: 'Free',
      noSample: 'No sample yet',
      tipUsed: 'Used / capacity',
      tipFree: 'Free space',
      tipExpandHint: 'Hover to view full content',
      miss: 'Uncached',
      hit: 'Cached',
      hitRate: 'Hit rate',
      output: 'Output',
      turns: 'turns',
      steps: 'steps',
      tps: 'tok/s',
      turnNew: 'this turn',
      estimated: 'estimate',
      balanceTitle: 'DeepSeek balance',
      balanceSignedOut: 'balance: signed out',
      balanceEmpty: 'balance: no wallet',
      balanceFailed: 'balance: read failed',
      balanceError: 'balance: call failed',
    }

    /* ---------------------------------------------------------------------- */
    /* Styles                                                                 */
    /* ---------------------------------------------------------------------- */

    const S = {
      /* The band is a flex child of the shipped composer card, inserted between
       * the draft and the button row. Measured against the shipped CSS, the
       * draft text starts 12px below the card's top edge (8px card padding-top
       * + 4px .input padding-top) and the one-line draft box also carries 8px
       * of slack below the text (min-height 36 vs 24px line + 4px pad), so a 0
       * margin still reads as a ~20px gap. -9.8px pulls it to ~10.2px (12px
       * minus the 15% the user asked to trim), and -7.2px keeps 6.8px to the
       * button row (12px gap + 2px row padding). */
      panel: {
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        margin: '-9.8px 0 -7.2px',
        padding: '0 12px 0',
        minWidth: 0,
      },
      panelCard: {
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
      },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '10px 12px',
        border: '1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.1))',
        borderRadius: 'var(--dsw-radius-lg, 10px)',
        minWidth: 0,
      },
      head: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 },
      title: {
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary, inherit)',
        whiteSpace: 'nowrap',
      },
      figure: {
        fontSize: 11,
        color: 'var(--dsw-alias-label-secondary, inherit)',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      },
      percent: {
        fontSize: 12,
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--dsw-alias-label-primary, inherit)',
        whiteSpace: 'nowrap',
      },
      turnBadge: {
        fontSize: 11,
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--cu-turn)',
        whiteSpace: 'nowrap',
      },
      spacer: { flex: '1 1 auto', minWidth: 0 },
      stats: {
        display: 'flex',
        alignItems: 'baseline',
        gap: 14,
        flexWrap: 'wrap',
        minWidth: 0,
      },
      statLabel: { fontSize: 13, color: 'var(--dsw-alias-label-secondary, inherit)', whiteSpace: 'nowrap' },
      statValue: {
        fontSize: 14,
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary, inherit)',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        marginLeft: 5,
      },
      bar: {
        position: 'relative',
        width: '100%',
        height: 12,
        borderRadius: 6,
        overflow: 'hidden',
        background: 'var(--cu-track)',
      },
      barLayer: {
        position: 'absolute',
        top: -2,
        bottom: -2,
        left: -2,
        right: -2,
        display: 'flex',
        alignItems: 'stretch',
        filter: 'blur(1px)',
      },
      segment: {
        height: '100%',
        flex: '0 0 auto',
        overflow: 'hidden',
      },
      legend: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        minWidth: 0,
      },
      chip: { display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, whiteSpace: 'nowrap' },
      chipLabel: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary, inherit)' },
      chipValue: {
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary, inherit)',
        fontVariantNumeric: 'tabular-nums',
      },
      pace: { fontSize: 11, color: 'var(--dsw-alias-label-secondary, inherit)', whiteSpace: 'nowrap' },
      muted: { fontSize: 11, color: 'var(--dsw-alias-label-secondary, inherit)' },
      error: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #e5484d)' },
      toggle: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 24,
        padding: '0 6px',
        border: '1px solid transparent',
        borderRadius: 6,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, inherit)',
        fontSize: 11,
        fontVariantNumeric: 'tabular-nums',
        cursor: 'pointer',
      },
      toggleActive: {
        background: 'var(--cu-track)',
        color: 'var(--dsw-alias-label-primary, inherit)',
      },
      /** Hover tooltip anchored to the composer occupancy button; also the
       * anchor for its detached right-side detail pane. */
      tip: {
        position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 50,
        boxSizing: 'border-box', minWidth: 200, whiteSpace: 'nowrap',
        padding: '8px 10px', borderRadius: 'var(--dsw-radius-lg)',
        background: 'var(--dsw-specific-menu)', backdropFilter: 'var(--dsw-menu-backdrop-filter)',
        boxShadow: 'var(--dsw-elevation-panel)', border: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-primary)', fontSize: 12, lineHeight: '18px',
      },
      tipRow: { display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' },
      tipName: { display: 'flex', alignItems: 'center', gap: 6 },
      tipValue: { fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-secondary)' },
      tipPercent: { fontVariantNumeric: 'tabular-nums', fontWeight: 600, width: 48, textAlign: 'right' },
      tipHead: { fontWeight: 600, marginBottom: 4 },
      tipToggleRow: { cursor: 'pointer', borderRadius: 4, padding: '1px 2px', margin: '0 -2px' },
      tipChevron: { color: 'var(--dsw-alias-label-tertiary)', flex: 'none', width: 12, textAlign: 'right' },
      /** Panel legend rows reveal their content through the same right-side pane. */
      legendHoverable: { cursor: 'pointer', borderRadius: 4, margin: '0 -2px', padding: '0 2px' },
      legendHovered: { background: 'var(--dsw-alias-interactive-bg-hover-solid)' },
      /** Position anchor so a legend's detail pane can hang beside the card. */
      paneAnchor: { position: 'relative' },
      /* The detached detail pane: floats to the right of the tooltip card,
       * vertically aligned with its top; it occupies no layout space, so the
       * composition rows never reflow when content appears. The wrapper's
       * transparent left padding bridges the gap to the row, so the pointer can
       * cross from one to the other without the pane closing. */
      tipPane: {
        position: 'absolute', top: 0, left: '100%', zIndex: 51,
        paddingLeft: 12,
      },
      /** The pane's visible card. */
      paneCard: {
        margin: 0, padding: '6px 8px', borderRadius: 6,
        width: 320, maxHeight: 260, overflow: 'auto',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text',
        background: 'var(--dsw-specific-menu)', backdropFilter: 'var(--dsw-menu-backdrop-filter)',
        boxShadow: 'var(--dsw-elevation-panel)', border: '1px solid var(--dsw-alias-border-l1)',
        fontSize: 11, lineHeight: '16px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        color: 'var(--dsw-alias-label-primary)',
      },
      /** The pane's header strip, holding the maximize control. */
      paneBar: {
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6,
        margin: '-6px -8px 4px', padding: '2px 4px 2px 8px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        position: 'sticky', top: -6, background: 'var(--dsw-specific-menu)', zIndex: 1,
      },
      paneBarTitle: { flex: 'auto', color: 'var(--dsw-alias-label-tertiary)', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      paneButton: {
        flex: 'none', display: 'grid', placeItems: 'center', width: 20, height: 20,
        padding: 0, border: 'none', borderRadius: 4, background: 'transparent', cursor: 'pointer',
        color: 'var(--dsw-alias-label-secondary)', fontFamily: 'inherit', fontSize: 12, lineHeight: 1,
      },
      /** Maximized pane: a centered fixed overlay over the whole viewport. */
      paneOverlay: {
        position: 'fixed', inset: 0, zIndex: 200, display: 'grid', placeItems: 'center',
        background: 'rgba(0, 0, 0, 0.42)',
      },
      paneModal: {
        margin: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
        width: 'min(880px, 92vw)', height: 'min(78vh, 760px)', overflow: 'hidden',
        position: 'relative',
        padding: '8px 12px 12px', borderRadius: 'var(--dsw-radius-lg)',
        whiteSpace: 'normal', wordBreak: 'normal', userSelect: 'text',
        background: 'var(--dsw-alias-bg-layer-1, #fff)', backdropFilter: 'var(--dsw-menu-backdrop-filter)',
        boxShadow: 'var(--dsw-elevation-panel)', border: '1px solid var(--dsw-alias-border-l1)',
        fontSize: 12, lineHeight: '18px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        color: 'var(--dsw-alias-label-primary)',
      },
      /** Bottom-right resize grip of the maximized card. */
      paneResizeGrip: {
        position: 'absolute', right: 1, bottom: 1, width: 16, height: 16, zIndex: 6,
        display: 'grid', placeItems: 'center', cursor: 'nwse-resize',
        color: 'var(--dsw-alias-label-tertiary)', touchAction: 'none',
      },
      paneResizeGripActive: { color: 'var(--dsw-alias-brand-primary)' },
      /** The scrollable body inside the maximized card. */
      paneModalBody: { flex: 'auto', minHeight: 0, overflow: 'auto', padding: '2px 6px 2px 2px' },
      /** Extra right gutter on the maximized card, so the rail floats clear of the text. */
      paneModalWithRail: { position: 'relative', paddingRight: 30 },
      /** The rail's placement, after the shipped chat turn navigator. Marks,
       * hover emphasis and the preview card are styled in the injected sheet. */
      outlineRail: {
        position: 'absolute', top: 40, bottom: 12,
        right: 6, width: 28, zIndex: 4, cursor: 'pointer',
      },
      /** The block a rail jump landed on. */
      paneBlockActive: { background: 'var(--dsw-alias-interactive-bg-hover-solid)' },
      /** One conversation block: a role-tinted rail beside a document-like body. */
      paneBlock: {
        margin: '0 0 14px', padding: '4px 12px 6px 12px',
        borderLeft: '3px solid transparent', borderRadius: '0 8px 8px 0',
        fontFamily: 'var(--dsw-font-family, ui-sans-serif, system-ui, sans-serif)',
        fontSize: 13, lineHeight: '21px', color: 'var(--dsw-alias-label-primary)',
        whiteSpace: 'normal',
      },
      paneBlockHead: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        position: 'sticky', top: -8, zIndex: 1,
        margin: '0 -12px 6px', padding: '4px 12px',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        borderBottom: '1px solid transparent',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
      paneBlockRole: { fontWeight: 600 },
      paneBlockChars: {
        color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        padding: '0 6px', borderRadius: 999, background: 'var(--dsw-alias-interactive-bg-hover-solid)',
      },
      /* Markdown body of one message. */
      mdBody: { display: 'flex', flexDirection: 'column', gap: 2 },
      mdParagraph: { margin: '2px 0 6px', overflowWrap: 'anywhere' },
      mdHeading: { fontWeight: 700, lineHeight: '22px', margin: '10px 0 4px' },
      mdH1: { fontSize: 16 },
      mdH2: { fontSize: 15 },
      mdH3: { fontSize: 13.5 },
      mdItem: { display: 'flex', gap: 6, margin: '1px 0', overflowWrap: 'anywhere' },
      mdBullet: { flex: 'none', color: 'var(--dsw-alias-label-tertiary)', minWidth: 10 },
      mdItemText: { flex: 'auto', minWidth: 0 },
      mdQuote: {
        margin: '4px 0', padding: '2px 10px', borderLeft: '2px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
      },
      mdPre: {
        margin: '6px 0', padding: '8px 10px', borderRadius: 6, overflowX: 'auto',
        background: 'var(--dsw-alias-interactive-bg-hover-solid)',
        border: '1px solid var(--dsw-alias-border-l1)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12, lineHeight: '18px', whiteSpace: 'pre',
      },
      mdPreCode: { fontFamily: 'inherit', fontSize: 'inherit' },
      mdCode: {
        padding: '1px 5px', borderRadius: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12, background: 'var(--dsw-alias-interactive-bg-hover-solid)',
      },
      mdStrong: { fontWeight: 650 },
      mdLink: { color: 'var(--dsw-alias-state-business-primary)', textDecoration: 'underline' },
      balance: {
        display: 'inline-flex',
        alignItems: 'center',
        height: 24,
        padding: '0 2px',
        fontSize: 12,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        color: 'var(--dsw-alias-label-secondary, inherit)',
      },
    }

    /* ---------------------------------------------------------------------- */
    /* Formatting                                                             */
    /* ---------------------------------------------------------------------- */

    /**
     * Compact token count: exact below 1000, then `101.4K`, `25.7M`.
     * @param value - the count, possibly undefined.
     * @returns display text, `—` when there is no sample.
     */
    function formatTokens(value) {
      if (value === undefined || value === null || !Number.isFinite(value)) return '—'
      const n = Math.max(0, value)
      if (n < 1000) return String(Math.round(n))
      if (n < 1e6) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`
      if (n < 1e9) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
      return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`
    }

    /**
     * Balance amount as currency text.
     * @param amount - a decimal string or number.
     * @param symbol - `¥` or `$`.
     * @returns display text.
     */
    function formatBalance(amount, symbol) {
      const value = Number(amount)
      if (!Number.isFinite(value)) return `${symbol}—`
      if (value > 0 && value < 0.01) return `<${symbol}0.01`
      return `${symbol}${value.toFixed(2)}`
    }

    /**
     * A ratio clamped to 0..100, undefined when undefined.
     * @param part - numerator.
     * @param whole - denominator.
     * @returns the percentage in 0..100, or undefined.
     */
    function share(part, whole) {
      if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return undefined
      return Math.max(0, Math.min(100, (part / whole) * 100))
    }

    /**
     * One-decimal percentage, without a trailing `.0`.
     * @param value - the percentage.
     * @returns display text.
     */
    function percentText(value) {
      if (value === undefined) return '—'
      return `${value.toFixed(1).replace(/\.0$/, '')}%`
    }

    /**
     * The locale binder handed to every slot.
     * @param props - slot props carrying `t`.
     * @returns the translate function.
     */
    function translator(props) {
      return props && typeof props.t === 'function' ? props.t : (key) => key
    }

    /**
     * The projection reader handed to every slot.
     * @param props - slot props carrying `useProjection`.
     * @returns the read function.
     */
    function projectionReader(props) {
      return props && typeof props.useProjection === 'function'
        ? props.useProjection
        : () => undefined
    }

    /**
     * Read one session's event window through the plugin-scoped sessions
     * service: the binding's Session instance carries `eventSource`, the live
     * contiguous event window the Conversation assembles from. The system
     * prompt lives at the log's head, so a window that still has older history
     * pages back (bounded) before extracting.
     * @param sessions - the client `sessions` service, or undefined before apply.
     * @param sessionId - the session id, absent on the hero composer.
     * @returns the event-window snapshot, or undefined without a binding.
     */
    function eventWindowOf(sessions, sessionId) {
      if (sessions === undefined || typeof sessionId !== 'string') return undefined
      const binding = typeof sessions.binding === 'function' ? sessions.binding(sessionId) : undefined
      const session = binding === undefined ? undefined : binding.session
      if (session === undefined || typeof session.eventSource?.getSnapshot !== 'function') return undefined
      return session.eventSource.getSnapshot()
    }

    /**
     * Page a session's history back to the log head, bounded, so the
     * `system/message` event at seq 0 enters the loaded window.
     * @param session - the client Session instance.
     * @returns whether the window now covers the log head.
     */
    async function pageToHead(session) {
      for (let round = 0; round < 60; round += 1) {
        const state = session.getSnapshot()
        if (!state.hasMore || state.loadingOlder === true) {
          if (state.loadingOlder === true) await new Promise((resolve) => setTimeout(resolve, 120))
          if (!state.hasMore) return true
          continue
        }
        await session.loadOlder()
      }
      const state = session.getSnapshot()
      return !state.hasMore
    }

    /** Page-to-head runs registered per session id, so concurrent hovers share one pass. */
    const HEAD_PAGER = new Map()

    /**
     * The detailed model-visible content of one session: the effective system
     * prompt, the tool catalog names, and the rendered conversation transcript.
     * The system prompt lives at the log head, so a window that still has older
     * history pages back once (shared per session), then re-reads.
     * @param sessions - the client `sessions` service, or undefined before apply.
     * @param sessionId - the session id, absent on the hero composer.
     * @returns `{ systemText, toolNames, conversationText }`; each undefined
     * without a session binding.
     */
    function useDetailedContent(sessions, sessionId) {
      const [ , forceTick] = React.useState(0)
      const eventWindow = eventWindowOf(sessions, sessionId)
      let systemText = systemPromptTextOf(eventWindow)
      let toolNames = toolNamesOf(eventWindow)
      const conversationBlocks = conversationBlocksOf(eventWindow)
      React.useEffect(() => {
        if (sessions === undefined || typeof sessionId !== 'string') return
        if (systemText === '' && !HEAD_PAGER.has(sessionId)) {
          const binding = sessions.binding(sessionId)
          const session = binding === undefined ? undefined : binding.session
          if (session !== undefined && session.getSnapshot().hasMore === true) {
            const pass = pageToHead(session)
            HEAD_PAGER.set(sessionId, pass)
            pass.then(() => {
              HEAD_PAGER.delete(sessionId)
              forceTick((n) => n + 1)
            })
          }
        }
      })
      return { systemText, toolNames, conversationBlocks }
    }

    /* ---------------------------------------------------------------------- */
    /* Model                                                                  */
    /* ---------------------------------------------------------------------- */

    /**
     * Compose the display model: exact occupancy, six priced buckets rescaled
     * onto it, this turn's additions, and the free remainder.
     *
     * Rescaling exists because two different meters meet here. `contextPressure`
     * reports what the provider actually billed for the last request — exact,
     * compactors and proxies included. The projection prices the session log
     * with a fixed density — honest for proportions, always a little off in
     * absolute terms, and blind to a proxy that rewrites the request in flight.
     * Anchoring the buckets on the reported size keeps every number consistent
     * with the occupancy, which is the number the user is really reading.
     *
     * @param pressure - the `contextPressure` projection value.
     * @param detail - this bundle's `contextUsage` projection value.
     * @param breakdown - the shipped `contextBreakdown` value (legacy fallback).
     * @returns the model, or undefined before the first request.
     */
    function usageModel(pressure, detail, breakdown) {
      const used = pressure === undefined ? undefined : pressure.projectedTokens ?? pressure.pressureTokens
      const capacity = pressure === undefined ? undefined : pressure.contextWindow
      if (!Number.isFinite(capacity) || capacity <= 0) return undefined

      const legacy = detail === undefined || detail === null
      const source = legacy
        ? {
          system: breakdown === undefined ? 0 : breakdown.systemTokens,
          tools: breakdown === undefined ? 0 : breakdown.toolsTokens,
          assistant: breakdown === undefined ? 0 : breakdown.messageTokens,
        }
        : {
          system: count(detail.system),
          tools: count(detail.tools),
          user: count(detail.user),
          assistant: count(detail.assistant),
          tool: count(detail.tool),
          compact: count(detail.compact),
        }

      const budget = Number.isFinite(used) ? Math.max(0, used) : 0
      const fixed = count(source.system) + count(source.tools)
      const messages = count(source.user) + count(source.assistant) + count(source.tool) + count(source.compact)
      const priced = fixed + messages

      let kFixed = 1
      let kMessages = 1
      if (budget > 0 && priced > 0) {
        if (budget <= fixed || messages <= 0) {
          kFixed = budget / priced
          kMessages = kFixed
        } else {
          kMessages = (budget - fixed) / messages
        }
      }

      const turn = legacy || detail.turn === undefined ? undefined : detail.turn
      const scaleOf = (key) => (key === 'system' || key === 'tools' ? kFixed : kMessages)
      const placed = (key) => count(source[key]) * scaleOf(key)
      /* `turn` already holds the delta, not a baseline: the Host folds it as
       * "current minus the value at the last `turn/start`". */
      const added = (key) => (turn === undefined ? 0 : count(turn[key]) * scaleOf(key))

      const buckets = (legacy ? LEGACY_BUCKETS : BUCKETS).map((bucket) => {
        let value = 0
        let raw = 0
        let delta = 0
        for (const key of bucket.sources) {
          value += placed(key)
          raw += count(source[key])
          delta += added(key)
        }
        return {
          key: bucket.key,
          label: bucket.label,
          sources: bucket.sources,
          value,
          raw,
          delta: value > 0 ? Math.min(delta, value) : 0,
        }
      })


      let deltaTotal = 0
      for (const bucket of buckets) deltaTotal += bucket.delta

      return {
        used: budget,
        capacity,
        usedPercent: share(budget, capacity),
        free: Math.max(0, capacity - budget),
        buckets,
        painted: buckets.filter((bucket) => bucket.value > 0),
        deltaTotal,
      }
    }

    /**
     * A non-negative finite count, or 0.
     * @param value - anything.
     * @returns the count.
     */
    function count(value) {
      return Number.isFinite(value) && value > 0 ? value : 0
    }

    /* ---------------------------------------------------------------------- */
    /* Panel state                                                            */
    /* ---------------------------------------------------------------------- */

    /** Session ids whose panel is open. */
    const PANEL_OPEN = new Set()
    /** Render callbacks to wake when that set changes. */
    const PANEL_LISTENERS = new Set()
    /**
     * Route the Host serves the remembered toggles on. The Host, not
     * `localStorage`, owns this: every GUI launch picks a fresh port, and a
     * remembered toggle must survive that.
     */
    const PANEL_ROUTE = '/__context-usage/panels'
    /** Whether the Host copy has been read once in this page. */
    let PANEL_LOADED = false
    /** Shared read, so every band mounting at once costs one request. */
    let PANEL_HYDRATING = null

    function notifyPanels() {
      for (const listener of Array.from(PANEL_LISTENERS)) listener()
    }

    /**
     * Read the remembered toggles from the Host once. A failure leaves the
     * in-memory set alone: the band still works, it just forgets on reload.
     */
    function hydratePanels() {
      if (PANEL_LOADED || PANEL_HYDRATING !== null) return
      let request
      try {
        request = fetch(PANEL_ROUTE, { headers: { accept: 'application/json' } })
      } catch {
        return
      }
      PANEL_HYDRATING = request
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          const panels = body && body.panels
          if (!panels || typeof panels !== 'object') return
          let changed = false
          for (const [sessionId, open] of Object.entries(panels)) {
            if (open === true && typeof sessionId === 'string' && !PANEL_OPEN.has(sessionId)) {
              PANEL_OPEN.add(sessionId)
              changed = true
            }
          }
          PANEL_LOADED = true
          if (changed) notifyPanels()
        })
        .catch(() => {})
        .then(() => {
          PANEL_HYDRATING = null
        })
    }

    /**
     * Send one toggle to the Host. Fire-and-forget: a failed write only costs
     * the memory across a restart.
     * @param sessionId - the session.
     * @param open - the new state.
     */
    function persistPanel(sessionId, open) {
      try {
        void fetch(PANEL_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, open }),
          keepalive: true,
        }).catch(() => {})
      } catch {
        /* persistence is best effort */
      }
    }

    /**
     * Open or close one session's panel.
     * @param sessionId - the session.
     * @param value - the desired state.
     */
    function setPanelOpen(sessionId, value) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return
      const open = PANEL_OPEN.has(sessionId)
      if (open === value) return
      if (value) PANEL_OPEN.add(sessionId)
      else PANEL_OPEN.delete(sessionId)
      notifyPanels()
      persistPanel(sessionId, value)
    }

    /** Close every panel (plugin teardown). */
    function closeAllPanels() {
      if (PANEL_OPEN.size === 0) return
      PANEL_OPEN.clear()
      notifyPanels()
    }

    /**
     * Subscribe one component to a session's panel state.
     * @param sessionId - the session.
     * @returns whether its panel is open.
     */
    function usePanelOpen(sessionId) {
      const [open, setOpen] = useState(() => typeof sessionId === 'string' && PANEL_OPEN.has(sessionId))
      useEffect(() => {
        const sync = () => setOpen(typeof sessionId === 'string' && PANEL_OPEN.has(sessionId))
        PANEL_LISTENERS.add(sync)
        sync()
        hydratePanels()
        return () => {
          PANEL_LISTENERS.delete(sync)
        }
      }, [sessionId])
      return open
    }

    /* ---------------------------------------------------------------------- */
    /* Atoms                                                                  */
    /* ---------------------------------------------------------------------- */

    /**
     * Tween the decorative menu glyph.
     * @returns a 16px SVG.
     */
    function ContextGlyph() {
      return h('svg', {
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        'aria-hidden': 'true',
        style: { flex: '0 0 auto' },
      }, [
        h('path', {
          key: 'a',
          d: 'M2 4.5A2.5 2.5 0 0 1 4.5 2h7A2.5 2.5 0 0 1 14 4.5v3A2.5 2.5 0 0 1 11.5 10H6l-2.6 2.1A.6.6 0 0 1 2.4 11.6V9.9',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
        }),
      ])
    }

    /**
     * The filled occupancy ring.
     * @param props - `percent` in 0..100, or undefined for no sample.
     * @returns a 16px SVG.
     */
    function Ring({ percent }) {
      const value = percent === undefined ? 0 : Math.max(0, Math.min(100, percent))
      const hot = value >= 90
      const stroke = hot ? 'var(--dsw-alias-state-error-primary, #e5484d)' : 'var(--cu-ring, #4d8df5)'
      return h('svg', {
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        'aria-hidden': 'true',
        style: { flex: '0 0 auto' },
      }, [
        h('circle', {
          key: 'track',
          cx: 8,
          cy: 8,
          r: RING_RADIUS,
          fill: 'none',
          stroke: 'var(--cu-track)',
          strokeWidth: 2,
        }),
        value > 0 ? h('circle', {
          key: 'value',
          cx: 8,
          cy: 8,
          r: RING_RADIUS,
          fill: 'none',
          stroke,
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeDasharray: `${(value / 100) * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`,
          transform: 'rotate(-90 8 8)',
        }) : null,
      ])
    }

    /**
     * One legend chip.
     * @param props - label, fill and ink variables, formatted value.
     * @returns the chip.
     */
    /** Compact line icons for the legend, one shape per bucket, drawn in the
     *  bucket's own colour so the chips read like the shipped panel's did. */
    const GLYPHS = {
      system: [
        ['rect', { x: 2.6, y: 2.6, width: 10.8, height: 10.8, rx: 2.2 }],
        ['path', { d: 'M5.4 6.2h5.2' }],
        ['path', { d: 'M5.4 9.4h3.2' }],
      ],
      tools: [
        ['path', { d: 'M2.6 5.2h10.8' }],
        ['path', { d: 'M2.6 10.8h10.8' }],
        ['circle', { cx: 6.2, cy: 5.2, r: 1.7, fill: 'currentColor', stroke: 'none' }],
        ['circle', { cx: 10.2, cy: 10.8, r: 1.7, fill: 'currentColor', stroke: 'none' }],
      ],
      tool: [
        ['rect', { x: 2.6, y: 3.4, width: 10.8, height: 9.2, rx: 2 }],
        ['path', { d: 'M5.4 6.1l1.95 1.85-1.95 1.85' }],
        ['path', { d: 'M9.2 10h2.2' }],
      ],
      messages: [
        ['rect', { x: 2.6, y: 3.4, width: 10.8, height: 7.6, rx: 2 }],
        ['path', { d: 'M5.6 11v2.4l2.8-2.4' }],
      ],
      free: [
        ['rect', { x: 2.6, y: 2.6, width: 10.8, height: 10.8, rx: 2.2, strokeDasharray: '2 2' }],
      ],
    }

    function BucketGlyph({ kind, color }) {
      const shapes = GLYPHS[kind] === undefined ? GLYPHS.system : GLYPHS[kind]
      return h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        style: { flex: '0 0 auto', color },
      }, shapes.map(([tag, attrs], index) => h(tag, Object.assign({ key: index }, attrs))))
    }

    function Chip(props) {
      const { kind, label, color, value, title, content, hovered, onEnter, onLeave, hint } = props
      const revealable = content !== undefined && content !== ''
      return h('span', {
        style: Object.assign({}, S.chip, revealable ? S.legendHoverable : null, hovered ? S.legendHovered : null),
        title: revealable ? hint : title,
        onMouseEnter: onEnter,
        onMouseLeave: onLeave,
        'data-context-usage': 'legend-cell',
      }, [
        h(BucketGlyph, { key: 'glyph', kind, color }),
        h('span', { key: 'label', style: S.chipLabel }, label),
        h('span', { key: 'value', style: S.chipValue }, value),
      ])
    }

    /* ---------------------------------------------------------------------- */
    /* Blocks                                                                 */
    /* ---------------------------------------------------------------------- */

    /**
     * The single-band occupancy bar.
     *
     * Each band is painted in its light fill and opens with a short gradient
     * from the band to its left, so neighbours melt instead of abutting. What
     * this turn added is painted in the band's ink at the band's right edge —
     * inside the band, never as a separate segment — with a soft left edge so
     * the reading stays "this block grew", not "here is another block".
     *
     * @param props - the model.
     * @returns the bar.
     */
    function OccupancyBar({ model, t }) {
      const widthOf = (value) => `${Math.max(0, Math.min(100, (value / model.capacity) * 100))}%`
      const painted = model.painted
      const bands = painted.map((bucket) => {
        const percent = share(bucket.value, model.capacity)
        const label = `${t(bucket.label)} ${formatTokens(bucket.value)}${percent === undefined ? '' : ` · ${percentText(percent)}`}`
        return h('div', {
          key: bucket.key,
          style: Object.assign({}, S.segment, {
            width: widthOf(bucket.value),
            background: `var(--cu-${bucket.key})`,
          }),
          title: label,
          'data-bucket': bucket.key,
        })
      })
      return h('div', {
        style: S.bar,
        role: 'img',
        'aria-label': painted.map((bucket) => `${t(bucket.label)} ${formatTokens(bucket.value)}`).join(', '),
      }, h('div', { key: 'layer', style: S.barLayer }, bands))
    }


    /**
     * The token ledger: uncached, cached, hit rate, output.
     * @param props - the `tokenUsage` projection value.
     * @returns the ledger spans, separated by dots.
     */
    function Ledger({ usage, t }) {
      if (usage === undefined) return null
      const hit = share(usage.cacheReadTokens, (usage.cacheReadTokens || 0) + (usage.uncachedInputTokens || 0))
      const cells = [
        ['miss', formatTokens(usage.uncachedInputTokens)],
        ['hit', formatTokens(usage.cacheReadTokens)],
        ['output', formatTokens(usage.outputTokens)],
        ['hitRate', hit === undefined ? '—' : percentText(hit)],
      ]
      const children = []
      cells.forEach((cell, index) => {
        if (index > 0) children.push(h('span', { key: `sep${index}`, style: S.muted }, '·'))
        children.push(h('span', { key: cell[0] }, [
          h('span', { key: 'label', style: S.statLabel }, t(cell[0])),
          h('span', { key: 'value', style: S.statValue }, cell[1]),
        ]))
      })
      return children
    }

    /**
     * The card body.
     * @param props - locale, the three projection values and session stats.
     * @returns the bands.
     */
    function bodyChildren(props) {
      const {
        t, pressure, detail, breakdown, usage, session,
        hoveredLegend, onLegendHover, onLegendEnter, onLegendLeave, onLegendClose, onLegendPin, contentOf,
      } = props
      const model = usageModel(pressure, detail, breakdown)

      if (model === undefined) {
        return [h('div', { key: 'empty', style: S.head }, [
          h('span', { key: 'figure', style: S.figure }, '— / —'),
          h('span', { key: 'hint', style: S.muted }, t('noSample')),
        ])]
      }

      const pace = []
      if (session !== undefined) {
        if (session.turns > 0) pace.push(`${session.turns} ${t('turns')}`)
        if (session.steps > 0) pace.push(`${session.steps} ${t('steps')}`)
        if (session.decodeMs > 0 && session.decodeTokens > 0) {
          pace.push(`${Math.round(session.decodeTokens / (session.decodeMs / 1000))} ${t('tps')}`)
        }
      }

      const head = h('div', { key: 'head', style: S.head }, [
        h('span', { key: 'figure', style: S.figure }, `${formatTokens(model.used)} / ${formatTokens(model.capacity)}`),
        model.deltaTotal > 0
          ? h('span', {
            key: 'turn',
            style: S.turnBadge,
            title: `${t('turnNew')} ${formatTokens(model.deltaTotal)} · ${t('estimated')}`,
          }, `${t('turnNew')} +${formatTokens(model.deltaTotal)}${share(model.deltaTotal, model.capacity) === undefined ? '' : ` (${percentText(share(model.deltaTotal, model.capacity))})`}`)
          : null,
        h('span', { key: 'spacer', style: S.spacer }),
        h('span', { key: 'ledger', style: S.stats }, Ledger({ usage, t })),
      ])

      /* Legend chips double as hover rows: a bucket whose model-visible content
       * is available highlights and reveals it through the detached pane below. */
      const content = contentOf || {}
      const chips = model.buckets
        .filter((bucket) => bucket.value > 0)
        .map((bucket) => {
          const bucketContent = content[bucket.key]
          const revealable = bucketContent !== undefined && bucketContent !== ''
          return h(Chip, {
            key: bucket.key,
            kind: bucket.key,
            label: t(bucket.label),
            color: `var(--cu-${bucket.key})`,
            value: formatTokens(bucket.value),
            title: `${t(bucket.label)} ${formatTokens(bucket.value)}${bucket.sources.length > 1 ? ` (${bucket.sources.map((key) => t(key)).join(' + ')})` : ''} · ${t('estimated')} ${formatTokens(bucket.raw)}`,
            content: bucketContent,
            hovered: hoveredLegend === bucket.key,
            onEnter: revealable ? () => onLegendHover(bucket.key, true) : undefined,
            onLeave: revealable ? () => onLegendHover(bucket.key, false) : undefined,
            hint: t('tipExpandHint'),
          })
        })
      chips.push(h(Chip, {
        key: 'free',
        kind: 'free',
        label: t('free'),
        color: 'rgba(127, 127, 127, 0.55)',
        value: formatTokens(model.free),
        title: `${t('free')} ${formatTokens(model.free)} · ${percentText(share(model.free, model.capacity))}`,
      }))
      chips.push(h('span', { key: 'spacer', style: S.spacer }))
      if (pace.length > 0) chips.push(h('span', { key: 'pace', style: S.pace }, pace.join(' · ')))

      /* The hovered legend's detail pane hangs beside the legend row (the row
       * is its own position anchor), so revealing content never reflows the
       * card's bands; maximized, it portals to the document body instead. */
      const pane = h(DetailPane, {
        key: 'pane',
        marker: 'panel-pane',
        title: hoveredLegend === null || hoveredLegend === undefined ? '' : t((model.buckets.find((bucket) => bucket.key === hoveredLegend) || model.buckets[0]).label),
        content: hoveredLegend === null || hoveredLegend === undefined ? undefined : content[hoveredLegend],
        onEnter: onLegendEnter,
        onLeave: onLegendLeave,
        onClose: onLegendClose,
        onPin: onLegendPin,
      })

      return [
        head,
        h(OccupancyBar, { key: 'bar', model, t }),
        h('div', { key: 'legend', style: S.legend }, chips.concat([pane])),
      ]
    }


    /**
     * Split one message's markdown into block-level runs the transcript renders
     * as text, headings, lists, quotes and fenced code — the subset a coding
     * agent's messages actually use. Line-based and allocation-light, so a
     * 9000-character tool result parses once and stays memoized.
     * @param text - the message text.
     * @returns block nodes: `p`, `h`, `li`, `ol`, `quote`, `code`.
     */
    function parseMarkdownBlocks(text) {
      const lines = String(text).split('\n')
      const nodes = []
      let paragraph = []
      const flush = () => {
        if (paragraph.length > 0) {
          nodes.push({ type: 'p', text: paragraph.join(' ') })
          paragraph = []
        }
      }
      let index = 0
      while (index < lines.length) {
        const line = lines[index]
        const fence = line.match(/^\s*```([\w+-]*)\s*$/)
        if (fence !== null) {
          flush()
          const language = fence[1]
          const buffer = []
          index += 1
          while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
            buffer.push(lines[index])
            index += 1
          }
          index += 1
          nodes.push({ type: 'code', language, text: buffer.join('\n') })
          continue
        }
        const heading = line.match(/^(#{1,4})\s+(.*)$/)
        if (heading !== null) {
          flush()
          nodes.push({ type: 'h', level: heading[1].length, text: heading[2] })
          index += 1
          continue
        }
        const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/)
        if (bullet !== null) {
          flush()
          nodes.push({ type: 'li', depth: Math.min(3, Math.floor(bullet[1].length / 2)), text: bullet[2] })
          index += 1
          continue
        }
        const ordered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/)
        if (ordered !== null) {
          flush()
          nodes.push({ type: 'ol', depth: Math.min(3, Math.floor(ordered[1].length / 2)), marker: `${ordered[2]}.`, text: ordered[3] })
          index += 1
          continue
        }
        const quote = line.match(/^\s*>\s?(.*)$/)
        if (quote !== null) {
          flush()
          nodes.push({ type: 'quote', text: quote[1] })
          index += 1
          continue
        }
        if (line.trim() === '') {
          flush()
          index += 1
          continue
        }
        paragraph.push(line.trim())
        index += 1
      }
      flush()
      return nodes
    }

    /**
     * Render inline markdown: `code`, **bold**, and [text](url) — the three the
     * transcript needs to stay readable without a parser dependency.
     * @param text - one block's inline text.
     * @param keyPrefix - stable React key prefix.
     * @returns the inline runs.
     */
    function renderInline(text, keyPrefix) {
      const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]*\))/g
      const out = []
      let cursor = 0
      let match = pattern.exec(text)
      let key = 0
      while (match !== null) {
        if (match.index > cursor) out.push(text.slice(cursor, match.index))
        const token = match[0]
        if (token.charAt(0) === '`') {
          out.push(h('code', { key: `${keyPrefix}-c${key}`, style: S.mdCode }, token.slice(1, -1)))
        } else if (token.startsWith('**')) {
          out.push(h('strong', { key: `${keyPrefix}-b${key}`, style: S.mdStrong }, token.slice(2, -2)))
        } else {
          const label = token.slice(1, token.indexOf(']('))
          out.push(h('span', { key: `${keyPrefix}-a${key}`, style: S.mdLink, title: token.slice(token.indexOf('](') + 2, -1) }, label))
        }
        cursor = match.index + token.length
        key += 1
        match = pattern.exec(text)
      }
      if (cursor < text.length) out.push(text.slice(cursor))
      return out
    }

    /**
     * One message body rendered as light markdown: prose in the UI font, code in
     * a monospace run, headings and lists carrying their own weight, so a long
     * agent transcript reads like a document instead of a grey text wall.
     * @param props - the message text.
     * @returns the rendered blocks.
     */
    function MessageBody(props) {
      const nodes = React.useMemo(() => parseMarkdownBlocks(props.text), [props.text])
      return h('div', { key: 'md', style: S.mdBody }, nodes.map((node, index) => {
        const key = `n${index}`
        if (node.type === 'code') {
          return h('pre', { key, style: S.mdPre }, h('code', { style: S.mdPreCode }, node.text))
        }
        if (node.type === 'h') {
          const level = node.level <= 1 ? S.mdH1 : node.level === 2 ? S.mdH2 : S.mdH3
          return h('div', { key, style: Object.assign({}, S.mdHeading, level) }, renderInline(node.text, key))
        }
        if (node.type === 'li') {
          return h('div', { key, style: Object.assign({}, S.mdItem, { paddingLeft: node.depth * 14 }) }, [
            h('span', { key: 'm', style: S.mdBullet }, '•'),
            h('span', { key: 't', style: S.mdItemText }, renderInline(node.text, key)),
          ])
        }
        if (node.type === 'ol') {
          return h('div', { key, style: Object.assign({}, S.mdItem, { paddingLeft: node.depth * 14 }) }, [
            h('span', { key: 'm', style: S.mdBullet }, node.marker),
            h('span', { key: 't', style: S.mdItemText }, renderInline(node.text, key)),
          ])
        }
        if (node.type === 'quote') {
          return h('div', { key, style: S.mdQuote }, renderInline(node.text, key))
        }
        return h('p', { key, style: S.mdParagraph }, renderInline(node.text, key))
      }))
    }

    /**
     * One message of the transcript: a role-tinted rail, a sticky header carrying
     * the role tag and the message's own cost, and its markdown body.
     * @param props - role tag, tint, label, char count, text, active state.
     * @returns the message card.
     */
    function MessageBlock(props) {
      return h('div', {
        style: Object.assign({}, S.paneBlock,
          { borderLeftColor: props.color },
          props.active === true ? S.paneBlockActive : null),
        'data-context-usage': 'pane-block',
        'data-block': props.index,
      }, [
        h('div', { key: 'head', style: S.paneBlockHead }, [
          h('span', { key: 'role', style: Object.assign({}, S.paneBlockRole, { color: props.color }) },
            props.label !== undefined ? `${props.tag} · ${props.label}` : props.tag),
          h('span', { key: 'chars', style: S.paneBlockChars }, `${props.chars} chars ≈ ${formatTokens(props.chars / 4)}`),
        ]),
        h(MessageBody, { key: 'body', text: props.text }),
      ])
    }

    /**
     * One entry of the maximized pane's outline rail, in the shape Cherry
     * Studio's message outline uses: a short rounded bar whose width carries the
     * entry's role weight, and — while the rail is expanded — the entry's own
     * caption beside it. Expansion, bar emphasis and text color are pure CSS
     * (`:hover` on the rail card), so the labels appear the instant the pointer
     * reaches the rail and the 950-row rail never re-renders for a hover.
     * @param props - block index, caption and meta text, role color and bar
     * width, the active state, and the jump handler.
     * @returns the outline row.
     */
    /**
     * One mark of the maximized pane's turn-style rail, after the shipped chat
     * rail (`TurnNavigator`): a fixed 10px pitch button whose `:before` bar grows
     * and brightens on hover, with no layout change and no per-row state. The
     * caption is not rendered here at all — one shared preview card follows the
     * pointer instead, so a 1000-mark rail never re-renders for a hover.
     * @param props - block index, its caption (for the accessible name), the
     * active state, and the jump handler.
     * @returns the rail mark.
     */
    function OutlineRow(props) {
      return h('button', {
        type: 'button',
        className: 'dsh-cu-mark',
        style: { top: props.index * RAIL_PITCH_PX },
        'data-context-usage': 'pane-dot', 'data-dot': props.index,
        'data-active': props.active ? 'true' : undefined,
        'aria-label': props.caption,
        'aria-current': props.active ? 'true' : undefined,
        onClick: () => props.onJump(props.index),
      })
    }


    /**
     * The detached detail pane beside the tooltip or the panel card: a plain
     * `pre` for string content, or one {@link MessageBlock} per entry for the
     * conversation transcript, so each message's share of `messageTokens` is
     * visible in place.
     *
     * The pointer can travel from the row into the pane: the wrapper's
     * transparent padding bridges the gap and the pane reports its own
     * enter/leave so the caller's delayed close cancels while content is read.
     * The maximize control re-anchors the same content as a centered overlay;
     * clicking outside the card closes the pane in either arrangement.
     * @param props - marker attribute value, content (string or blocks), title,
     * the caller's enter/leave handlers, and its close handler.
     * @returns the pane element, or null without content.
     */
    function DetailPane(props) {
      const [maximized, setMaximized] = React.useState(false)
      const [activeIndex, setActiveIndex] = React.useState(null)
      const [previewIndex, setPreviewIndex] = React.useState(null)
      const [modalSize, setModalSize] = React.useState(null)
      const [resizing, setResizing] = React.useState(false)
      const railScrollerRef = React.useRef(undefined)
      const cardRef = React.useRef(undefined)
      const bodyRef = React.useRef(undefined)
      const content = props.content
      /* Jump to one block of the transcript and mark it: the rail's click
       * scrolls the maximized body and tints the landed block. */
      const jumpTo = (index) => {
        setActiveIndex(index)
        const container = bodyRef.current
        if (container === undefined || container === null) return
        const target = container.querySelector(`[data-block="${index}"]`)
        if (target === null) return
        const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top
        container.scrollTop = Math.max(0, container.scrollTop + offset - 8)
      }
      /* Drag the card's bottom-right grip to size it: the modal is centered by
       * its overlay, so both edges follow the pointer symmetrically. */
      const startResize = (event) => {
        const card = cardRef.current
        if (card === undefined || card === null) return
        event.preventDefault()
        event.stopPropagation()
        const rect = card.getBoundingClientRect()
        const origin = { x: event.clientX, y: event.clientY, w: rect.width, h: rect.height }
        setResizing(true)
        const onMove = (moveEvent) => {
          const width = Math.max(360, Math.min(window.innerWidth - 24, origin.w + (moveEvent.clientX - origin.x) * 2))
          const height = Math.max(220, Math.min(window.innerHeight - 24, origin.h + (moveEvent.clientY - origin.y) * 2))
          setModalSize({ width, height })
        }
        const onUp = () => {
          setResizing(false)
          window.removeEventListener('pointermove', onMove, true)
          window.removeEventListener('pointerup', onUp, true)
        }
        window.addEventListener('pointermove', onMove, true)
        window.addEventListener('pointerup', onUp, true)
      }
      /* Double-clicking the grip returns the card to its default size. */
      const resetSize = () => setModalSize(null)
      /* Maximizing pins the pane: the caller keeps it open and stops scheduling
       * its own close, so the overlay survives the pointer leaving the row. */
      const setMax = (value) => {
        setMaximized(value)
        if (props.onPin !== undefined) props.onPin(value)
      }
      /* Clicking outside the card (and outside any owning row) closes the pane;
       * Escape does the same while maximized. */
      React.useEffect(() => {
        if (content === undefined) return
        const onPointerDown = (event) => {
          const card = cardRef.current
          if (card !== undefined && card !== null && card.contains(event.target)) return
          if (event.target instanceof Element && event.target.closest('[data-context-usage="tip-section"], [data-context-usage="legend-cell"]') !== null) return
          if (props.onClose !== undefined) props.onClose()
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape' && props.onClose !== undefined) props.onClose()
        }
        document.addEventListener('mousedown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('mousedown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
        }
      }, [content === undefined, props.onClose])
      /* A closed pane never reopens maximized. */
      React.useEffect(() => {
        if (content === undefined && maximized) setMax(false)
      }, [content === undefined, maximized])
      if (content === undefined) return null
      const isBlocks = Array.isArray(content)
      const body = isBlocks
        ? content.map((block, index) => h(MessageBlock, {
            key: index, index,
            tag: block.tag, color: block.color, chars: block.chars, text: block.text, label: block.label,
            active: activeIndex === index,
          }))
        : content
      const bar = h('div', { key: 'bar', style: S.paneBar }, [
        h('span', { key: 'title', style: S.paneBarTitle }, props.title === undefined ? '' : props.title),
        h('button', {
          key: 'max', type: 'button', style: S.paneButton,
          title: maximized ? '还原' : '最大化',
          'aria-label': maximized ? '还原' : '最大化',
          'data-context-usage': 'pane-maximize',
          onClick: () => setMax(!maximized),
        }, maximized ? '⤡' : '⤢'),
        h('button', {
          key: 'close', type: 'button', style: S.paneButton,
          title: '关闭', 'aria-label': '关闭',
          'data-context-usage': 'pane-close',
          onClick: () => { if (props.onClose !== undefined) props.onClose() },
        }, '✕'),
      ])
      if (maximized) {
        /* The transcript's rail, after the shipped chat turn navigator: a fixed
         * 10px pitch column of marks that scrolls inside its frame, with one
         * preview card following the pointer. Nothing expands, so the rail never
         * shifts under the hand. */
        const rail = isBlocks
          ? h('div', {
              key: 'rail', className: 'dsh-cu-rail', style: S.outlineRail,
              'data-context-usage': 'pane-rail',
              onPointerMove: (event) => {
                const scroller = railScrollerRef.current
                if (scroller === undefined || scroller === null) return
                const top = scroller.getBoundingClientRect().top + scroller.scrollTop
                const index = Math.floor((event.clientY - top) / RAIL_PITCH_PX)
                setPreviewIndex(index >= 0 && index < content.length ? index : null)
              },
              onPointerLeave: () => setPreviewIndex(null),
            }, [
              h('div', {
                key: 'scroller', className: 'dsh-cu-rail-scroller', ref: railScrollerRef,
                'data-context-usage': 'pane-rail-scroller',
              }, h('div', {
                key: 'marks', className: 'dsh-cu-rail-marks',
                style: { height: content.length * RAIL_PITCH_PX },
              }, content.map((block, index) => h(OutlineRow, {
                key: index, index,
                caption: block.label !== undefined ? `${block.tag} · ${block.label}` : block.tag,
                active: activeIndex === index,
                onJump: jumpTo,
              })))),
              previewIndex !== null && content[previewIndex] !== undefined
                ? h('div', {
                    key: 'preview', className: 'dsh-cu-preview',
                    'data-context-usage': 'pane-preview',
                    style: {
                      top: Math.max(0, Math.min(
                        previewIndex * RAIL_PITCH_PX - 12,
                        Math.max(0, (railScrollerRef.current === null || railScrollerRef.current === undefined
                          ? 0
                          : railScrollerRef.current.clientHeight) - 88),
                      )),
                    },
                  }, (() => {
                    const block = content[previewIndex]
                    return [
                      h('div', { key: 'prompt', className: 'dsh-cu-preview-prompt' }, [
                        h('span', {
                          key: 'tag', className: 'dsh-cu-preview-tag',
                          style: {
                            color: block.color,
                            background: `color-mix(in srgb, ${block.color} 14%, transparent)`,
                          },
                        }, block.tag),
                        h('span', { key: 'text', className: 'dsh-cu-preview-text' },
                          block.label !== undefined ? block.label : block.tag),
                      ]),
                      h('div', { key: 'meta', className: 'dsh-cu-preview-meta' },
                        `${block.chars} chars ≈ ${formatTokens(block.chars / 4)} tok`),
                    ]
                  })())
                : null,
            ])
          : null
        const overlay = h('div', {
          key: 'overlay', style: S.paneOverlay, 'data-context-usage': props.marker,
          onMouseDown: (event) => { if (event.target === event.currentTarget && props.onClose !== undefined) props.onClose() },
        }, h('div', {
          ref: cardRef,
          style: Object.assign({}, S.paneModal, isBlocks ? S.paneModalWithRail : null, modalSize),
          onMouseEnter: props.onEnter, onMouseLeave: props.onLeave,
          'data-context-usage': 'pane-modal', role: 'dialog', 'aria-modal': true,
        }, [
          bar,
          h('div', { key: 'body', ref: bodyRef, style: S.paneModalBody }, body),
          rail,
          /* The resize grip: drag to size the card, double-click to reset. */
          h('div', {
            key: 'grip', className: 'dsh-cu-resize',
            style: Object.assign({}, S.paneResizeGrip, resizing ? S.paneResizeGripActive : null),
            'data-context-usage': 'pane-resize', title: '拖动调整大小，双击恢复默认',
            onPointerDown: startResize, onDoubleClick: resetSize,
          }, h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': true }, [
            h('path', { key: 'a', d: 'M15 6L6 15', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', fill: 'none' }),
            h('path', { key: 'b', d: 'M15 11L11 15', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', fill: 'none' }),
          ])),
        ]))
        return ReactDOM !== undefined && typeof ReactDOM.createPortal === 'function'
          ? ReactDOM.createPortal(overlay, document.body)
          : overlay
      }
      return h('div', {
        key: 'wrap', style: S.tipPane, 'data-context-usage': props.marker,
        onMouseEnter: props.onEnter, onMouseLeave: props.onLeave,
      }, h('div', { ref: cardRef, style: S.paneCard, 'data-context-usage': 'pane-card' }, [bar, body]))
    }

    /**
     * Extract the session's complete model-visible conversation content from
     * one event window, in surface order: human prompts, injected user-role
     * context, assistant replies, and tool results — the same corpus the
     * `messageTokens` figure prices. Each block carries its own character
     * count so the content visibly accounts for the token figures beside it.
     * @param window - the session's event-window snapshot, absent when unbound.
     * @returns pane blocks (tag, tint, chars, text), or undefined with no window.
     */
    function conversationBlocksOf(window) {
      if (window === undefined) return undefined
      const blocks = []
      const push = (tag, color, text, label) => {
        const trimmed = typeof text === 'string' ? text.trim() : ''
        if (trimmed.length > 0) blocks.push({ tag, color, text: trimmed, chars: trimmed.length, label })
      }
      /* tool/call names by callId, so each tool result can name its tool. */
      const toolNamesById = new Map()
      for (const entry of window.entries) {
        const event = entry && entry.type === 'event' ? entry.event : undefined
        if (event === undefined || event.type !== 'tool/call') continue
        if (typeof event.data.callId === 'string' && typeof event.data.name === 'string') {
          toolNamesById.set(event.data.callId, event.data.name)
        }
      }
      for (const entry of window.entries) {
        const event = entry && entry.type === 'event' ? entry.event : undefined
        if (event === undefined) continue
        /* user/message events carry the message flatly (data.content/source);
         * the other surface events nest it under data.message. */
        const message = event.type === 'user/message'
          ? event.data
          : event.data && event.data.message
        const content = message && message.content
        if (!Array.isArray(content)) continue
        const text = content
          .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('')
        /* The log's own hierarchy: seq orders every event; turn/step place it. */
        const where = event.data && typeof event.data.turn === 'number'
          ? `T${event.data.turn}${typeof event.data.step === 'number' ? `.S${event.data.step}` : ''} #${event.seq}`
          : `#${event.seq}`
        if (event.type === 'user/message') {
          const injected = message.source && message.source.kind !== 'user'
          push(injected ? 'context' : 'user', injected ? ROLE_COLOR.context : ROLE_COLOR.user, text, where)
        } else if (event.type === 'assistant/message') {
          push('assistant', ROLE_COLOR.assistant, text, where)
        } else if (event.type === 'tool/result') {
          const failed = message.isError === true
          const toolName = typeof message.toolCallId === 'string' ? toolNamesById.get(message.toolCallId) : undefined
          const label = toolName !== undefined ? `${where} ${toolName}` : where
          push(failed ? 'tool ✕' : 'tool', failed ? ROLE_COLOR.toolFailed : ROLE_COLOR.tool, text, label)
        }
      }
      return blocks
    }

    /**
     * Extract the conversation's model-visible message content from one event
     * window: the most recent `user/message` and `assistant/message` texts in
     * surface order, each trimmed, newest turn last.
     * @param window - the session's event-window snapshot, absent when unbound.
     * @returns rendered transcript text, or undefined with no window.
     */
    function conversationTextOf(window) {
      if (window === undefined) return undefined
      const lines = []
      for (const entry of window.entries) {
        const event = entry && entry.type === 'event' ? entry.event : undefined
        if (event === undefined) continue
        if (event.type === 'user/message') {
          const content = event.data && event.data.message && event.data.message.content
          if (!Array.isArray(content)) continue
          const text = content
            .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text)
            .join('')
          if (text.trim().length > 0) lines.push(`[user] ${text.trim()}`)
        } else if (event.type === 'assistant/message') {
          const content = event.data && event.data.message && event.data.message.content
          if (!Array.isArray(content)) continue
          const text = content
            .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text)
            .join('')
          if (text.trim().length > 0) lines.push(`[assistant] ${text.trim()}`)
        }
      }
      return lines.length === 0 ? '' : lines.join('\n\n')
    }

    /**
     * One hover-highlighted content section of the hover tooltip: the row
     * highlights and shows a chevron while the pointer rests on it; the full
     * content renders in a detached pane to the right (see {@link S.tipPane}),
     * so revealing content never reflows the tooltip itself.
     * @param props - label, value text, hover state, enter/leave handlers, and
     * whether content is revealable.
     * @returns the section row.
     */
    function TipSection(props) {
      const revealable = props.revealable === true
      return h('div', {
        style: Object.assign({}, S.tipRow, revealable ? S.tipToggleRow : null),
        title: revealable ? props.title : undefined,
        onMouseEnter: props.onEnter,
        onMouseLeave: props.onLeave,
        'data-context-usage': 'tip-section',
      }, [
        h('span', { key: 'name', style: S.tipName }, [h(Glyph, { kind: props.kind, color: props.color }), props.label]),
        h('span', { key: 'value', style: S.tipValue }, props.value),
        revealable ? h('span', {
          key: 'chev', style: S.tipChevron,
        }, props.hovered ? '▾' : '▸') : null,
      ])
    }

    /**
     * Reveal state for one detail pane: which row owns it, and whether a close
     * is pending. Leaving a row does not close the pane at once — it schedules
     * the close half a second later, and entering the pane itself cancels that
     * timer, so the pointer can travel from the row into the pane and read it.
     * @returns the active row key, the close/enter handlers, and the controller.
     */
    function usePaneReveal() {
      const [rowKey, setRowKey] = React.useState(null)
      const [pinned, setPinned] = React.useState(false)
      const timer = React.useRef(undefined)
      const cancel = () => {
        if (timer.current !== undefined) {
          window.clearTimeout(timer.current)
          timer.current = undefined
        }
      }
      const reveal = (key) => {
        cancel()
        setRowKey(key)
      }
      const scheduleClose = () => {
        cancel()
        if (pinned) return
        timer.current = window.setTimeout(() => {
          timer.current = undefined
          setRowKey(null)
        }, 500)
      }
      const close = () => {
        cancel()
        setPinned(false)
        setRowKey(null)
      }
      React.useEffect(() => () => cancel(), [])
      return { rowKey, pinned, setPinned, reveal, scheduleClose, cancel, close }
    }

    /**
     * The hover tooltip the composer's occupancy button shows after a short
     * dwell: the composition legend (system / tools / messages / free) with the
     * system prompt and tool catalog expandable in place, mirroring the panel's
     * own numbers and the session's actual model-visible content.
     * @param props - locale seat, the projection values, the event window
     * derivations, and the dismiss handler.
     * @returns the floating card, positioned above the button.
     */
    function ContextTip(props) {
      const t = props.t
      const { pressure, detail, breakdown, systemText, toolNames, conversationBlocks } = props
      const model = usageModel(pressure, detail, breakdown)
      const reveal = usePaneReveal()
      const hoveredRow = reveal.rowKey
      const CONTENT_BY_KEY = {
        system: systemText === undefined || systemText === '' ? undefined : systemText,
        tools: toolNames === undefined || toolNames.length === 0 ? undefined : toolNames.join('\n'),
        messages: conversationBlocks === undefined || conversationBlocks.length === 0 ? undefined : conversationBlocks,
      }
      const rows = []
      for (const row of [
        { key: 'system', label: 'system' },
        { key: 'tools', label: 'tools' },
        { key: 'messages', label: 'messages' },
      ]) {
        const bucket = model === undefined ? undefined : model.buckets.find((entry) => entry.key === row.key)
        const content = CONTENT_BY_KEY[row.key]
        const revealable = content !== undefined && content !== ''
        rows.push(h(TipSection, {
          key: row.key,
          kind: row.key, label: t(row.label), color: `var(--cu-${row.key})`,
          value: bucket === undefined ? '—' : formatTokens(bucket.value),
          hovered: hoveredRow === row.key,
          revealable,
          onEnter: revealable ? () => reveal.reveal(row.key) : undefined,
          onLeave: revealable ? reveal.scheduleClose : undefined,
          title: t('tipExpandHint'),
        }))
      }
      if (model !== undefined) {
        rows.push(h('div', { key: 'free', style: S.tipRow }, [
          h('span', { key: 'name', style: S.tipName }, [h(Glyph, { kind: 'free', color: 'var(--cu-track)' }), t('tipFree')]),
          h('span', { key: 'value', style: S.tipValue }, formatTokens(model.free)),
          h('span', { key: 'percent', style: S.tipPercent },
            share(model.free, model.capacity) === undefined ? '' : percentText(share(model.free, model.capacity))),
        ]))
      }
      return h('div', { style: S.tip, onMouseEnter: () => { reveal.cancel(); if (props.onEnter !== undefined) props.onEnter() }, onMouseLeave: props.onLeave, 'data-context-usage': 'tip' }, [
        h('div', { key: 'head', style: S.tipHead }, [
          `${t('tipUsed')}  ${model === undefined ? '— / —' : `${formatTokens(model.used)} / ${formatTokens(model.capacity)}`}`,
          model === undefined || model.usedPercent === undefined ? '' : `  ${percentText(model.usedPercent)}`,
        ]),
        model === undefined ? h('div', { style: S.muted }, t('noSample')) : rows,
        /* The detached detail pane: anchored to the tooltip's right edge, laid
         * out beside it rather than inside it, so revealing content never
         * reflows the composition rows. */
        h(DetailPane, {
          key: 'pane',
          marker: 'tip-content',
          title: hoveredRow === null ? '' : t(hoveredRow),
          content: hoveredRow === null ? undefined : CONTENT_BY_KEY[hoveredRow],
          onEnter: reveal.cancel,
          onLeave: reveal.scheduleClose,
          onClose: reveal.close,
          onPin: (on) => {
            reveal.setPinned(on)
            if (props.onPin !== undefined) props.onPin(on)
          },
        }),
      ])
    }

    /**
     * The composer's occupancy button: a live percentage that opens and closes
     * this session's panel. It sits in `conversation.input.right`, the compact
     * control seat immediately before the submit action.
     * @param props - the composer row's standard session shares.
     * @returns the toggle button.
     */
    function ContextToggle(props) {
      const t = translator(props)
      const read = projectionReader(props)
      const sessionId = props ? props.sessionId : undefined
      const open = usePanelOpen(sessionId)
      const [hover, setHover] = useState(false)
      const [tipOpen, setTipOpen] = useState(false)
      const tipTimer = useRef(undefined)
      /** Whether the tooltip's detail pane is maximized (and so pinned open). */
      const pinnedRef = useRef(false)
      useEffect(() => () => {
        if (tipTimer.current !== undefined) window.clearTimeout(tipTimer.current)
      }, [])
      const enter = () => {
        setHover(true)
        if (tipTimer.current !== undefined) window.clearTimeout(tipTimer.current)
        tipTimer.current = window.setTimeout(() => setTipOpen(true), 350)
      }
      const leave = () => {
        setHover(false)
        if (tipTimer.current !== undefined) window.clearTimeout(tipTimer.current)
        /* A maximized pane owns the screen until it is closed; the tooltip must
         * not unmount underneath it. */
        if (pinnedRef.current) return
        tipTimer.current = window.setTimeout(() => setTipOpen(false), 150)
      }
      const cancelTipClose = () => {
        if (tipTimer.current !== undefined) window.clearTimeout(tipTimer.current)
      }
      const pressure = read('contextPressure')
      const detail = read('contextUsage')
      const breakdown = read('contextBreakdown')
      const sessions = props ? props.sessions : undefined
      const detailed = useDetailedContent(sessions, sessionId)
      const wrapStyle = Object.assign({}, S.toggle, { position: 'relative' })
      return h('div', { style: wrapStyle, 'data-context-usage': 'toggle-wrap' }, [
        h('button', {
          key: 'button', type: 'button',
          style: open || hover ? Object.assign({}, S.toggle, S.toggleActive) : S.toggle,
          title: t('title'),
          'aria-label': t('title'),
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'data-context-usage': 'toggle',
          onClick: () => { cancelTipClose(); setTipOpen(false); setPanelOpen(sessionId, !open) },
          onMouseEnter: enter,
          onMouseLeave: leave,
        }, [
          h(Ring, { key: 'ring', percent: share(
            pressure === undefined ? undefined : pressure.projectedTokens ?? pressure.pressureTokens,
            pressure === undefined ? undefined : pressure.contextWindow) }),
          pressure === undefined ? null : (() => {
            const used = pressure.projectedTokens ?? pressure.pressureTokens
            const percent = share(used, pressure.contextWindow)
            return percent === undefined ? null : h('span', { key: 'text' }, `${Math.round(percent)}%`)
          })(),
        ]),
        tipOpen && !open ? h(ContextTip, {
          key: 'tip', t, pressure, detail, breakdown,
          systemText: detailed.systemText, toolNames: detailed.toolNames,
          conversationBlocks: detailed.conversationBlocks,
          onEnter: cancelTipClose, onLeave: leave,
          onPin: (on) => { pinnedRef.current = on },
        }) : null,
      ])
    }

    /**
     * Seat a band inside the shipped composer card, right above its button row.
     *
     * The card only exposes `conversation.input.overlay` (a zero-height,
     * absolutely positioned anchor for popups) to third parties, so an in-flow
     * seat has to be a portal: an anchored entry reserves a `display:none`
     * marker in the composer stack, finds the neighbouring `[data-composer-card]`,
     * and inserts a `display:contents` host before the card's last child (the
     * `.row` that carries the permission chip and the submit button). Because the
     * host generates no box, the band itself becomes the card's flex child and
     * inherits its 12px column gap.
     * @param props - `open` plus the band children.
     * @returns the invisible marker and, while open, the portal.
     */
    function ComposerBandSeat(props) {
      const { open, children } = props
      const anchorRef = useRef(null)
      const [host, setHost] = useState(undefined)

      useEffect(() => {
        if (!open) return undefined
        const anchor = anchorRef.current
        let scopeNode
        let bandHost
        let observer

        const place = () => {
          if (!anchor || !anchor.isConnected) return
          let node = anchor.parentElement
          let card
          while (node !== null && node !== document.body) {
            card = node.querySelector('[data-composer-card]')
            if (card !== null && card !== undefined) break
            node = node.parentElement
          }
          if (card === null || card === undefined) return
          /* The control row carries the submit button; take the last direct child
           * that does, so a session without one still lands somewhere sane. */
          const children = Array.from(card.children).reverse()
          const row = children.find(child => child.querySelector('button') !== null) ?? card.lastElementChild
          if (row === null) return
          if (bandHost !== undefined && bandHost.parentElement === card && bandHost.nextElementSibling === row) return
          if (bandHost === undefined) {
            bandHost = document.createElement('div')
            bandHost.setAttribute('data-context-usage', 'band-host')
            bandHost.style.display = 'contents'
          }
          card.insertBefore(bandHost, row)
          setHost(bandHost)
          if (node !== scopeNode) {
            scopeNode = node
            if (observer !== undefined) observer.disconnect()
            observer = new MutationObserver(() => {
              place()
            })
            observer.observe(scopeNode, { childList: true })
          }
        }

        place()
        return () => {
          if (observer !== undefined) observer.disconnect()
          if (bandHost !== undefined) bandHost.remove()
        }
      }, [open])

      return h(React.Fragment, null,
        h('span', { key: 'anchor', ref: anchorRef, style: { display: 'none' } }),
        open && host !== undefined ? reactDom.createPortal(
          h('div', { style: S.panel }, children), host) : null)
    }

    /**
     * The occupancy panel the `/context` action and the composer button open.
     * @param props - the dock entry's standard session shares.
     * @returns the band inside the composer card, or null while it is closed.
     */
    function ContextUsagePanel(props) {
      const t = translator(props)
      const read = projectionReader(props)
      const sessionId = props ? props.sessionId : undefined
      const open = usePanelOpen(sessionId)
      const pressure = read('contextPressure')
      const detail = read('contextUsage')
      const breakdown = read('contextBreakdown')
      const usage = read('tokenUsage')
      const session = read('sessionStats')
      const sessions = props ? props.sessions : undefined
      const detailed = useDetailedContent(sessions, sessionId)
      const reveal = usePaneReveal()
      const hoverLegend = (key, on) => (on ? reveal.reveal(key) : reveal.scheduleClose())
      const contentOf = detailed === undefined ? {} : {
        system: detailed.systemText === undefined || detailed.systemText === '' ? undefined : detailed.systemText,
        tools: detailed.toolNames === undefined || detailed.toolNames.length === 0 ? undefined : detailed.toolNames.join('\n'),
        messages: detailed.conversationBlocks === undefined || detailed.conversationBlocks.length === 0 ? undefined : detailed.conversationBlocks,
      }
      return h(ComposerBandSeat, { open },
        h('div', { key: 'panel', style: S.panelCard, 'data-context-usage': 'panel' },
          bodyChildren({
            t, pressure, detail, breakdown, usage, session,
            hoveredLegend: reveal.rowKey,
            onLegendHover: hoverLegend,
            onLegendEnter: reveal.cancel,
            onLegendLeave: reveal.scheduleClose,
            onLegendClose: reveal.close,
            onLegendPin: reveal.setPinned,
            contentOf,
          })))
    }

    /**
     * A `context` command row logged by the earlier Host-command version of this
     * plugin, rendered with the same body.
     * @param props - the command-row owner share plus the standard session kit.
     * @returns the command card.
     */
    function ContextUsageCard(props) {
      const node = props && props.node
      const t = translator(props)
      const read = projectionReader(props)
      const pressure = read('contextPressure')
      const detail = read('contextUsage')
      const breakdown = read('contextBreakdown')
      const usage = read('tokenUsage')
      const session = read('sessionStats')
      const outcome = node ? node.outcome : null
      const head = h('div', { key: 'head', style: S.head }, [
        h(Ring, { key: 'ring', percent: undefined }),
        h('span', { key: 'title', style: S.title }, t('title')),
      ])
      if (outcome === null || outcome === undefined) {
        return h('div', { style: S.card }, head, h('div', { style: S.muted }, t('running')))
      }
      if (outcome.kind === 'error') {
        return h('div', { style: S.card }, head,
          h('div', { style: S.error }, typeof outcome.text === 'string' && outcome.text.length > 0 ? outcome.text : t('failed')))
      }
      return h('div', { style: S.card, 'data-context-usage': 'card' },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 } },
          bodyChildren({ t, pressure, detail, breakdown, usage, session })))
    }

    /* ---------------------------------------------------------------------- */
    /* Plugin                                                                 */
    /* ---------------------------------------------------------------------- */

    /* Test hook: `scripts/check-client.mjs` renders the body headlessly, so the
     * bar widths and the rescaling can be checked without opening the panel. */
    if (globalThis.__CU_TEST__ === true) {
      globalThis.__CU_EXPORTS__ = { usageModel, bodyChildren, formatTokens, share }
    }

    return {
      inject: ['slots', 'locale', 'commandUi', 'sessions'],
      apply(ctx) {
        const tr = ctx.locale.bind(NS)
        const sessions = ctx.sessions
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'context-usage: dictionaries')

        /* The six-bucket palette, in both themes. Scoped to `:root` because the
         * composer toggle draws a ring too, and it lives outside the panel. */
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/dsh-context-usage'
          tag.dataset.pluginCss = PALETTE_STYLE_ID
          tag.textContent = PALETTE_CSS
          document.head.appendChild(tag)
          return () => {
            tag.remove()
          }
        }, 'context-usage: bucket palette')

        /* The maximized pane's outline rail, after Cherry Studio's message
         * outline: a column of short rounded bars that expands into a labeled
         * list on hover, with no timer and no React state per row. */
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/dsh-context-usage'
          tag.dataset.pluginCss = OUTLINE_STYLE_ID
          tag.textContent = `
/* Rail after the shipped chat turn navigator (TurnNavigator): fixed 10px pitch
   marks, hidden scrollbar, fade mask at the scrollable end, and one preview
   card that follows the pointer. Nothing here animates layout. */
.dsh-cu-rail-scroller{max-height:100%;overflow-y:auto;overscroll-behavior:contain;
  scrollbar-width:none;position:relative;mask-image:linear-gradient(#000 0 calc(100% - 24px),#0000 100%);
  -webkit-mask-image:linear-gradient(#000 0 calc(100% - 24px),#0000 100%)}
.dsh-cu-rail-scroller::-webkit-scrollbar{display:none}
.dsh-cu-rail-marks{position:relative}
.dsh-cu-mark{cursor:pointer;background:0 0;border:0;border-radius:8px;height:10px;padding:0;
  position:absolute;top:0;left:0;right:0}
.dsh-cu-mark:before{content:"";position:absolute;top:50%;right:0;width:20px;height:2px;border-radius:2px;
  background:var(--dsw-alias-border-l4);transform:translateY(-50%) scaleX(.6);transform-origin:100%;
  transition:transform .14s,background-color .14s}
.dsh-cu-mark:hover:before{background:var(--dsw-alias-label-tertiary);transform:translateY(-50%) scaleX(.9)}
.dsh-cu-mark[data-active="true"]:before{background:var(--dsw-alias-label-primary);transform:translateY(-50%) scaleX(1)}
.dsh-cu-mark:focus-visible{outline:none}
.dsh-cu-mark:focus-visible:before{background:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));
  transform:translateY(-50%) scaleX(1)}
/* The pointer's own preview: one card, to the left of the rail, following the
   hovered mark's vertical position, exactly like the chat rail's turn preview. */
.dsh-cu-preview{position:absolute;right:calc(100% + 10px);width:280px;max-height:120px;box-sizing:border-box;
  padding:10px 12px;border-radius:var(--dsw-radius-lg);color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-panel);
  pointer-events:none;overflow:hidden;transition:top .14s cubic-bezier(.2,.8,.2,1);
  animation:dsh-cu-preview-in .12s ease-out}
@keyframes dsh-cu-preview-in{from{opacity:0;transform:translate(4px)}to{opacity:1;transform:translate(0)}}
.dsh-cu-preview-prompt{display:flex;align-items:center;gap:6px;min-width:0;
  font-size:13px;font-weight:600;line-height:18px}
.dsh-cu-preview-tag{flex:none;padding:1px 6px;border-radius:999px;font-size:10px;font-weight:600;line-height:14px}
.dsh-cu-preview-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-cu-preview-meta{margin-top:6px;display:inline-block;padding:1px 8px;border-radius:999px;
  font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover-solid)}
`
          document.head.appendChild(tag)
          return () => {
            tag.remove()
          }
        }, 'context-usage: outline rail stylesheet')


        ctx.effect(() => ctx.commandUi.register({
          name: 'context',
          available: () => true,
          label: () => tr('title'),
          description: () => tr('commandDescription'),
          icon: ContextGlyph,
          ui: {
            kind: 'action',
            run: (session) => {
              setPanelOpen(session && session.sessionId, true)
            },
          },
        }), 'context-usage: /context contribution')

        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'context-usage',
          order: 5,
          locale: NS,
          inject: (sessionId) => ({ sessions }),
        }, ContextUsagePanel))

        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'context-usage-toggle',
          order: 0,
          locale: NS,
          inject: (sessionId) => ({ sessions }),
        }, ContextToggle))

        ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
          name: 'conversation.chat.commandview',
          key: 'context',
          locale: NS,
        }, ContextUsageCard))

        /**
         * The composer dock is hidden outright: this bundle carries the session
         * pace the shipped stats pills showed, and the panel above the composer
         * carries the occupancy the shipped ring meter showed. The invisible
         * anchor gives the override a scope of our own, so it can only ever
         * match the dock this bundle renders into.
         */
        if (HIDE_SHIPPED_DOCK) {
          ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
            name: 'conversation.composer.dock',
            id: 'context-usage-anchor',
            order: 1,
            locale: NS,
          }, () => h('span', {
            'data-context-usage': DOCK_MARKER,
            style: { display: 'none' },
          })))
          ctx.effect(() => {
            const tag = document.createElement('style')
            tag.dataset.plugin = '@local/dsh-context-usage'
            tag.dataset.pluginCss = DOCK_STYLE_ID
            tag.textContent = `[class$="_dock"]:has([data-context-usage="${DOCK_MARKER}"]){display:none !important}`
            document.head.appendChild(tag)
            return () => {
              tag.remove()
            }
          }, 'context-usage: hide the shipped composer dock')
        }

        /**
         * The account balance pill, contributed to the composer dock beside the
         * shipped usage pills. It registers in its own account scope (the scope
         * must inject `remote` itself to read a namespace off it), so a
         * composition without the account Remote keeps the command and panel and
         * simply contributes no pill.
         *
         * Polling is visibility-gated, so a hidden or minimized window keeps no
         * loop against the account API.
         */
        ctx.inject(['remote', 'remote.account'], (scope) => {
          function BalancePill() {
            const [state, setState] = useState({ kind: 'pending' })
            useEffect(() => {
              let active = true
              const settle = (next) => {
                if (active) setState(next)
              }
              const read = async () => {
                try {
                  const result = await scope.remote.account.getBalance({
                    version: CLIENT_VERSION,
                    locale: ctx.locale.getSnapshot().active,
                    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
                  })
                  if (!active) return
                  if (result === undefined || result === null || result.ok !== true) {
                    settle({ kind: 'error', detail: result && result.error ? String(result.error.code) : 'transport' })
                    return
                  }
                  const balance = result.value
                  if (balance === null || balance === undefined) {
                    settle({ kind: 'signedOut' })
                    return
                  }
                  if (balance.status !== 'ready') {
                    settle({ kind: 'failed', detail: typeof balance.reason === 'string' ? balance.reason : '' })
                    return
                  }
                  const normal = balance.value || []
                  const bonus = balance.bonusWallets || []
                  const preferred = normal.find((entry) => entry.currency === 'CNY')
                    || normal[0]
                    || bonus.find((entry) => entry.currency === 'CNY')
                    || bonus[0]
                  if (preferred === undefined) {
                    settle({ kind: 'empty' })
                    return
                  }
                  settle({ kind: 'ready', wallet: preferred, at: Date.now() })
                } catch (error) {
                  settle({ kind: 'error', detail: error && error.message ? String(error.message).slice(0, 60) : 'throw' })
                }
              }
              const tick = () => {
                if (document.visibilityState === 'visible') read()
              }
              read()
              const timer = window.setInterval(tick, BALANCE_REFRESH_MS)
              document.addEventListener('visibilitychange', tick)
              window.addEventListener('focus', tick)
              return () => {
                active = false
                window.clearInterval(timer)
                document.removeEventListener('visibilitychange', tick)
                window.removeEventListener('focus', tick)
              }
            }, [])
            if (state.kind === 'pending') return null
            if (state.kind === 'ready') {
              const at = new Date(state.at)
              return h('span', {
                style: S.balance,
                title: `${tr('balanceTitle')} · ${at.toLocaleTimeString()}`,
                'data-context-usage': 'balance',
              }, formatBalance(state.wallet.balance, state.wallet.currency === 'CNY' ? '¥' : '$'))
            }
            const key = state.kind === 'signedOut' ? 'balanceSignedOut'
              : state.kind === 'empty' ? 'balanceEmpty'
                : state.kind === 'failed' ? 'balanceFailed' : 'balanceError'
            return h('span', {
              style: S.balance, title: state.detail || tr('balanceTitle'), 'data-context-usage': 'balance',
            }, state.detail === undefined ? tr(key) : `${tr(key)}·${state.detail}`)
          }

          /* The dock that used to hold this pill is hidden, so it rides the
           * composer's own control row next to the occupancy button. */
          scope.slots.inject('conversation.input.right', () => scope.slots.register({
            name: 'conversation.input.right',
            id: 'context-usage-balance',
            order: 1,
            locale: NS,
          }, BalancePill))
        })

        ctx.effect(() => () => {
          closeAllPanels()
        }, 'context-usage: panel state')
      },
    }
  },
})
