/**
 * Replay a real session log through the `contextUsage` unit and compare the
 * folded total with what the provider actually reported for the request.
 *
 * Why the two do not match exactly: DSH's log keeps the whole history, while a
 * compressing proxy (billion-context and friends) rewrites the request body in
 * flight. The panel therefore keeps the measured occupancy as the truth and
 * scales the message buckets onto it — the ratio printed here is the size of
 * that correction.
 *
 * Usage:
 *   $env:ELECTRON_RUN_AS_NODE='1'
 *   & '<DeepSeek Harness.exe>' scripts\replay-session.mjs <session.v4.jsonl.zstd>
 */

import { replay } from './session-frames.mjs'
import { definition } from '../index.js'

const path = process.argv[2]
if (path === undefined) {
  console.error('usage: replay-session.mjs <session.v4.jsonl.zstd>')
  process.exit(1)
}

const result = replay(path, definition)
const view = definition.wire.view(result.state)
console.log(`${result.lines} log lines`)
console.log('event kinds:', [...result.counts.entries()].map(([key, value]) => `${key}=${value}`).join(' '))
console.log('folded view:', JSON.stringify(view))
if (result.prompt !== undefined) {
  const ratio = view.total > 0 ? view.total / result.prompt : 0
  console.log(`provider prompt on the last assistant message: ${result.prompt}`)
  console.log(`folded total: ${view.total} (${ratio.toFixed(3)}x of the provider prompt)`)
}
if (result.context !== undefined) {
  console.log('last request/context:', JSON.stringify(result.context).slice(0, 300))
}
