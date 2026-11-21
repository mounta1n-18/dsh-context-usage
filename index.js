/**
 * Host half of the `@local/dsh-context-usage` bundle.
 *
 * The Client module owns the presentation: the `/context` command, the
 * occupancy panel above the composer, and the composer toggle. This half owns
 * the numbers.
 *
 * Why a projection instead of the shipped `contextBreakdown`: that unit prices
 * only three buckets (`systemTokens`, `toolsTokens`, `messageTokens`) and its
 * `messageTokens` is literally `surfaceTokens - systemTokens`, so every user
 * message, assistant reply, tool result and compaction summary collapses into a
 * single opaque number. This projection folds the same session log into six
 * priced buckets instead — system prompt, tool definitions, user messages,
 * assistant replies, tool results, compaction summaries — and stamps each turn
 * so the client can show what the current turn added.
 *
 * The unit is Host-only in practice: `wire.summary` is false so compaction
 * prompts never carry it, and the client reads it like any other projection.
 * Prices use the same 4-chars-per-token density as `@deepseek-ai/dsh-token-meter`
 * so the buckets stay comparable with the shipped meter; the client rescales
 * them onto the provider-reported prompt size, which is the only exact number.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { BALANCE_ROUTE, createBalanceHandler } from './balance.js'

/** Cordis plugin identity. */
export const name = 'dsh-context-usage'

/** The session projection registry is the only Host service this half needs. */
export const inject = ['sessionProjections']

/** Projection key the client reads. */
export const PROJECTION_KEY = 'contextUsage'

/**
 * Bumped whenever the folded state shape changes; mismatched checkpoints drop.
 * 2: `control` split out of `sys` — a version-1 checkpoint may still carry
 * developer control nodes where the system prompt belongs, and restoring that
 * would keep the wrong number until the next prompt arrives.
 */
const STATE_VERSION = 2

/* -------------------------------------------------------------------------- */
/* Token pricing — mirrors @deepseek-ai/dsh-token-meter/src/estimate.ts        */
/* -------------------------------------------------------------------------- */

const CHARS_PER_TOKEN = 4
const BLOCK_OVERHEAD = 4
const ROLE_OVERHEAD = 4

/** Message-category buckets, in the order the client paints them. */
const MESSAGE_KEYS = ['user', 'assistant', 'tool', 'compact']

/** Recent message nodes, so a compaction can price exactly what it replaced. */
const RECENT_LIMIT = 512

function lengthOf(text) {
  return typeof text === 'string' ? text.length : 0
}

function charsToTokens(chars) {
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

/**
 * Price one content block the way the shipped meter does.
 * @param block - any content block of a session message.
 * @returns its rough token price.
 */
function blockPrice(block) {
  if (block === null || typeof block !== 'object') return 0
  const type = block.type
  if (type === 'text' || type === 'reasoning') {
    return charsToTokens(lengthOf(block.text)) + BLOCK_OVERHEAD
  }
  if (type === 'tool-call') {
    const name = charsToTokens(lengthOf(block.name))
    const args = charsToTokens(lengthOf(block.arguments))
    return name + args + BLOCK_OVERHEAD
  }
  let json = '{}'
  try {
    /* An offloaded image keeps only its handle; the bytes are not in the prompt. */
    json = JSON.stringify(type === 'image' ? Object.assign({}, block, { offloaded: undefined }) : block)
  } catch {
    json = ''
  }
  return BLOCK_OVERHEAD + charsToTokens(lengthOf(json))
}

/**
 * Price a message body (content blocks plus the per-message role overhead).
 * @param message - a session message, or null when the event carried none.
 * @returns its rough token price; 0 for an empty message.
 */
function messagePrice(message) {
  const content = message === null || typeof message !== 'object' ? undefined : message.content
  if (!Array.isArray(content) || content.length === 0) return 0
  let tokens = 0
  for (const block of content) tokens += blockPrice(block)
  return tokens + ROLE_OVERHEAD
}

/**
 * Price the canonical request header's tool definitions.
 * @param header - `request/header`'s canonical header, if any.
 * @returns its rough token price; 0 when the request carried no tools.
 */
function toolsPrice(header) {
  const tools = header === null || typeof header !== 'object' ? undefined : header.tools
  if (!Array.isArray(tools) || tools.length === 0) return 0
  let json = ''
  try {
    json = JSON.stringify(tools)
  } catch {
    return 0
  }
  return charsToTokens(lengthOf(json)) + BLOCK_OVERHEAD
}

/* -------------------------------------------------------------------------- */
/* Event classification                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The message an event contributed to the surface, if any.
 * @param event - a committed session event.
 * @returns the message, or null when the event carries none.
 */
function eventMessage(event) {
  const data = event === null || typeof event !== 'object' ? undefined : event.data
  if (data === null || typeof data !== 'object') return null
  if (event.type === 'user/message') return data
  const message = data.message
  return message === null || typeof message !== 'object' ? null : message
}

/**
 * Which display bucket an event feeds.
 * @param event - a committed session event.
 * @returns the bucket name, or null when the event is not a surface contribution.
 */
function eventCategory(event) {
  switch (event.type) {
    case 'system/message':
      return 'system'
    /* Developer messages are control-plane traffic (tool additions and
     * removals). They ride the prompt as extra text, but they are not the
     * system prompt and must never stand in for it: they are priced into the
     * tools bucket and cleared by the next authoritative `request/header`. */
    case 'developer/message':
      return 'control'
    case 'user/message':
      /* A replacement user message is what `/compact` (and any compaction
       * plugin following the same contract) folds history into. */
      return event.surfaceOp === 'append' ? 'user' : 'compact'
    case 'assistant/message':
      return 'assistant'
    case 'tool/result':
      return 'tool'
    default:
      return null
  }
}

/* -------------------------------------------------------------------------- */
/* Fold state                                                                 */
/* -------------------------------------------------------------------------- */

function zeroCounts() {
  return { user: 0, assistant: 0, tool: 0, compact: 0 }
}

/**
 * The starting state: nothing priced, no turn baseline, a published all-zero
 * view (the client must never see an undefined face).
 * @returns a fresh state.
 */
function initialState() {
  return publish({
    version: STATE_VERSION,
    /* Surviving system-ish nodes as [seq, tokens], oldest first. Only real
     * up front system prompts land here; developer control traffic does not. */
    sys: [],
    /* Surviving message nodes as [seq, tokens, category], oldest first. */
    recent: [],
    tools: 0,
    /* Developer control messages (tool additions/removals) since the last
     * authoritative request header. Priced into the tools bucket. */
    control: 0,
    user: 0,
    assistant: 0,
    tool: 0,
    compact: 0,
    /* A compaction claim: it applies to the very next surface event only. */
    claim: null,
    /* Bucket values at the last `turn/start`, for the "this turn" deltas. */
    base: { system: 0, tools: 0, user: 0, assistant: 0, tool: 0, compact: 0 },
    pub: null,
  })
}

/**
 * The live system prompt: the newest surviving `system/message`.
 * The harness records a system-prompt update as a fresh message in history
 * (`request/context.systemPromptUpdate === 'in-history'`), so older ones are
 * superseded text, not context the next request carries. They stay in `sys`
 * only so a compaction claim can price them. Developer control messages never
 * reach `sys`: they are not the system prompt and must not shadow it.
 * @param state - the fold state.
 * @returns tokens.
 */
function liveSystem(state) {
  const node = state.sys.length > 0 ? state.sys[state.sys.length - 1] : undefined
  return node === undefined ? 0 : node[1]
}

/**
 * The bucket values at this instant, without the per-turn deltas.
 * @param state - the fold state.
 * @returns a plain snapshot.
 */
function snapshot(state) {
  return {
    system: liveSystem(state),
    tools: state.tools + (state.control || 0),
    user: state.user,
    assistant: state.assistant,
    tool: state.tool,
    compact: state.compact,
  }
}

/**
 * Rebuild the published view (the only thing the client sees) and append it to
 * the state. Called only when a bucket changed, so its reference is stable
 * between changes.
 * @param state - the fold state with current buckets.
 * @returns the state carrying a fresh `pub`.
 */
function publish(state) {
  const system = liveSystem(state)
  const tools = state.tools + (state.control || 0)
  const total = system + tools + state.user + state.assistant + state.tool + state.compact
  const base = state.base
  /* A session that started before this unit existed (a fork, or a log that
   * opened mid-history) has no baseline yet: claiming "this turn added the whole
   * context" would be worse than claiming nothing. */
  const based = base.system + base.tools + base.user + base.assistant + base.tool + base.compact > 0
  const turn = {
    system: based ? Math.max(0, system - base.system) : 0,
    tools: based ? Math.max(0, tools - base.tools) : 0,
    user: based ? Math.max(0, state.user - base.user) : 0,
    assistant: based ? Math.max(0, state.assistant - base.assistant) : 0,
    tool: based ? Math.max(0, state.tool - base.tool) : 0,
    compact: based ? Math.max(0, state.compact - base.compact) : 0,
  }
  turn.total = turn.system + turn.tools + turn.user + turn.assistant + turn.tool + turn.compact
  /* No baseline, or a "delta" that turns out to be the entire context (a log
   * that opened mid-history): report no comparison rather than a fake one. */
  if (!based || (total > 0 && turn.total >= total * 0.95)) {
    turn.system = 0
    turn.tools = 0
    turn.user = 0
    turn.assistant = 0
    turn.tool = 0
    turn.compact = 0
    turn.total = 0
  }
  return {
    ...state,
    pub: {
      version: STATE_VERSION,
      system,
      tools,
      user: state.user,
      assistant: state.assistant,
      tool: state.tool,
      compact: state.compact,
      total,
      turn,
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Placement                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Apply a compaction claim to a replacement: drop the shadowed nodes, put the
 * summary where they were, and shrink whatever the claim shadowed but did not
 * name (the shipped meter folds that remainder at zero delta; a display meter
 * would rather under-count than leave a phantom).
 * @param state - the state with the claim cleared.
 * @param claim - the pending compaction claim.
 * @param category - the replacement's bucket.
 * @param tokens - the replacement's price.
 * @param seq - the replacement's session seq.
 * @returns the next state's buckets.
 */
function settleClaim(state, claim, category, tokens, seq) {
  const shadowed = new Set(claim.seqs)
  const sys = []
  let removedSystem = 0
  for (const node of state.sys) {
    if (shadowed.has(node[0])) removedSystem += node[1]
    else sys.push(node)
  }

  const recent = []
  const counts = zeroCounts()
  counts.user = state.user
  counts.assistant = state.assistant
  counts.tool = state.tool
  counts.compact = state.compact
  let removedMessages = 0
  for (const node of state.recent) {
    if (shadowed.has(node[0])) {
      const key = node[2]
      counts[key] = Math.max(0, counts[key] - node[1])
      removedMessages += node[1]
    } else {
      recent.push(node)
    }
  }

  /* Whatever the claim priced and we could not name: spread it over the
   * messages that survived, in proportion. */
  const leftover = Math.max(0, claim.tokens - removedSystem - removedMessages)
  let messageSum = counts.user + counts.assistant + counts.tool + counts.compact
  if (leftover > 0 && messageSum > 0) {
    const keep = Math.max(0, 1 - Math.min(1, leftover / messageSum))
    for (const key of MESSAGE_KEYS) counts[key] = Math.round(counts[key] * keep)
    messageSum = counts.user + counts.assistant + counts.tool + counts.compact
  }

  if (tokens > 0) {
    if (category === 'system') {
      sys.push([seq, tokens])
    } else {
      counts[category] += tokens
      recent.push([seq, tokens, category])
    }
  }

  return {
    ...state,
    sys,
    recent: recent.length > RECENT_LIMIT ? recent.slice(recent.length - RECENT_LIMIT) : recent,
    user: counts.user,
    assistant: counts.assistant,
    tool: counts.tool,
    compact: counts.compact,
  }
}

/**
 * A replacement the log never metered (a rewritten system prompt): swap the
 * node in place when we still hold it, otherwise add it. Message replacements
 * without a claim are not priced — counting them twice would be worse.
 * @param state - the state with the claim cleared.
 * @param op - the replacement's surface op.
 * @param category - the replacement's bucket.
 * @param tokens - the replacement's price.
 * @param seq - the replacement's session seq.
 * @returns the next state's buckets.
 */
function settleReplace(state, op, category, tokens, seq) {
  if (category !== 'system') return state
  const start = Number(op.startSeq)
  const index = state.sys.findIndex((node) => node[0] === start)
  const sys = state.sys.slice()
  if (index >= 0) {
    if (tokens > 0) sys[index] = [seq, tokens]
    else sys.splice(index, 1)
  } else if (tokens > 0) {
    sys.push([seq, tokens])
  } else {
    return state
  }
  return { ...state, sys }
}

/* -------------------------------------------------------------------------- */
/* The fold                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One event, one state. Never throws: a projection that throws would take the
 * session's event loop with it, and a stale number is better than none.
 * @param state - the previous state.
 * @param event - the committed session event.
 * @returns the next state, or the same reference when nothing changed.
 */
function foldEvent(state, event) {
  try {
    return step(state, event)
  } catch {
    return state
  }
}

function step(state, event) {
  if (event === null || typeof event !== 'object') return state
  const type = event.type

  if (type === 'compaction/summary' || type === 'compaction/prune') {
    const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
    const range = data.shadowedRange !== null && typeof data.shadowedRange === 'object' ? data.shadowedRange : {}
    const seqs = Array.isArray(data.shadowedSeqs) ? data.shadowedSeqs.slice(0, 4000) : []
    return {
      ...state,
      claim: {
        start: Number(range.start),
        end: Number(range.end),
        tokens: Math.max(0, Math.floor(Number(data.shadowedTokenCount) || 0)),
        seqs,
      },
    }
  }

  /* A claim only ever rides the event right after the compaction. */
  const claim = state.claim
  const next = claim === null ? state : { ...state, claim: null }

  if (type === 'turn/start') {
    return publish({ ...next, base: snapshot(next) })
  }

  if (type === 'request/header') {
    const tools = toolsPrice(event.data === null || typeof event.data !== 'object' ? undefined : event.data.header)
    /* The header's tool list is authoritative: it already carries whatever the
     * developer control messages announced, so those stop being counted here. */
    if (tools === next.tools && (next.control || 0) === 0) return next
    return publish({ ...next, tools, control: 0 })
  }

  const op = event.surfaceOp
  const category = eventCategory(event)
  if (op === undefined || op === null || category === null) return next

  const tokens = messagePrice(eventMessage(event))
  const seq = Number(event.seq)

  if (category === 'control') {
    if (tokens <= 0) return next
    return publish({ ...next, control: (next.control || 0) + tokens })
  }

  if (op === 'append') {
    if (tokens <= 0) return next
    if (category === 'system') return publish({ ...next, sys: [...next.sys, [seq, tokens]] })
    const recent = next.recent.length >= RECENT_LIMIT
      ? next.recent.slice(next.recent.length - RECENT_LIMIT + 1)
      : next.recent
    return publish({
      ...next,
      [category]: next[category] + tokens,
      recent: [...recent, [seq, tokens, category]],
    })
  }

  const start = Number(op.startSeq)
  const end = Number(op.endSeq)
  if (claim !== null && start === claim.start && end === claim.end) {
    return publish(settleClaim(next, claim, category, tokens, seq))
  }
  return publish(settleReplace(next, op, category, tokens, seq))
}

/* -------------------------------------------------------------------------- */
/* Definition                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Identity schema: the log replays pure data through `apply`, and this unit
 * never persists a shape it did not write itself. Duck-typed on purpose — the
 * Host registry only ever calls `parse`, and this package carries no
 * `@deepseek-ai/*` dependency to import a real schema from.
 */
const identity = { parse: (value) => value }

/** The Host projection the client reads as `contextUsage`. */
export const definition = {
  key: PROJECTION_KEY,
  stateVersion: STATE_VERSION,
  stateSchema: identity,
  init: () => initialState(),
  apply: foldEvent,
  wire: {
    /* Never inject this unit into compaction prompts. */
    summary: false,
    viewSchema: identity,
    view: (state) => state.pub,
  },
}

/* -------------------------------------------------------------------------- */
/* Persisted panel state                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Route the browser calls to read and remember which Sessions keep the band
 * open. It lives on the Host because the Web GUI listens on a fresh ephemeral
 * port every launch: `localStorage` is scoped to the origin, so a remembered
 * toggle would silently vanish on the next start.
 */
export const PANEL_ROUTE = '/__context-usage/panels'

/** Remembered Sessions before the least recently touched are dropped. */
const PANEL_LIMIT = 200

/** Debounce for the file write; a burst of toggles costs one write. */
const PANEL_WRITE_DELAY = 400

/** `{ [sessionId]: true }` for every Session whose band is open. */
const panelOpen = new Map()

/** Whether `panelOpen` has been read from disk once. */
let panelLoaded = false

/** Pending debounced write, if any. */
let panelTimer = null

/** Absolute path of the JSON file that survives restarts. */
function panelStatePath() {
  /* Test hook: the smoke test points this at a scratch file so it never writes
   * into the real profile state. */
  const override = process.env.DSH_CONTEXT_USAGE_PANELS
  if (typeof override === 'string' && override.length > 0) return override
  return join(homedir(), '.local', 'state', 'dsh-context-usage', 'panels.json')
}

/** Read the persisted file into `panelOpen`; a missing or broken file means none. */
function loadPanels() {
  if (panelLoaded) return
  panelLoaded = true
  try {
    const parsed = JSON.parse(readFileSync(panelStatePath(), 'utf8'))
    const panels = parsed && typeof parsed === 'object' ? parsed.panels : undefined
    if (!panels || typeof panels !== 'object') return
    for (const [sessionId, open] of Object.entries(panels)) {
      if (open === true && typeof sessionId === 'string' && sessionId.length > 0) {
        panelOpen.set(sessionId, Date.now())
      }
    }
  } catch {
    /* no file yet, or unreadable: the band starts closed everywhere */
  }
}

/** Write `panelOpen` to disk now, keeping only the most recent Sessions. */
function writePanels() {
  panelTimer = null
  try {
    const entries = Array.from(panelOpen.entries()).sort((a, b) => b[1] - a[1]).slice(0, PANEL_LIMIT)
    panelOpen.clear()
    for (const entry of entries) panelOpen.set(entry[0], entry[1])
    const panels = {}
    for (const sessionId of panelOpen.keys()) panels[sessionId] = true
    const file = panelStatePath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ version: 1, panels }, null, 2)}\n`, 'utf8')
  } catch {
    /* an unwritable home must not break the panel */
  }
}

/** Schedule one debounced write. */
function schedulePanelWrite() {
  if (panelTimer !== null) return
  panelTimer = setTimeout(writePanels, PANEL_WRITE_DELAY)
  if (typeof panelTimer === 'object' && panelTimer !== null && 'unref' in panelTimer) panelTimer.unref()
}

/**
 * Remember one Session's toggle.
 * @param sessionId - the Session.
 * @param open - whether its band is open.
 */
function rememberPanel(sessionId, open) {
  loadPanels()
  if (open) panelOpen.set(sessionId, Date.now())
  else panelOpen.delete(sessionId)
  schedulePanelWrite()
}

/**
 * Answer one panel-state request: GET returns every remembered Session, POST
 * records one toggle.
 * @param req - the incoming request.
 * @param res - the response this handler owns.
 */
async function handlePanelRoute(req, res) {
  res.setHeader('cache-control', 'no-store')
  if (req.method === 'GET' || req.method === 'HEAD') {
    loadPanels()
    const panels = {}
    for (const sessionId of panelOpen.keys()) panels[sessionId] = true
    const body = JSON.stringify({ panels })
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(req.method === 'HEAD' ? undefined : body)
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'GET, HEAD, POST' })
    res.end()
    return
  }
  let text = ''
  try {
    for await (const chunk of req) {
      text += chunk
      if (text.length > 65536) throw new Error('panel state body too large')
    }
    const parsed = JSON.parse(text)
    const sessionId = parsed && parsed.sessionId
    const open = parsed && parsed.open
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof open !== 'boolean') {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false }))
      return
    }
    rememberPanel(sessionId, open)
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true }))
  } catch {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false }))
  }
}

/**
 * Register the projection for the lifetime of this plugin.
 * @param ctx - the plugin context, already holding `sessionProjections`.
 */
export function apply(ctx) {
  /* The route needs `webServer`, which only the Web runtime provides; scoping it
   * keeps a CLI-only Host free of the dependency while the projection still
   * registers there. */
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      try {
        return scope.webServer.register({ kind: 'exact', path: PANEL_ROUTE, handler: handlePanelRoute })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        try {
          scope.logger.warn(`[dsh-context-usage] panel route registration failed: ${message}`)
        } catch {
          /* logging must never break the plugin */
        }
        return () => {}
      }
    }, 'context-usage: panel state route')
    scope.effect(() => {
      try {
        /* Balance probing reads provider keys (Moonshot, Zhipu) or the platform
         * account grant (DeepSeek) on the Host, so the browser never holds a
         * secret and a 1s poll costs no tokens. */
        const handler = createBalanceHandler(scope)
        return scope.webServer.register({ kind: 'exact', path: BALANCE_ROUTE, handler })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        try {
          scope.logger.warn(`[dsh-context-usage] balance route registration failed: ${message}`)
        } catch {
          /* logging must never break the plugin */
        }
        return () => {}
      }
    }, 'context-usage: balance route')
    scope.effect(() => () => {
      if (panelTimer !== null) {
        clearTimeout(panelTimer)
        writePanels()
      }
    }, 'context-usage: flush panel state')
  })

  ctx.effect(() => {
    try {
      /* `register` hands back the effect disposer itself (a thenable whose
       * await resolves to the handle), so returning it lets Cordis release the
       * registration when this plugin unloads — the documented composing
       * pattern. Awaiting is not needed: every Session that had events folded
       * gets its cell materialized on first read. */
      return ctx.sessionProjections.register(definition)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      try {
        ctx.logger.warn(`[dsh-context-usage] projection registration failed: ${message}`)
      } catch {
        /* logging must never break the plugin */
      }
      return () => {}
    }
  }, 'context-usage: contextUsage projection')
}
