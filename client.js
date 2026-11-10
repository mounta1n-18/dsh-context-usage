/**
 * Client half of the `@local/dsh-context-usage` bundle.
 *
 * Owns the whole feature:
 *
 * - registers `/context` as a Client command contribution, so the composer menu
 *   shows a localized title, a description, and a glyph exactly like a built-in
 *   command row (a Host command cannot carry those; see `index.js`);
 * - the contribution's action opens the occupancy panel instead of submitting a
 *   message, and writes nothing to the session log;
 * - renders that panel in `conversation.input.dock`, the shipped full-width
 *   composer dock, as one band that reflows when the chat column narrows;
 * - the composer's occupancy button in `conversation.input.right`, immediately
 *   before the submit action, toggles the same panel with a live percentage;
 * - the account balance pill rides `conversation.composer.dock` beside the
 *   shipped usage pills;
 * - keeps a `conversation.chat.commandview` renderer for `context` rows an
 *   earlier Host-command version of this plugin already logged.
 *
 * The module imports nothing but React and styles itself with host theme tokens
 * through inline styles.
 *
 * @module @local/dsh-context-usage/client
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

    /** Client locale namespace for this bundle's visible text. */
    const NS = 'context-usage'

    /**
     * The UI build identity this installation ships, carried as the requesting
     * client of an account call. A Client plugin cannot read the shell's own
     * build version at runtime; a stale value only costs this pill, which shows
     * its own reason whenever the balance outcome is not ready.
     */
    const CLIENT_VERSION = '0.2.0-rc.2'

    /** How often a visible page re-reads the balance. */
    const BALANCE_REFRESH_MS = 10000

    /**
     * Whether this bundle hides the shipped composer dock (the row under the
     * composer card) while it is mounted. That row carries the shipped occupancy
     * meter and the session stats pills; this bundle shows the occupancy in its
     * own panel and the turn/step/pace figures in the panel's overview, and the
     * shell exposes no switch for it (`ui-conversation`'s Config has no such
     * field, and occupying `conversation.input.activity` — which does suppress
     * the meter — also hides the model selector through `hidden: activity`).
     *
     * The override is an owned stylesheet scoped by our own marker inside that
     * dock, so it can only ever match the dock this bundle renders into.
     */
    const HIDE_SHIPPED_DOCK = false

    /** Marker attribute on this bundle's composer-dock anchor entry. */
    const DOCK_MARKER = 'composer-dock-anchor'

    /** This bundle's own stylesheet identity, cleaned up with the plugin. */
    const DOCK_STYLE_ID = '@local/dsh-context-usage/dock-override.css'

    /** This bundle's outline-rail stylesheet identity. */
    const OUTLINE_STYLE_ID = '@local/dsh-context-usage/outline.css'

    const zh = {
      title: '上下文用量',
      commandDescription: '查看当前会话的上下文用量与构成',
      running: '正在统计上下文用量…',
      failed: '上下文用量统计失败',
      system: '系统提示词',
      tools: '工具定义',
      messages: '对话消息',
      free: '剩余空间',
      noSample: '暂无用量样本',
      tipUsed: '已用 / 容量',
      tipFree: '剩余空间',
      tipExpandHint: '悬停查看完整内容',
      totals: '本会话累计',
      miss: '未命中',
      hit: '命中',
      hitRate: '命中率',
      output: '输出',
      turns: '轮',
      steps: '步',
      tps: 'tok/s',
      balanceTitle: 'DeepSeek 余额',
      balanceSignedOut: '余额 未登录',
      balanceEmpty: '余额 无钱包',
      balanceFailed: '余额 读取失败',
      balanceError: '余额 接口异常',
    }

    const en = {
      title: 'Context usage',
      commandDescription: "Show this session's context usage and composition",
      running: 'Measuring context usage…',
      failed: 'Context usage failed',
      system: 'System prompt',
      tools: 'Tools',
      messages: 'Messages',
      free: 'Free space',
      noSample: 'No usage sample',
      tipUsed: 'Used / capacity',
      tipFree: 'Free space',
      tipExpandHint: 'Hover to view full content',
      totals: 'Session totals',
      miss: 'Uncached',
      hit: 'Cached',
      hitRate: 'Hit rate',
      output: 'Output',
      turns: 'turns',
      steps: 'steps',
      tps: 'tok/s',
      balanceTitle: 'DeepSeek balance',
      balanceSignedOut: 'balance: signed out',
      balanceEmpty: 'balance: no wallet',
      balanceFailed: 'balance: read failed',
      balanceError: 'balance: call failed',
    }

    /** Composition rows and the free remainder, in display order. */
    const ROWS = [
      { key: 'systemTokens', label: 'system', kind: 'system', color: 'var(--dsw-alias-brand-primary)' },
      { key: 'toolsTokens', label: 'tools', kind: 'tools', color: 'var(--dsw-alias-state-warn-primary)' },
      { key: 'messageTokens', label: 'messages', kind: 'messages', color: 'var(--dsw-alias-state-success-primary)' },
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

    /** Unoccupied-cell tint. */
    const FREE_COLOR = 'var(--dsw-alias-state-idle-primary)'

    /** Occupancy grid geometry: a filled area, wrapped row by row. */
    const GRID_COLUMNS = 36
    const GRID_ROWS = 5
    const GRID_CELLS = GRID_COLUMNS * GRID_ROWS

    /** Fixed pitch between neighbouring outline marks, as the shipped chat rail uses. */
    const RAIL_PITCH_PX = 10

    /** Ring geometry: 16px viewBox, 5.2px radius. */
    const RADIUS = 5.2
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS

    const S = {
      /** The legacy command row's card: a chat-flow surface with its own width. */
      card: {
        display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 560, boxSizing: 'border-box',
        padding: '10px 12px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12,
        background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
        fontSize: 13, lineHeight: '20px',
      },
      /** Composer-dock wrapper: the shipped docks' geometry, aligned with the composer card. */
      panel: {
        boxSizing: 'border-box', flex: 'none',
        width: 'calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))',
        maxWidth: 'calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))',
        margin: '0 auto',
        padding: '0 var(--dsh-composer-dock-inset)',
      },
      /** The dock panel's surface: the same menu material the shipped docks use. */
      panelCard: {
        display: 'flex', flexDirection: 'column', gap: 6, boxSizing: 'border-box',
        padding: '8px 10px', borderRadius: 'var(--dsw-radius-lg)',
        background: 'var(--dsw-specific-menu)', backdropFilter: 'var(--dsw-menu-backdrop-filter)',
        boxShadow: 'var(--dsw-elevation-panel)', color: 'var(--dsw-alias-label-primary)',
        fontSize: 13, lineHeight: '20px',
      },
      head: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
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
      title: { fontWeight: 600, flex: 'none' },
      spacer: { flex: 'auto' },
      figure: { color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
      percent: { color: 'var(--dsw-alias-brand-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', flex: 'none' },
      grid: { display: 'grid', gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)`, gap: 2 },
      cell: { height: 5, borderRadius: 1, background: FREE_COLOR },
      /**
       * The widest arrangement: one band holding the overview, the occupancy
       * area and the legend, with the four gaps `space-evenly` leaves around and
       * between them equal to the four `1fr` slack columns this replaced.
       *
       * It wraps rather than shrinking without limit, because the grid this
       * replaced overlapped: a container narrower than the blocks' combined
       * minimum collapsed its `1fr` slack columns to zero while the `auto`
       * columns kept their content, so the occupancy area was pushed over the
       * legend the moment a side pane narrowed the chat column.
       */
      main: {
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-evenly',
      },
      /**
       * The overview stack — title, figures, pace — centered on one axis, so the
       * longest line (the pace) reads as the block's own width rather than
       * hanging past the lines above it.
       */
      headLeft: { flex: '0 1 auto', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' },
      headRow: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
      /** The turn/step/pace line the shipped composer dock no longer shows. */
      pace: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap' },
      /**
       * The occupancy area in the one-band arrangement: a preferred `30em` band
       * that may shrink — never grow, so `main`'s gaps stay even — down to the
       * width its own stats need.
       */
      viz: {
        flex: '0 1 30em', display: 'flex', flexDirection: 'column', gap: 8,
      },
      /** The same area once it holds a band of its own. */
      vizFull: { display: 'flex', flexDirection: 'column', gap: 8, width: '100%' },
      /**
       * A three-column legend grid: names, values, and shares align on content
       * width. It sizes to its content wherever it sits beside something, and
       * centers in the full-width seat the stacked arrangement gives it.
       */
      legendBox: {
        flex: '0 0 auto', display: 'grid', gridTemplateColumns: 'auto auto auto',
        gap: '3px 6px', alignItems: 'center', justifyContent: 'center',
      },
      /** The two narrower arrangements: a stack, and the pair it starts with. */
      stack: { display: 'flex', flexDirection: 'column', gap: 8 },
      pair: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-evenly' },
      legendName: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
      legendLabel: { color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' },
      legendValue: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'right' },
      legendPercent: { color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'right' },
      stats: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 14px' },
      statCell: { display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 },
      statLabel: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11, lineHeight: '16px', flex: 'none' },
      statValue: { fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
      muted: { color: 'var(--dsw-alias-label-secondary)' },
      error: { color: 'var(--dsw-alias-state-error-primary)' },
      toggle: {
        display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 8px',
        border: 'none', borderRadius: 999, background: 'transparent', cursor: 'pointer',
        color: 'var(--dsw-alias-label-secondary)', fontFamily: 'inherit', fontSize: 12,
        fontVariantNumeric: 'tabular-nums', lineHeight: 1,
      },
      toggleActive: { background: 'var(--dsw-alias-interactive-bg-hover-solid)', color: 'var(--dsw-alias-label-primary)' },
      balance: {
        display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--dsw-alias-label-secondary)',
        fontSize: 12, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      },
    }

    /**
     * Body widths, in CSS pixels, at which the arrangement changes.
     *
     * `WIDE_MIN` is what the one-band arrangement wants for its even gaps without
     * shrinking the occupancy area below its preferred `30em`; below it the
     * overview pairs with the legend and the occupancy area takes a band of its
     * own, and below `MEDIUM_MIN` — where even that pair no longer fits — all
     * three stack.
     */
    const WIDE_MIN = 720
    const MEDIUM_MIN = 440

    /**
     * Pick the body's arrangement for a measured width.
     * @param width - the body's content width, `0` before it is first measured.
     * @returns `wide`, `medium` or `narrow`.
     */
    function layoutFor(width) {
      if (!(width > 0)) return 'wide'
      if (width >= WIDE_MIN) return 'wide'
      if (width >= MEDIUM_MIN) return 'medium'
      return 'narrow'
    }

    /**
     * Track one element's content width, because the panel lives in the chat
     * column: a side pane narrowing that column resizes the panel without moving
     * any viewport breakpoint.
     * @returns a ref to attach to the measured element, and its width.
     */
    function useMeasuredWidth() {
      const ref = React.useRef(null)
      const [width, setWidth] = React.useState(0)
      React.useLayoutEffect(() => {
        const node = ref.current
        if (node === null) return undefined
        setWidth(node.clientWidth)
        if (typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(() => {
          setWidth(node.clientWidth)
        })
        observer.observe(node)
        return () => {
          observer.disconnect()
        }
      }, [])
      return [ref, width]
    }

    /**
     * Format one token count compactly.
     * @param value - token count, possibly unknown.
     * @returns an exact small integer, `1.2K`, `3.4M`, or `—`.
     */
    function formatTokens(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—'
      if (value < 1e3) return String(Math.round(value))
      if (value < 1e6) return `${Math.round(value / 100) / 10}K`
      return `${Math.round(value / 1e5) / 10}M`
    }

    /**
     * Format one wallet amount the way the account page does.
     * @param amount - validated decimal balance string.
     * @param symbol - currency symbol.
     * @returns currency text, `<¥0.01` for sub-cent amounts.
     */
    function formatBalance(amount, symbol) {
      const value = Number(amount)
      if (!Number.isFinite(value)) return `${symbol}—`
      if (value === 0) return `${symbol}0.00`
      if (value < 0) return `-${symbol}${value > -0.01 ? '0.01' : Math.abs(value).toFixed(2)}`
      if (value < 0.01) return `<${symbol}0.01`
      return `${symbol}${value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
    }

    /**
     * One part-of-whole percentage, absent when the whole is unknown or not positive.
     * @param part - numerator, possibly unknown.
     * @param whole - denominator, possibly unknown.
     * @returns a percentage clamped to 0..100, or undefined.
     */
    function share(part, whole) {
      if (typeof part !== 'number' || !Number.isFinite(part)) return undefined
      if (typeof whole !== 'number' || !Number.isFinite(whole) || whole <= 0) return undefined
      return Math.max(0, Math.min(100, (part / whole) * 100))
    }

    /** Round one percentage to a single decimal place for display. */
    function percentText(percent) {
      return `${Math.round(percent * 10) / 10}%`
    }

    /** One registered component's locale seat, or a key-echoing stand-in. */
    function translator(props) {
      return props && typeof props.t === 'function' ? props.t : (key) => key
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

    /** One registered component's projection reader, or an always-empty hook. */
    function projectionReader(props) {
      return props && typeof props.useProjection === 'function' ? props.useProjection : () => undefined
    }

    /** Read one session's occupancy numbers from the page's own projections. */
    function occupancyOf(read) {
      const pressure = read('contextPressure')
      const used = pressure === undefined ? undefined : pressure.projectedTokens ?? pressure.pressureTokens
      const capacity = pressure === undefined ? undefined : pressure.contextWindow
      return { pressure, used, capacity, usedPercent: share(used, capacity) }
    }

    //#region panel state

    /** Sessions whose occupancy panel the user opened, by `/context` or the button. */
    const PANEL_OPEN = new Set()

    /** Panel-state subscribers (one per mounted dock entry and toggle). */
    const PANEL_LISTENERS = new Set()

    /**
     * Open or close one session's panel and notify its mounted entries.
     * @param sessionId - the session owning the panel.
     * @param value - whether the panel should be open.
     */
    function setPanelOpen(sessionId, value) {
      if (typeof sessionId !== 'string') return
      const changed = value ? !PANEL_OPEN.has(sessionId) : PANEL_OPEN.has(sessionId)
      if (!changed) return
      if (value) PANEL_OPEN.add(sessionId)
      else PANEL_OPEN.delete(sessionId)
      for (const listener of PANEL_LISTENERS) listener()
    }

    /** Close every panel; the plugin's own teardown. */
    function closeAllPanels() {
      if (PANEL_OPEN.size === 0) return
      PANEL_OPEN.clear()
      for (const listener of PANEL_LISTENERS) listener()
    }

    /**
     * Subscribe one mounted entry to its session's panel state.
     * @param sessionId - the entry's session.
     * @returns whether that session's panel is open.
     */
    function usePanelOpen(sessionId) {
      const [open, setOpen] = React.useState(() => PANEL_OPEN.has(sessionId))
      React.useEffect(() => {
        const sync = () => setOpen(PANEL_OPEN.has(sessionId))
        sync()
        PANEL_LISTENERS.add(sync)
        return () => {
          PANEL_LISTENERS.delete(sync)
        }
      }, [sessionId])
      return open
    }

    //#endregion

    /**
     * One legend glyph, drawn in the current text color.
     * @param props - glyph kind and tint.
     * @returns a 14px decorative SVG.
     */
    function Glyph(props) {
      const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round', strokeLinecap: 'round' }
      let shape
      if (props.kind === 'system') {
        shape = [
          h('rect', Object.assign({ key: 'sheet', x: 3.4, y: 2.8, width: 9.2, height: 10.4, rx: 1.6 }, stroke)),
          h('path', Object.assign({ key: 'lines', d: 'M5.8 6.2h4.4M5.8 8.6h4.4M5.8 11h2.6' }, stroke)),
        ]
      } else if (props.kind === 'tools') {
        shape = [
          h('path', Object.assign({ key: 'track', d: 'M3.4 5.4h9.2M3.4 10.6h9.2' }, stroke)),
          h('circle', Object.assign({ key: 'knob-a', cx: 6.4, cy: 5.4, r: 1.5 }, stroke)),
          h('circle', Object.assign({ key: 'knob-b', cx: 9.6, cy: 10.6, r: 1.5 }, stroke)),
        ]
      } else if (props.kind === 'free') {
        shape = [h('rect', Object.assign({ key: 'free', x: 3.4, y: 3.4, width: 9.2, height: 9.2, rx: 1.6, strokeDasharray: '2.4 2.4' }, stroke))]
      } else {
        shape = [h('path', Object.assign({ key: 'bubble', d: 'M3.2 3.4h9.6v6.4H7.4L4.2 12.2V9.8H3.2z' }, stroke))]
      }
      return h('svg', {
        viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true,
        style: { flex: 'none', color: props.color || 'var(--dsw-alias-label-secondary)' },
      }, shape)
    }

    /**
     * The composer-menu glyph: the bundle icon's three arcs in the row's own
     * text color, sized by the menu's icon slot.
     * @param props - menu slot size.
     * @returns the decorative menu glyph.
     */
    function ContextGlyph(props) {
      const size = typeof props.size === 'number' ? props.size : 14
      const arc = (key, fraction, offset) => h('circle', {
        key,
        cx: 8, cy: 8, r: RADIUS, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
        strokeDasharray: `${CIRCUMFERENCE * fraction} ${CIRCUMFERENCE * (1 - fraction)}`,
        strokeDashoffset: -CIRCUMFERENCE * offset,
        transform: 'rotate(-90 8 8)',
      })
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, style: { flex: 'none' } }, [
        h('circle', { key: 'track', cx: 8, cy: 8, r: RADIUS, fill: 'none', stroke: 'currentColor', strokeOpacity: 0.22, strokeWidth: 1.6 }),
        arc('system', 0.15, 0),
        arc('tools', 0.3, 0.19),
        arc('messages', 0.1, 0.53),
      ])
    }

    /**
     * The header occupancy ring.
     * @param props - occupancy percentage, absent before a sample exists.
     * @returns a 16px decorative SVG.
     */
    function Ring(props) {
      const percent = typeof props.percent === 'number' ? Math.max(0, Math.min(100, props.percent)) : 0
      return h('svg', {
        viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, style: { flex: 'none' },
      }, [
        h('circle', { key: 'track', cx: 8, cy: 8, r: RADIUS, fill: 'none', stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 1.6 }),
        h('circle', {
          key: 'fill', cx: 8, cy: 8, r: RADIUS, fill: 'none', stroke: 'var(--dsw-alias-brand-primary)',
          strokeWidth: 1.6, strokeLinecap: 'round',
          strokeDasharray: `${(CIRCUMFERENCE * percent) / 100} ${CIRCUMFERENCE}`, transform: 'rotate(-90 8 8)',
        }),
      ])
    }

    /**
     * One legend row: it contributes three grid items to {@link S.legendBox} —
     * the named glyph, the value, and the share — so the grid sizes each column
     * to its widest content and no row stretches over its own text. A row with
     * detailed content highlights and chevrons while the pointer rests on it,
     * mirroring the composer tooltip's rows; the pane itself renders beside the
     * card (see {@link bodyChildren}'s legend pane), not inside this row.
     * @param props - glyph kind, label, tint, value text, optional share, and
     * the hover-reveal callbacks.
     * @returns the row's three grid items.
     */
    function LegendCell(props) {
      const revealable = props.content !== undefined && props.content !== ''
      return h(React.Fragment, null, [
        h('div', {
          key: 'name',
          style: Object.assign({}, S.legendName, revealable ? S.legendHoverable : null, props.hovered ? S.legendHovered : null),
          title: revealable ? props.hint : undefined,
          onMouseEnter: props.onEnter,
          onMouseLeave: props.onLeave,
          'data-context-usage': 'legend-cell',
        }, [
          h(Glyph, { key: 'glyph', kind: props.kind, color: props.color }),
          h('span', { key: 'label', style: S.legendLabel }, props.label),
          revealable ? h('span', { key: 'chev', style: S.tipChevron }, props.hovered ? '▾' : '▸') : null,
        ]),
        h('span', { key: 'value', style: S.legendValue }, props.value),
        props.percent === undefined ? null : h('span', { key: 'percent', style: S.legendPercent }, `(${percentText(props.percent)})`),
      ])
    }

    /**
     * One whole-session figure: a small label beside a larger value.
     * @param props - label and the large value text.
     * @returns the stat cell.
     */
    function StatCell(props) {
      return h('div', { style: S.statCell }, [
        h('span', { key: 'label', style: S.statLabel }, props.label),
        h('span', { key: 'value', style: S.statValue }, props.value),
      ])
    }

    /**
     * The occupancy area: one cell per share of the window, tinted by the
     * composition share it falls in, with unoccupied cells in the idle tint.
     * @param usedPercent - occupancy of the window, absent before a sample.
     * @param breakdown - heuristic composition, absent before a sample.
     * @param total - the composition total.
     * @returns one cell element per grid position.
     */
    function gridCells(usedPercent, breakdown, total) {
      const cells = []
      for (let index = 0; index < GRID_CELLS; index += 1) {
        let color
        if (usedPercent !== undefined && total > 0) {
          const fraction = ((index + 0.5) / GRID_CELLS) * 100
          if (fraction <= usedPercent) {
            let cursor = 0
            color = ROWS[ROWS.length - 1].color
            for (const row of ROWS) {
              cursor += ((breakdown[row.key] || 0) / total) * usedPercent
              if (fraction <= cursor) {
                color = row.color
                break
              }
            }
          }
        }
        cells.push(h('div', {
          key: index,
          style: color === undefined ? S.cell : Object.assign({}, S.cell, { background: color }),
        }))
      }
      return cells
    }

    /**
     * The shared card body, so the composer panel and a legacy command row
     * cannot drift apart: the overview, the occupancy area and the composition
     * legend, arranged for the width {@link Body} measured, with the session's
     * turn/step pace in the overview (this bundle hides the shipped dock that
     * used to carry it).
     * @param props - locale seat, the projection values, the session stats, the
     * chosen arrangement, and the ref its container is measured from.
     * @returns the card's children.
     */
    function bodyChildren(props) {
      const { t, pressure, breakdown, usage, session, layout, innerRef, detailed, hoveredLegend, onLegendHover } = props
      const used = pressure === undefined ? undefined : pressure.projectedTokens ?? pressure.pressureTokens
      const capacity = pressure === undefined ? undefined : pressure.contextWindow
      const usedPercent = share(used, capacity)
      const total = breakdown === undefined ? 0 : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens

      const pace = []
      if (session !== undefined) {
        if (session.turns > 0) pace.push(`${session.turns} ${t('turns')}`)
        if (session.steps > 0) pace.push(`${session.steps} ${t('steps')}`)
        if (session.decodeMs > 0 && session.decodeTokens > 0) {
          pace.push(`${Math.round(session.decodeTokens / (session.decodeMs / 1000))} ${t('tps')}`)
        }
      }

      const CONTENT_BY_KEY = detailed === undefined ? {} : {
        systemTokens: detailed.systemText === undefined || detailed.systemText === '' ? undefined : detailed.systemText,
        toolsTokens: detailed.toolNames === undefined || detailed.toolNames.length === 0 ? undefined : detailed.toolNames.join('\n'),
        messageTokens: detailed.conversationBlocks === undefined || detailed.conversationBlocks.length === 0 ? undefined : detailed.conversationBlocks,
      }

      const legend = []
      for (const row of ROWS) {
        const value = breakdown === undefined ? undefined : breakdown[row.key]
        const content = CONTENT_BY_KEY[row.key]
        const revealable = content !== undefined && content !== ''
        legend.push(h(LegendCell, {
          key: row.key, kind: row.kind, label: t(row.label), color: row.color,
          value: formatTokens(value), percent: share(value, capacity),
          content,
          hovered: hoveredLegend === row.key,
          onEnter: revealable ? () => onLegendHover(row.key, true) : undefined,
          onLeave: revealable ? () => onLegendHover(row.key, false) : undefined,
          hint: t('tipExpandHint'),
        }))
      }
      if (used !== undefined && capacity !== undefined) {
        const free = Math.max(0, capacity - used)
        legend.push(h(LegendCell, { key: 'free', kind: 'free', label: t('free'), color: FREE_COLOR, value: formatTokens(free), percent: share(free, capacity) }))
      }

      const stats = []
      if (usage !== undefined) {
        const hitRate = share(usage.cacheReadTokens, usage.cacheReadTokens + usage.uncachedInputTokens)
        stats.push(h(StatCell, { key: 'miss', label: t('miss'), value: formatTokens(usage.uncachedInputTokens) }))
        stats.push(h(StatCell, { key: 'hit', label: t('hit'), value: formatTokens(usage.cacheReadTokens) }))
        stats.push(h(StatCell, { key: 'hitRate', label: t('hitRate'), value: hitRate === undefined ? '—' : percentText(hitRate) }))
        stats.push(h(StatCell, { key: 'output', label: t('output'), value: formatTokens(usage.outputTokens) }))
      }

      const overview = h('div', { key: 'overview', style: S.headLeft }, [
        h('div', { key: 'titleRow', style: S.headRow }, [
          h(Ring, { key: 'ring', percent: usedPercent }),
          h('span', { key: 'title', style: S.title }, t('title')),
        ]),
        h('div', { key: 'figures', style: S.headRow }, [
          h('span', { key: 'figure', style: S.figure }, `${formatTokens(used)} / ${formatTokens(capacity)}`),
          usedPercent === undefined ? null : h('span', { key: 'percent', style: S.percent }, String(Math.round(usedPercent)) + '%'),
        ]),
        pace.length === 0 ? null : h('div', { key: 'pace', style: S.pace }, pace.join(' · ')),
      ])
      const viz = h('div', { key: 'viz', style: layout === 'wide' ? S.viz : S.vizFull }, [
        h('div', { key: 'grid', style: S.grid }, gridCells(usedPercent, breakdown, total)),
        stats.length === 0 ? null : h('div', { key: 'stats', style: S.stats }, stats),
      ])
      const legendBox = breakdown === undefined
        ? h('div', { key: 'legend', style: S.legendBox }, h('div', { style: S.muted }, t('noSample')))
        : h('div', { key: 'legend', style: S.legendBox }, legend)

      /* One band where it fits; otherwise the overview pairs with the legend and
       * the occupancy area takes the band below them; otherwise all three stack.
       * The hovered legend's detail pane renders beside the whole card, so it
       * never reflows the panel's own layout. */
      const pane = h(DetailPane, {
        key: 'pane',
        marker: 'panel-pane',
        title: hoveredLegend === null ? '' : t((ROWS.find((row) => row.key === hoveredLegend) || ROWS[0]).label),
        content: hoveredLegend === null ? undefined : CONTENT_BY_KEY[hoveredLegend],
        onEnter: props.onLegendEnter,
        onLeave: props.onLegendLeave,
        onClose: props.onLegendClose,
        onPin: props.onLegendPin,
      })
      if (layout === 'medium') {
        return [
          h('div', { key: 'main', ref: innerRef, style: Object.assign({}, S.stack, S.paneAnchor) }, [
            h('div', { key: 'pair', style: S.pair }, [overview, legendBox]),
            viz,
            pane,
          ]),
        ]
      }
      return [h('div', { key: 'main', ref: innerRef, style: Object.assign({}, layout === 'wide' ? S.main : S.stack, S.paneAnchor) }, [overview, viz, legendBox, pane])]
    }

    /**
     * The measurable body: it owns the ref its arrangement is measured from, and
     * re-renders the blocks for the width that ref reports.
     * @param props - locale seat and the projection values.
     * @returns the card's children.
     */
    function Body(props) {
      const [innerRef, width] = useMeasuredWidth()
      return bodyChildren(Object.assign({ innerRef, layout: layoutFor(width) }, props))
    }

    /**
     * The occupancy panel the `/context` action and the composer button open,
     * docked above the composer card with the shipped full-width docks.
     * @param props - the dock entry's standard session shares.
     * @returns the panel, or null while it is closed.
     */
    function ContextUsagePanel(props) {
      const t = translator(props)
      const read = projectionReader(props)
      const sessionId = props ? props.sessionId : undefined
      const open = usePanelOpen(sessionId)
      const pressure = read('contextPressure')
      const breakdown = read('contextBreakdown')
      const usage = read('tokenUsage')
      const session = read('sessionStats')
      const sessions = props ? props.sessions : undefined
      const detailed = useDetailedContent(sessions, sessionId)
      const reveal = usePaneReveal()
      const hoverLegend = (key, on) => (on ? reveal.reveal(key) : reveal.scheduleClose())
      if (!open) return null
      return h('div', { style: S.panel },
        h('div', { style: S.panelCard, 'data-context-usage': 'panel' },
          h(Body, {
            t, pressure, breakdown, usage, session, detailed,
            hoveredLegend: reveal.rowKey,
            onLegendHover: hoverLegend,
            onLegendEnter: reveal.cancel,
            onLegendLeave: reveal.scheduleClose,
            onLegendClose: reveal.close,
            onLegendPin: reveal.setPinned,
          })))
    }

    /**
     * Extract the effective system prompt text from one event window: the last
     * nonempty `system/message`'s joined text blocks (the surface's effective
     * node), or '' when the window shows no system prompt.
     * @param window - the session's event-window snapshot, absent when unbound.
     * @returns the effective system prompt text, or undefined with no window.
     */
    function systemPromptTextOf(window) {
      if (window === undefined) return undefined
      let text = ''
      for (const entry of window.entries) {
        const event = entry && entry.type === 'event' ? entry.event : undefined
        if (event === undefined || event.type !== 'system/message') continue
        const content = event.data && event.data.message && event.data.message.content
        if (!Array.isArray(content)) continue
        const joined = content
          .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('')
        if (joined.length > 0) text = joined
      }
      return text
    }

    /**
     * Extract the effective tool catalog from one event window: the names on
     * the newest `request/header`'s tool schemas, in catalog order.
     * @param window - the session's event-window snapshot, absent when unbound.
     * @returns tool names, or undefined with no window.
     */
    function toolNamesOf(window) {
      if (window === undefined) return undefined
      let names = []
      for (const entry of window.entries) {
        const event = entry && entry.type === 'event' ? entry.event : undefined
        if (event === undefined || event.type !== 'request/header') continue
        const header = event.data && event.data.header ? event.data.header : (event.data || {})
        const tools = Array.isArray(header.tools) ? header.tools : []
        const listed = tools
          .map((tool) => tool && typeof tool.name === 'string' ? tool.name : '')
          .filter((name) => name.length > 0)
        if (tools.length > 0 || event.data && event.data.tools !== undefined) names = listed
      }
      return names
    }

    /**
     * One message block of the conversation pane: a role tag with the message's
     * own character count, so the pane's content visibly accounts for the
     * `messageTokens` figure beside it.
     * @param props - role tag, character count, and the message text.
     * @returns the block header and body.
     */
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
    const MessageBlock = React.memo(function MessageBlock(props) {
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
    })

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
    const OutlineRow = React.memo(function OutlineRow(props) {
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
    })

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
      const { pressure, breakdown, systemText, toolNames, conversationBlocks } = props
      const used = pressure === undefined ? undefined : pressure.projectedTokens ?? pressure.pressureTokens
      const capacity = pressure === undefined ? undefined : pressure.contextWindow
      const usedPercent = share(used, capacity)
      const total = breakdown === undefined ? 0 : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
      const reveal = usePaneReveal()
      const hoveredRow = reveal.rowKey
      const CONTENT_BY_KEY = {
        systemTokens: systemText === undefined || systemText === '' ? undefined : systemText,
        toolsTokens: toolNames === undefined || toolNames.length === 0 ? undefined : toolNames.join('\n'),
        messageTokens: conversationBlocks === undefined || conversationBlocks.length === 0 ? undefined : conversationBlocks,
      }
      const rows = []
      for (const row of ROWS) {
        const value = breakdown === undefined ? undefined : breakdown[row.key]
        const content = CONTENT_BY_KEY[row.key]
        const revealable = content !== undefined && content !== ''
        rows.push(h(TipSection, {
          key: row.key,
          kind: row.kind, label: t(row.label), color: row.color,
          value: formatTokens(value),
          hovered: hoveredRow === row.key,
          revealable,
          onEnter: revealable ? () => reveal.reveal(row.key) : undefined,
          onLeave: revealable ? reveal.scheduleClose : undefined,
          title: t('tipExpandHint'),
        }))
      }
      if (used !== undefined && capacity !== undefined) {
        const free = Math.max(0, capacity - used)
        rows.push(h('div', { key: 'free', style: S.tipRow }, [
          h('span', { key: 'name', style: S.tipName }, [h(Glyph, { kind: 'free', color: FREE_COLOR }), t('tipFree')]),
          h('span', { key: 'value', style: S.tipValue }, formatTokens(free)),
          h('span', { key: 'percent', style: S.tipPercent },
            share(free, capacity) === undefined ? '' : percentText(share(free, capacity))),
        ]))
      }
      return h('div', { style: S.tip, onMouseEnter: () => { reveal.cancel(); if (props.onEnter !== undefined) props.onEnter() }, onMouseLeave: props.onLeave, 'data-context-usage': 'tip' }, [
        h('div', { key: 'head', style: S.tipHead }, [
          `${t('tipUsed')}  ${formatTokens(used)} / ${formatTokens(capacity)}`,
          usedPercent === undefined ? '' : `  ${percentText(usedPercent)}`,
        ]),
        breakdown === undefined ? h('div', { style: S.muted }, t('noSample')) : rows,
        /* The detached detail pane: anchored to the tooltip's right edge, laid
         * out beside it rather than inside it, so revealing content never
         * reflows the composition rows. */
        h(DetailPane, {
          key: 'pane',
          marker: 'tip-content',
          title: hoveredRow === null ? '' : t((ROWS.find((row) => row.key === hoveredRow) || ROWS[0]).label),
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
     * control seat immediately before the submit action. Hovering it for a short
     * dwell shows a composition tooltip; clicking still toggles the full panel.
     * @param props - the composer row's standard session shares.
     * @returns the toggle button.
     */
    function ContextToggle(props) {
      const t = translator(props)
      const read = projectionReader(props)
      const sessionId = props ? props.sessionId : undefined
      const open = usePanelOpen(sessionId)
      const [hover, setHover] = React.useState(false)
      const [tipOpen, setTipOpen] = React.useState(false)
      const tipTimer = React.useRef(undefined)
      /** Whether the tooltip's detail pane is maximized (and so pinned open). */
      const pinnedRef = React.useRef(false)
      const { usedPercent } = occupancyOf(read)
      React.useEffect(() => () => {
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
      const breakdown = read('contextBreakdown')
      const sessions = props ? props.sessions : undefined
      const detailed = useDetailedContent(sessions, sessionId)
      const systemText = detailed.systemText
      const toolNames = detailed.toolNames
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
          h(Ring, { key: 'ring', percent: usedPercent }),
          usedPercent === undefined ? null : h('span', { key: 'text' }, `${Math.round(usedPercent)}%`),
        ]),
        tipOpen && !open ? h(ContextTip, { key: 'tip', t, pressure, breakdown, systemText, toolNames, conversationBlocks: detailed.conversationBlocks, onEnter: cancelTipClose, onLeave: leave, onPin: (on) => { pinnedRef.current = on } }) : null,
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
      const breakdown = read('contextBreakdown')
      const usage = read('tokenUsage')
      const session = read('sessionStats')
      const outcome = node ? node.outcome : null
      const head = (right) => h('div', { key: 'head', style: S.head }, [
        h(Ring, { key: 'ring', percent: right === undefined ? 0 : right }),
        h('span', { key: 'title', style: S.title }, t('title')),
        h('span', { key: 'spacer', style: S.spacer }),
      ])
      if (outcome === null || outcome === undefined) {
        return h('div', { style: S.card },
          head(undefined),
          h('div', { style: S.muted }, t('running')))
      }
      if (outcome.kind === 'error') {
        return h('div', { style: S.card },
          head(undefined),
          h('div', { style: S.error }, typeof outcome.text === 'string' && outcome.text.length > 0 ? outcome.text : t('failed')))
      }
      return h('div', { style: S.card }, h(Body, { t, pressure, breakdown, usage, session }))
    }

    return {
      inject: ['slots', 'locale', 'commandUi', 'sessions'],
      apply(ctx) {
        const tr = ctx.locale.bind(NS)
        const sessions = ctx.sessions
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'context-usage: dictionaries')

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
          inject: (sessionId) => {
            const eventWindow = eventWindowOf(sessions, sessionId)
            return {
              systemText: systemPromptTextOf(eventWindow),
              toolNames: toolNamesOf(eventWindow),
              sessions,
            }
          },
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
            const [state, setState] = React.useState({ kind: 'pending' })
            React.useEffect(() => {
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
