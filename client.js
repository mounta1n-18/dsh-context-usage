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
    const reactDom = require('react-dom')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    /* ---------------------------------------------------------------------- */
    /* Constants                                                              */
    /* ---------------------------------------------------------------------- */

    const NS = 'context-usage'
    const CLIENT_VERSION = '0.2.0-rc.2'
    /* The Host caches each provider's answer for 10s, so a 1s poll costs one
     * request per provider per 10s; a switch of the Session's model re-reads
     * immediately because the effect depends on the provider. */
    const BALANCE_REFRESH_MS = 1000
    const BALANCE_ROUTE = '/__context-usage/balance'
    const HIDE_SHIPPED_DOCK = true
    const DOCK_MARKER = 'composer-dock-anchor'
    const DOCK_STYLE_ID = '@local/dsh-context-usage/dock-override.css'
    const PALETTE_STYLE_ID = '@local/dsh-context-usage/palette.css'

    const RING_RADIUS = 5.2
    const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

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
  --cu-system-mark: #7c3aed;
  --cu-tools-mark: #2563eb;
  --cu-tool-mark: #0891b2;
  --cu-messages-mark: #059669;
  --cu-free-mark: #8a919e;
  --cu-track: rgba(0, 0, 0, 0.07);
  --cu-turn: #047857;
  --cu-ring: #4d8df5;
}
body[data-ds-dark-theme] {
  --cu-system: #6d28d9;
  --cu-tools: #1d4ed8;
  --cu-tool: #0e7490;
  --cu-messages: #047857;
  /* The bar keeps its deep fills; the legend marks are strokes, so they need
   * the 400-level hue to stay legible on the dark card. */
  --cu-system-mark: #a78bfa;
  --cu-tools-mark: #60a5fa;
  --cu-tool-mark: #22d3ee;
  --cu-messages-mark: #34d399;
  --cu-free-mark: #c3c9d4;
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

    function Chip({ kind, label, color, value, title }) {
      return h('span', { style: S.chip, title }, [
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
      const { t, pressure, detail, breakdown, usage, session } = props
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

      const chips = model.buckets
        .filter((bucket) => bucket.value > 0)
        .map((bucket) => h(Chip, {
          key: bucket.key,
          kind: bucket.key,
          label: t(bucket.label),
          color: `var(--cu-${bucket.key}-mark)`,
          value: formatTokens(bucket.value),
          title: `${t(bucket.label)} ${formatTokens(bucket.value)}${bucket.sources.length > 1 ? ` (${bucket.sources.map((key) => t(key)).join(' + ')})` : ''} · ${t('estimated')} ${formatTokens(bucket.raw)}`,
        }))
      chips.push(h(Chip, {
        key: 'free',
        kind: 'free',
        label: t('free'),
        color: 'var(--cu-free-mark)',
        value: formatTokens(model.free),
        title: `${t('free')} ${formatTokens(model.free)} · ${percentText(share(model.free, model.capacity))}`,
      }))
      chips.push(h('span', { key: 'spacer', style: S.spacer }))
      if (pace.length > 0) chips.push(h('span', { key: 'pace', style: S.pace }, pace.join(' · ')))

      return [
        head,
        h(OccupancyBar, { key: 'bar', model, t }),
        h('div', { key: 'legend', style: S.legend }, chips),
      ]
    }

    /* ---------------------------------------------------------------------- */
    /* Slots                                                                  */
    /* ---------------------------------------------------------------------- */

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
      return h(ComposerBandSeat, { open },
        h('div', { key: 'panel', style: S.panelCard, 'data-context-usage': 'panel' },
          bodyChildren({ t, pressure, detail, breakdown, usage, session })))
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
      const pressure = read('contextPressure')
      const used = pressure === undefined ? undefined : pressure.projectedTokens ?? pressure.pressureTokens
      const percent = share(used, pressure === undefined ? undefined : pressure.contextWindow)
      return h('button', {
        type: 'button',
        style: open || hover ? Object.assign({}, S.toggle, S.toggleActive) : S.toggle,
        title: t('title'),
        'aria-label': t('title'),
        'aria-pressed': open,
        'data-context-usage': 'toggle',
        onClick: () => setPanelOpen(sessionId, !open),
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
      }, [
        h(Ring, { key: 'ring', percent }),
        percent === undefined ? null : h('span', { key: 'text' }, `${Math.round(percent)}%`),
      ])
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
      inject: ['slots', 'locale', 'commandUi'],
      apply(ctx) {
        const tr = ctx.locale.bind(NS)
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
        }, ContextUsagePanel))

        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'context-usage-toggle',
          order: 0,
          locale: NS,
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
          /**
           * One line of the pill: a currency symbol plus the amount, or a dash
           * with the reason in the tooltip. The Host owns the upstream call.
           */
          function balanceText(state) {
            if (state.kind === 'ready') {
              const symbol = state.currency === 'CNY' ? '¥' : '$'
              return formatBalance(state.amount, symbol)
            }
            if (state.kind === 'signedOut') return tr('balanceSignedOut')
            if (state.kind === 'empty') return tr('balanceEmpty')
            if (state.kind === 'noKey' || state.kind === 'unsupported') return '—'
            if (state.kind === 'pending') return '—'
            return tr('balanceFailed')
          }

          function balanceTooltip(state) {
            const name = state.name || tr('balanceTitle')
            if (state.kind === 'ready') {
              const at = new Date(state.at || Date.now())
              return `${name} ${balanceText(state)} · ${at.toLocaleTimeString()}`
            }
            return `${name} · ${state.detail || tr('balanceTitle')}`
          }

          function BalancePill(props) {
            const read = projectionReader(props)
            const selection = read('modelSelection')
            const chosen = selection !== undefined && selection !== null && selection.next !== undefined
              ? selection.next
              : undefined
            const provider = chosen !== undefined && chosen !== null && typeof chosen.provider === 'string' && chosen.provider.length > 0
              ? chosen.provider
              : 'deepseek'
            const model = chosen !== undefined && chosen !== null && typeof chosen.model === 'string' ? chosen.model : ''
            const [state, setState] = useState({ kind: 'pending' })

            useEffect(() => {
              let active = true
              const settle = (next) => {
                if (active) setState(next)
              }

              /* Fallback for compositions without the Web route: the account
               * Remote still answers for DeepSeek itself. */
              const readAccount = async () => {
                const result = await scope.remote.account.getBalance({
                  version: CLIENT_VERSION,
                  locale: ctx.locale.getSnapshot().active,
                  timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
                })
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
                const wallet = normal.find((entry) => entry.currency === 'CNY')
                  || normal[0]
                  || bonus.find((entry) => entry.currency === 'CNY')
                  || bonus[0]
                if (wallet === undefined) {
                  settle({ kind: 'empty' })
                  return
                }
                settle({
                  kind: 'ready',
                  amount: wallet.balance,
                  currency: wallet.currency,
                  name: 'DeepSeek',
                  at: Date.now(),
                })
              }

              const readBalance = async () => {
                const params = new URLSearchParams({
                  provider,
                  version: CLIENT_VERSION,
                  locale: ctx.locale.getSnapshot().active,
                  tz: String(-new Date().getTimezoneOffset() * 60),
                })
                if (model.length > 0) params.set('model', model)
                try {
                  const response = await fetch(`${BALANCE_ROUTE}?${params.toString()}`, {
                    headers: { accept: 'application/json' },
                  })
                  if (!response.ok) throw new Error(`HTTP ${response.status}`)
                  const body = await response.json()
                  if (!active) return
                  if (body === null || typeof body !== 'object') {
                    settle({ kind: 'error', detail: 'empty body' })
                    return
                  }
                  const kind = body.status === 'ready' ? 'ready'
                    : body.status === 'no-key' ? 'noKey'
                      : body.status === 'unsupported' ? 'unsupported'
                        : body.status === 'signed-out' ? 'signedOut'
                          : body.status === 'empty' ? 'empty' : 'failed'
                  settle({
                    kind,
                    amount: typeof body.amount === 'number' ? body.amount : undefined,
                    currency: typeof body.currency === 'string' ? body.currency : 'CNY',
                    name: typeof body.name === 'string' ? body.name : undefined,
                    detail: typeof body.detail === 'string' ? body.detail : '',
                    at: typeof body.at === 'number' ? body.at : Date.now(),
                    provider,
                  })
                } catch (error) {
                  if (!active) return
                  if (provider === 'deepseek' || provider.startsWith('deepseek')) {
                    try {
                      await readAccount()
                      return
                    } catch {
                      /* fall through to the route error */
                    }
                  }
                  settle({
                    kind: 'error',
                    detail: error && error.message ? String(error.message).slice(0, 60) : 'throw',
                    provider,
                  })
                }
              }

              readBalance()
              const tick = () => {
                if (document.visibilityState === 'visible') readBalance()
              }
              const timer = window.setInterval(tick, BALANCE_REFRESH_MS)
              document.addEventListener('visibilitychange', tick)
              window.addEventListener('focus', tick)
              return () => {
                active = false
                window.clearInterval(timer)
                document.removeEventListener('visibilitychange', tick)
                window.removeEventListener('focus', tick)
              }
            }, [provider, model])

            if (state.kind === 'pending') return null
            return h('span', {
              style: S.balance,
              title: balanceTooltip(state),
              'data-context-usage': 'balance',
            }, balanceText(state))
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
