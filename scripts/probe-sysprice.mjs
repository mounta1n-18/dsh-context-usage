/* Probe: price every system-category node the way the projection does, and show
 * the last few in order, so we can name the node that wins `liveSystem`.
 * Usage: node scripts/probe-sysprice.mjs <session.v4.jsonl.zstd> [tail] */
import { decodeFrames } from './session-frames.mjs'

const CHARS = 4, BLOCK = 4, ROLE = 4
const len = (s) => (typeof s === 'string' ? s.length : 0)
const t = (chars) => Math.ceil(chars / CHARS)

function blockPrice(block) {
  if (block === null || typeof block !== 'object') return 0
  if (block.type === 'text' || block.type === 'reasoning') return t(len(block.text)) + BLOCK
  if (block.type === 'tool-call') return t(len(block.name)) + t(len(block.arguments)) + BLOCK
  let json = '{}'
  try { json = JSON.stringify(block) } catch { json = '' }
  return BLOCK + t(len(json))
}
function price(message) {
  const content = message?.content
  if (!Array.isArray(content) || content.length === 0) return 0
  let sum = 0
  for (const b of content) sum += blockPrice(b)
  return sum + ROLE
}

const path = process.argv[2]
const tail = Number(process.argv[3] ?? 8)
const rows = []
for (const line of decodeFrames(path).split('\n')) {
  if (!line) continue
  let row
  try { row = JSON.parse(line) } catch { continue }
  const event = row.event ?? row
  if (!event || typeof event.type !== 'string') continue
  const isSys = event.type === 'system/message' || event.type === 'developer/message'
  if (!isSys) continue
  const msg = event.data?.message
  const blocks = Array.isArray(msg?.content) ? msg.content.map((b) => b?.type ?? typeof b) : []
  rows.push({
    seq: Number(event.seq), type: event.type, op: event.surfaceOp ?? '-',
    blocks: blocks.join(','), chars: (msg?.content ?? []).map((b) => len(b?.text ?? '')).reduce((a, b) => a + b, 0),
    price: price(msg),
    head: (msg?.content ?? []).map((b) => (b?.text ?? '').replace(/\s+/g, ' ')).join(' ').slice(0, 60),
  })
}
console.log('system-category nodes:', rows.length)
for (const r of rows.slice(-tail)) {
  console.log(`seq=${r.seq} ${r.type} op=${r.op} price=${r.price} chars=${r.chars} blocks=[${r.blocks}] | ${r.head}`)
}
console.log('liveSystem would be:', rows.length ? rows[rows.length - 1].price : 0)
