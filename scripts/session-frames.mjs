/**
 * Read a DSH session log and fold it through a projection.
 *
 * The log is a multi-frame zstd stream (one frame per append batch), which
 * `zlib`'s streaming decoder cannot walk: it stops after the first frame with
 * `Unknown frame descriptor`. So the file is split on the frame magic instead
 * and every frame is decoded on its own.
 *
 * Shared by `scripts/replay-session.mjs` and `scripts/check-client.mjs`.
 */

import fs from 'node:fs'
import zlib from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * Decode every zstd frame in one file.
 * @param path - the session log.
 * @returns the concatenated JSONL text.
 */
export function decodeFrames(path) {
  const buf = fs.readFileSync(path)
  const offsets = []
  for (let index = 0; index <= buf.length - MAGIC.length; index += 1) {
    if (buf.compare(MAGIC, 0, MAGIC.length, index, index + MAGIC.length) === 0) offsets.push(index)
  }
  const parts = []
  let index = 0
  while (index < offsets.length) {
    let end = index + 1 < offsets.length ? offsets[index + 1] : buf.length
    let decoded
    let cursor = index
    for (;;) {
      try {
        decoded = zlib.zstdDecompressSync(buf.subarray(offsets[cursor], end))
        break
      } catch (error) {
        /* A magic-looking byte inside a frame body: widen to the next boundary. */
        cursor += 1
        if (cursor >= offsets.length) throw error
        end = cursor + 1 < offsets.length ? offsets[cursor + 1] : buf.length
      }
    }
    parts.push(decoded)
    index = cursor + 1
  }
  return Buffer.concat(parts).toString('utf8')
}

/**
 * Fold every session event in a log through a projection definition.
 * @param path - the session log.
 * @param definition - the projection definition (init / apply / wire).
 * @returns the final state, the event counts, and what the provider reported.
 */
export function replay(path, definition) {
  const lines = decodeFrames(path).split('\n').filter((line) => line.length > 0)
  const counts = new Map()
  let state = definition.init()
  let prompt
  let context
  for (const line of lines) {
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const event = row.event ?? row
    if (event === null || typeof event !== 'object' || typeof event.type !== 'string') continue
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1)
    if (event.type === 'request/context') context = event.data
    if (event.type === 'assistant/message') {
      const usage = event.data === null || event.data === undefined ? undefined : event.data.usage
      if (usage !== undefined && usage !== null) {
        const cached = usage.cacheReadTokens ?? usage.cacheReadInputTokens ?? 0
        const uncached = usage.inputTokens ?? usage.uncachedInputTokens ?? 0
        if (cached + uncached > 0) prompt = cached + uncached
      }
    }
    const next = definition.apply(state, event)
    if (next !== undefined) state = next
  }
  return { lines: lines.length, counts, state, prompt, context }
}
