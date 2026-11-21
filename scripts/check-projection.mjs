/**
 * Fold smoke test for the `contextUsage` projection.
 *
 * Runs the exported definition against hand-built session events — no DSH
 * process, no browser — and prints the published view after each step, so the
 * pricing, the per-turn deltas and the compaction claim can be checked in
 * isolation.
 *
 *   $env:ELECTRON_RUN_AS_NODE=1; & "C:\...\DeepSeek Harness.exe" scripts\check-projection.mjs
 */

import { apply, definition, name, inject, PANEL_ROUTE } from '../index.js'
import { BALANCE_ROUTE } from '../balance.js'

/* The plugin wiring, without a Host: `apply` must hand the registry the
 * definition and leave it an effect disposer to release on unload, and it must
 * put the panel-state and balance routes on the Web carrier when there is one. */
let registered
let released = false
const routes = new Map()
const routeReleases = []
const fakeScope = {
  effect(fn, label) {
    const disposer = fn()
    if (typeof disposer !== 'function') throw new Error(`effect ${label} did not return a disposer`)
    return disposer
  },
  webServer: {
    register(value) {
      routes.set(value.path, value)
      const release = () => { routeReleases.push(value.path) }
      return release
    },
  },
  logger: { warn: (message) => console.error(message) },
}
const fakeCtx = {
  effect(fn, label) {
    const disposer = fn()
    if (typeof disposer !== 'function') throw new Error(`effect ${label} did not return a disposer`)
    this.lastDisposer = disposer
    return disposer
  },
  inject(deps, callback) {
    if (!deps.includes('webServer')) throw new Error(`unexpected inject ${deps.join(',')}`)
    callback(fakeScope)
  },
  sessionProjections: {
    register(value) {
      registered = value
      return Object.assign(async () => { released = true }, { then() {} })
    },
  },
  logger: { warn: (message) => console.error(message) },
}
if (name !== 'dsh-context-usage') throw new Error(`unexpected plugin name ${name}`)
if (!inject.includes('sessionProjections')) throw new Error('the plugin must inject sessionProjections')
apply(fakeCtx)
if (registered !== definition) throw new Error('apply did not register the definition')
if (registered.key !== 'contextUsage' || registered.stateVersion !== 2) throw new Error('unexpected projection identity')
if (registered.wire.summary !== false) throw new Error('the unit must stay out of compaction prompts')
const panelRoute = routes.get(PANEL_ROUTE)
if (!panelRoute || panelRoute.kind !== 'exact') throw new Error('apply did not register the panel route')
if (!routes.has(BALANCE_ROUTE)) throw new Error('apply did not register the balance route')
await fakeCtx.lastDisposer()
if (!released) throw new Error('the effect disposer never released the registration')
console.log('wiring: registered + releasable')

/* The route answers GET with the remembered toggles and records POSTs. It is
 * pointed at a scratch file so a smoke test never touches the real state. */
{
  const { tmpdir } = await import('node:os')
  const { rmSync } = await import('node:fs')
  const { join } = await import('node:path')
  const scratch = join(tmpdir(), `cu-panels-${process.pid}.json`)
  process.env.DSH_CONTEXT_USAGE_PANELS = scratch
  const answer = async (method, body) => {
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
    const req = {
      method,
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk
      },
    }
    const res = {
      status: 0,
      headers: {},
      body: '',
      setHeader(name, value) { this.headers[name] = value },
      writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers ?? {}) },
      end(text) { if (text !== undefined) this.body = String(text) },
    }
    await panelRoute.handler(req, res)
    return res
  }
  const empty = await answer('GET')
  if (empty.status !== 200 || !empty.body.includes('"panels"')) throw new Error('GET did not answer JSON panels')
  const accepted = await answer('POST', { sessionId: 'session-check', open: true })
  if (accepted.status !== 200 || JSON.parse(accepted.body).ok !== true) throw new Error('POST was not accepted')
  const after = JSON.parse((await answer('GET')).body)
  if (after.panels['session-check'] !== true) throw new Error('POST was not remembered')
  const rejected = await answer('POST', { sessionId: '', open: 'yes' })
  if (rejected.status !== 400) throw new Error('a malformed POST must be rejected')
  const closed = await answer('POST', { sessionId: 'session-check', open: false })
  if (closed.status !== 200) throw new Error('closing was not accepted')
  delete process.env.DSH_CONTEXT_USAGE_PANELS
  rmSync(scratch, { force: true })
  console.log('route: GET/POST round trip ok')
}

/* The balance route maps a provider to its own account and answers with the
 * pill's payload. DeepSeek goes through the account service, the others through
 * a documented endpoint or an explicit "cannot be read" status. */
{
  const balanceRoute = routes.get(BALANCE_ROUTE)
  fakeScope.deepseekAccount = {
    async getBalance(meta) {
      if (meta.locale !== 'zh') throw new Error('client metadata was not forwarded')
      return { status: 'ready', value: [{ currency: 'CNY', balance: 12.34 }] }
    },
  }
  const ask = async (search) => {
    const req = { method: 'GET', url: `${BALANCE_ROUTE}${search}` }
    const res = {
      status: 0,
      headers: {},
      body: '',
      setHeader(name, value) { this.headers[name] = value },
      writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers ?? {}) },
      end(text) { if (text !== undefined) this.body = String(text) },
    }
    await balanceRoute.handler(req, res)
    return { status: res.status, body: JSON.parse(res.body) }
  }
  const deepseek = await ask('?provider=deepseek&locale=zh&tz=28800')
  if (deepseek.body.status !== 'ready' || deepseek.body.amount !== 12.34) {
    throw new Error(`deepseek balance was not probed: ${JSON.stringify(deepseek.body)}`)
  }
  const unsupported = await ask('?provider=openai')
  if (unsupported.body.status !== 'unsupported') throw new Error('openai must answer unsupported')
  const unknown = await ask('?provider=whatever')
  if (unknown.body.status !== 'unsupported') throw new Error('an unknown provider must answer unsupported')
  delete fakeScope.deepseekAccount
  console.log('route: balance probe ok')
}

let seq = 0
let state = definition.init()
const view = () => definition.wire.view(state)
const show = (label) => {
  const pub = view()
  console.log(
    label.padEnd(26),
    `sys=${pub.system} tools=${pub.tools} user=${pub.user} asst=${pub.assistant} tool=${pub.tool} comp=${pub.compact}`,
    `total=${pub.total} turn=+${pub.turn.total}`,
  )
}

function emit(type, data, extra) {
  seq += 1
  const event = { seq, type, data, ...extra }
  state = definition.apply(state, event)
  return event
}

const text = (value) => [{ type: 'text', text: value }]
const fifty = 'x'.repeat(50)

show('init')

/* No `turn/start` has been folded yet: whatever arrives is the context, but it
 * is not "this turn" until a baseline exists. */
emit('system/message', { turn: 1, step: 1, message: { role: 'system', content: text(fifty) } }, { surfaceOp: 'append' })
emit('developer/message', { turn: 1, step: 1, message: { role: 'developer', content: text(fifty) } }, { surfaceOp: 'append' })
emit('request/header', { header: { tools: [{ name: 'read' }, { name: 'write' }] }, reason: 'initial' })
show('system+developer+tools')

const user1 = emit('user/message', { role: 'user', content: text(fifty) }, { surfaceOp: 'append' })
const asst1 = emit(
  'assistant/message',
  { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'tool-call', name: 'read', arguments: JSON.stringify({ path: fifty }) }] } },
  { surfaceOp: 'append' },
)
const tool1 = emit('tool/result', { turn: 1, step: 1, message: { role: 'tool', content: text(fifty) } }, { surfaceOp: 'append' })
show('one message round (no baseline)')

/* A baseline: the deltas must restart from here. */
emit('turn/start', { turn: 2 })
show('turn/start (2)')

emit('user/message', { role: 'user', content: text(fifty) }, { surfaceOp: 'append' })
show('user only (+1 turn)')

/* Compaction: shadow the first round, then replace it with a summary. */
emit('compaction/summary', {
  shadowedSeqs: [user1.seq, asst1.seq, tool1.seq],
  shadowedRange: { start: user1.seq, end: tool1.seq },
  shadowedTokenCount: 120,
  summary: 'round one, condensed',
})
show('after compaction event')

emit(
  'user/message',
  { role: 'user', content: text(fifty + fifty) },
  { surfaceOp: { op: 'replace', startSeq: user1.seq, endSeq: tool1.seq }, sourceEventSeqs: [user1.seq, asst1.seq, tool1.seq] },
)
show('summary in place')

/* A tool header that drops its tools must go back to zero. */
emit('request/header', { header: {} })
show('tools dropped')

/* Regression (2026-11-14): a developer control message used to land in `sys`
 * and shadow the real system prompt — sessions that announced a tool removal
 * right after the prompt showed "system prompt 74". It must book into the tools
 * bucket and leave the system price untouched, then the next header clears it. */
emit('system/message', { turn: 3, step: 1, message: { role: 'system', content: text(fifty) } }, { surfaceOp: 'append' })
const systemBefore = view().system
emit(
  'developer/message',
  { turn: 3, step: 1, message: { role: 'developer', content: [{ type: 'tool-removal', name: 'write' }, { type: 'text', text: 'yy' }] } },
  { surfaceOp: 'append' },
)
const afterControl = view()
if (afterControl.system !== systemBefore) {
  console.error(`developer control replaced the system prompt: ${systemBefore} -> ${afterControl.system}`)
  process.exit(1)
}
if (afterControl.tools <= 0) {
  console.error('developer control was not priced into the tools bucket')
  process.exit(1)
}
emit('request/header', { header: {} })
if (view().tools !== 0) {
  console.error(`the header did not clear the control estimate: tools=${view().tools}`)
  process.exit(1)
}

const pub = view()
console.log('\nfinal view:', JSON.stringify(pub))
console.log('same reference on unrelated event:', (() => {
  const before = state
  state = definition.apply(state, { seq: seq + 1, type: 'step/start', data: { turn: 2, step: 2 } })
  return before === state
})())

const sum = pub.system + pub.tools + pub.user + pub.assistant + pub.tool + pub.compact
if (sum !== pub.total) {
  console.error(`bucket sum ${sum} !== total ${pub.total}`)
  process.exit(1)
}
if (pub.turn.total === 0) {
  console.error('a turn delta was expected after the second turn/start')
  process.exit(1)
}
console.log('assertions: ok')
