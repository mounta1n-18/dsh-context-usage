/**
 * Headless render check for the `contextUsage` panel.
 *
 * Loads `client.js` with a stub module loader, a minimal `React` (element trees
 * instead of a DOM) and a stub `document`, then renders the card body for a
 * synthetic session so the bucket widths, the rescaling and the legend values
 * can be asserted without a browser.
 *
 *   $env:ELECTRON_RUN_AS_NODE=1; & "C:\...\DeepSeek Harness.exe" scripts\check-client.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

let captured
const window = { __ModuleLoader__: { load: (definition) => { captured = definition } } }
const document = {
  visibilityState: 'visible',
  createElement: () => ({ dataset: {}, textContent: '' }),
  head: { appendChild: () => {} },
  addEventListener: () => {},
  removeEventListener: () => {},
}

globalThis.__CU_TEST__ = true

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  Fragment: Symbol.for('react.fragment'),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
}

const requireStub = (id) => {
  if (id === 'react') return React
  if (id === 'react-dom') return { createPortal: node => node }
  throw new Error(`unexpected require(${id})`)
}

/* eslint-disable-next-line no-new-func */
const run = new Function('window', 'document', 'require', source)
run(window, document, requireStub)

if (captured === undefined) throw new Error('the module loader was never called')
const plugin = captured.factory(requireStub)
console.log('plugin injects:', plugin.inject.join(', '))

const api = globalThis.__CU_EXPORTS__
if (api === undefined) throw new Error('the test hook never ran')

const t = (key) => key

/* 6 buckets priced from the log, rescaled onto a reported 101.4K / 1M. */
const pressure = { projectedTokens: 101400, pressureTokens: 101400, contextWindow: 1000000 }
const detail = {
  version: 1,
  system: 3200,
  tools: 13500,
  user: 21000,
  assistant: 180000,
  tool: 98600,
  compact: 0,
  total: 316300,
  turn: { system: 0, tools: 0, user: 6200, assistant: 41000, tool: 22000, compact: 0, total: 69200 },
}
const usage = { uncachedInputTokens: 377000, cacheReadTokens: 25700000, outputTokens: 183800 }
const session = { turns: 6, steps: 274, decodeTokens: 203000, decodeMs: 1000 }

const model = api.usageModel(pressure, detail, undefined)
const sum = model.buckets.reduce((total, bucket) => total + bucket.value, 0)
console.log('\nbuckets (rescaled):')
for (const bucket of model.buckets) {
  console.log(
    '  ',
    bucket.key.padEnd(10),
    `raw=${Math.round(bucket.raw)}`.padEnd(12),
    `shown=${Math.round(bucket.value)}`.padEnd(14),
    `delta=${Math.round(bucket.delta)}`,
  )
}
console.log('  sum(shown)=', Math.round(sum), ' used=', model.used, ' free=', Math.round(model.free))
console.log('  deltaTotal=', Math.round(model.deltaTotal))

/* Render: expand function components until only host (string) elements remain. */
function expand(node) {
  if (node === null || node === undefined || node === false) return []
  if (Array.isArray(node)) return node.flatMap(expand)
  if (typeof node !== 'object') return [node]
  if (typeof node.type === 'function') return expand(node.type(Object.assign({}, node.props, { children: node.children })))
  const children = (node.children || []).flatMap(expand)
  return [{ type: node.type, props: node.props, children }]
}

function walk(nodes, depth = 0) {
  for (const node of nodes) {
    if (typeof node !== 'object') continue
    const label = node.props['data-bucket'] || node.props['data-context-usage'] || ''
    const width = node.props.style && node.props.style.width ? ` width=${node.props.style.width}` : ''
    if (label || width) console.log(`${'  '.repeat(depth + 1)}<${node.type}${label ? ` ${label}` : ''}${width}>`)
    walk(node.children, depth + 1)
  }
}

const body = api.bodyChildren({ t, pressure, detail, breakdown: undefined, usage, session })
console.log('\nrendered bands:')
walk(expand(body))

/* Guard rails: the legend must sum to the reported occupancy, and no bucket may
 * carry a "this turn" sliver wider than itself. */
if (Math.abs(sum - model.used) > 1) throw new Error(`buckets sum ${Math.round(sum)} != used ${model.used}`)
for (const bucket of model.buckets) {
  if (bucket.delta > bucket.value + 1) throw new Error(`${bucket.key} delta ${bucket.delta} > value ${bucket.value}`)
}

/* No projection at all (older Host half): three legacy buckets, no crash. */
const legacy = api.usageModel(pressure, undefined, { systemTokens: 3200, toolsTokens: 13500, messageTokens: 299700 })
console.log('\nlegacy buckets:', legacy.buckets.map((bucket) => `${bucket.key}=${Math.round(bucket.value)}`).join(' '))
const legacyBody = api.bodyChildren({ t, pressure, detail: undefined, breakdown: { systemTokens: 3200, toolsTokens: 13500, messageTokens: 299700 }, usage, session })
console.log('legacy bands:', expand(legacyBody).map((node) => node.type).join(', '))

/* Before the first request there is no capacity, so the card shows one line. */
const empty = api.bodyChildren({ t, pressure: undefined, detail: undefined, breakdown: undefined, usage: undefined, session: undefined })
console.log('empty bands:', expand(empty).map((node) => node.type).join(', '))

/* Real session: fold the log through the Host unit, then render the panel the
 * way the browser does — measured occupancy as the truth, buckets scaled onto
 * it. Pass a `session.v4.jsonl.zstd` path as the first argument. */
const sessionPath = process.argv[2]
if (sessionPath !== undefined) {
  const { definition } = await import('../index.js')
  const { replay } = await import('./session-frames.mjs')
  const result = replay(sessionPath, definition)
  const folded = definition.wire.view(result.state)
  const measured = result.prompt
  const capacity = result.context && Number.isFinite(result.context.contextWindow)
    ? result.context.contextWindow
    : 1048576
  console.log('\nreal session:', result.lines, 'lines')
  console.log('  folded:', JSON.stringify(folded))
  console.log('  measured prompt:', measured, ' capacity:', capacity)
  if (measured !== undefined) {
    const real = api.usageModel({ pressureTokens: measured, projectedTokens: measured, contextWindow: capacity }, folded, undefined)
    console.log('  rendered buckets:')
    for (const bucket of real.buckets) {
      console.log('   ', bucket.key.padEnd(10), `raw=${Math.round(bucket.raw)}`.padEnd(16), `shown=${Math.round(bucket.value)}`.padEnd(16), `delta=${Math.round(bucket.delta)}`)
    }
    const rendered = real.buckets.reduce((total, bucket) => total + bucket.value, 0)
    console.log('    sum(shown)=', Math.round(rendered), ' used=', real.used, ` (${((rendered / real.used) * 100).toFixed(1)}%)`)
    console.log('    turn delta=', Math.round(real.deltaTotal), ' bar segments=', real.painted.map((bucket) => bucket.key).join('+'))
    if (Math.abs(rendered - real.used) > 1) throw new Error(`real buckets sum ${Math.round(rendered)} != used ${real.used}`)
    walk(expand(api.bodyChildren({ t, pressure: { pressureTokens: measured, projectedTokens: measured, contextWindow: capacity }, detail: folded, breakdown: undefined, usage, session })))
  }
}

