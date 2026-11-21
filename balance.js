/**
 * Provider-aware account balance probing for the composer pill.
 *
 * The pill used to read one account — the DeepSeek platform grant this client
 * is signed into — no matter which model the Session actually runs. This module
 * answers the same question the pill asks, but per provider family: DeepSeek
 * through the account service, Moonshot and Zhipu through their documented
 * balance endpoints with an API key, and every other vendor with an honest
 * "no public balance endpoint" answer instead of a number borrowed from
 * somewhere else.
 *
 * Everything here is plain HTTP + a read of the local credential store: no
 * model call is involved, so a refresh costs no tokens.
 *
 * @module @local/dsh-context-usage/balance
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Route the browser polls; the Host owns the upstream call and the cache. */
export const BALANCE_ROUTE = '/__context-usage/balance'

/** How long one upstream answer is reused. Matches the pill's 1s poll so the
 * number on screen is never more than a tick behind the platform. */
export const BALANCE_CACHE_MS = 1_000

/** Upstream request budget; a slow vendor must not stall the poll. */
const BALANCE_TIMEOUT_MS = 8_000

/**
 * Vendor families, matched against the provider route id the Session selected.
 * Order matters: the first match wins.
 */
const FAMILIES = [
  [/deepseek/i, 'deepseek'],
  [/moonshot|kimi/i, 'moonshot'],
  [/zhipu|glm|bigmodel/i, 'zhipu'],
  [/dashscope|qwen|aliyun|bailian/i, 'qwen'],
  [/volc|doubao|seed|ark\b/i, 'volcengine'],
  [/hunyuan|\bhy\b|tencent/i, 'hunyuan'],
  [/anthropic|claude/i, 'anthropic'],
  [/openai|azure/i, 'openai'],
  [/google|gemini|vertex/i, 'gemini'],
  [/xai|grok/i, 'xai'],
]

/** Human names for the pill's tooltip. */
const FAMILY_NAMES = {
  deepseek: 'DeepSeek',
  moonshot: 'Moonshot',
  zhipu: '智谱',
  qwen: '通义千问',
  volcengine: '火山引擎',
  hunyuan: '腾讯混元',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  xai: 'xAI',
}

/** Where a family's balance lives, or why it cannot be read without billing keys. */
const NOTES = {
  qwen: 'DashScope 无余额接口，需阿里云 AK/SK 查账单',
  volcengine: '火山引擎需 AK/SK 签名查账单',
  hunyuan: '腾讯云需 SecretId/SecretKey 查账单',
  anthropic: 'Anthropic 无公开余额接口',
  openai: 'OpenAI 无公开余额接口（仅组织成本 API）',
  gemini: 'Gemini 走 GCP 账单',
  xai: 'xAI 无公开余额接口',
}

/** API key environment names per family, most specific first. */
const KEY_NAMES = {
  deepseek: ['DEEPSEEK_API_KEY'],
  moonshot: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
  zhipu: ['ZHIPU_API_KEY', 'GLM_API_KEY', 'BIGMODEL_API_KEY'],
}

/** Base URL overrides, so a gateway or an international endpoint still works. */
const BASE_NAMES = {
  deepseek: ['DEEPSEEK_API_BASE', 'DEEPSEEK_BASE_URL'],
  moonshot: ['MOONSHOT_API_BASE', 'MOONSHOT_BASE_URL'],
  zhipu: ['ZHIPU_API_BASE', 'GLM_BASE_URL'],
}

/** Default API roots. */
const BASE_URLS = {
  deepseek: 'https://api.deepseek.com',
  moonshot: 'https://api.moonshot.cn',
  zhipu: 'https://open.bigmodel.cn',
}

/** `{ at, payload }` per family. */
const cache = new Map()

/** In-flight upstream calls, so a burst of polls costs one request. */
const pending = new Map()

/**
 * Match a provider route to its billing family.
 * @param provider - the provider id from the Session's model selection.
 * @returns the family key, or undefined when nothing matches.
 */
export function familyOf(provider) {
  if (typeof provider !== 'string') return undefined
  for (const [pattern, family] of FAMILIES) if (pattern.test(provider)) return family
  return undefined
}

/**
 * Read the `refs:` block of the credential file — the plain secret references
 * the app keeps beside login grants.
 * @returns the reference map, empty when the file is unreadable.
 */
function credentialRefs() {
  try {
    const text = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
    const lines = text.split(/\r?\n/)
    const start = lines.findIndex((line) => /^refs:\s*$/.test(line))
    if (start < 0) return {}
    const refs = {}
    for (const line of lines.slice(start + 1)) {
      if (/^\S/.test(line)) break
      const match = /^\s{2,}([A-Za-z0-9_.-]+):\s*(.+?)\s*$/.exec(line)
      if (match) refs[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
    }
    return refs
  } catch {
    return {}
  }
}

/**
 * Resolve one family's secret: environment first, then the credential refs.
 * @param names - candidate names, most specific first.
 * @returns the secret, or undefined.
 */
function secretOf(names) {
  const refs = credentialRefs()
  for (const name of names) {
    const fromEnv = process.env[name]
    if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim()
    const fromFile = refs[name]
    if (typeof fromFile === 'string' && fromFile.trim().length > 0) return fromFile.trim()
  }
  return undefined
}

/**
 * Resolve a family's API root.
 * @param family - the billing family.
 * @returns the base URL without a trailing slash.
 */
function baseOf(family) {
  const override = secretOf(BASE_NAMES[family] || [])
  return (override || BASE_URLS[family]).replace(/\/+$/, '')
}

/**
 * GET JSON with a hard timeout.
 * @param url - absolute URL.
 * @param headers - request headers.
 * @returns the parsed body.
 */
async function getJson(url, headers) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`)
  return text.length === 0 ? {} : JSON.parse(text)
}

/**
 * Pick the first numeric field a vendor actually sent.
 * @param record - the response object.
 * @param names - candidate field names.
 * @returns the number, or undefined.
 */
function numberIn(record, names) {
  if (!record || typeof record !== 'object') return undefined
  for (const name of names) {
    const value = record[name]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  }
  return undefined
}

/**
 * DeepSeek: the platform account grant the client is signed into. There is no
 * API key involved — the Host holds the token — so this is the one family that
 * keeps working without any credential.
 * @param ctx - plugin context, read lazily for `deepseekAccount`.
 * @param client - client metadata the account endpoint expects.
 * @returns a probe result.
 */
async function probeDeepSeek(ctx, client) {
  /* `reflect.get` reads a service without declaring an inject edge, so this
   * route keeps working on hosts that do not wire an account service at all. */
  let account
  try {
    account = ctx && ctx.reflect && typeof ctx.reflect.get === 'function'
      ? ctx.reflect.get('deepseekAccount')
      : undefined
    if (!account && ctx) account = ctx.deepseekAccount
  } catch {
    account = undefined
  }
  if (!account || typeof account.getBalance !== 'function') {
    return { status: 'unsupported', detail: 'DeepSeek 账户服务不可用' }
  }
  const balance = await account.getBalance(client)
  if (balance === null || balance === undefined) return { status: 'signed-out' }
  if (balance.status !== 'ready') {
    return { status: 'error', detail: typeof balance.reason === 'string' ? balance.reason : '账户不可用' }
  }
  const wallets = Array.isArray(balance.value) ? balance.value : []
  const bonus = Array.isArray(balance.bonusWallets) ? balance.bonusWallets : []
  const wallet = wallets.find((entry) => entry && entry.currency === 'CNY')
    || wallets[0]
    || bonus.find((entry) => entry && entry.currency === 'CNY')
    || bonus[0]
  if (!wallet) return { status: 'empty' }
  const amount = Number(wallet.balance)
  if (!Number.isFinite(amount)) return { status: 'empty' }
  return { status: 'ready', amount, currency: wallet.currency === 'CNY' ? 'CNY' : 'USD' }
}

/**
 * Moonshot (Kimi): `GET /v1/users/me/balance` → `{data:{available_balance, currency}}`.
 * @param family - billing family.
 * @returns a probe result.
 */
async function probeMoonshot(family) {
  const key = secretOf(KEY_NAMES[family])
  if (!key) return { status: 'no-key', detail: '未配置 MOONSHOT_API_KEY' }
  const body = await getJson(`${baseOf(family)}/v1/users/me/balance`, { authorization: `Bearer ${key}` })
  const record = body && body.data ? body.data : body
  const amount = numberIn(record, ['available_balance', 'availableBalance', 'balance'])
  if (amount === undefined) return { status: 'empty', detail: '响应里没有余额字段' }
  const currency = typeof record.currency === 'string' && record.currency.length === 3 ? record.currency : 'CNY'
  return { status: 'ready', amount, currency }
}

/**
 * Zhipu (GLM): `GET /api/paas/v4/balance` → a `balance` amount in CNY.
 * @param family - billing family.
 * @returns a probe result.
 */
async function probeZhipu(family) {
  const key = secretOf(KEY_NAMES[family])
  if (!key) return { status: 'no-key', detail: '未配置 ZHIPU_API_KEY' }
  const body = await getJson(`${baseOf(family)}/api/paas/v4/balance`, { authorization: `Bearer ${key}` })
  const record = body && body.data ? body.data : body
  const amount = numberIn(record, ['balance', 'available_balance', 'availableBalance', 'total_balance'])
  if (amount === undefined) return { status: 'empty', detail: '响应里没有余额字段' }
  return { status: 'ready', amount, currency: 'CNY' }
}

/**
 * Probe one family, using the cache unless a refresh was asked for.
 * @param ctx - plugin context.
 * @param family - billing family.
 * @param client - client metadata for the account endpoint.
 * @param fresh - bypass the cache.
 * @returns the payload the pill renders.
 */
async function probe(ctx, family, client, fresh) {
  const hit = cache.get(family)
  const now = Date.now()
  if (!fresh && hit && now - hit.at < BALANCE_CACHE_MS) return hit.payload
  const running = pending.get(family)
  if (running) return running

  const task = (async () => {
    let result
    try {
      if (family === 'deepseek') result = await probeDeepSeek(ctx, client)
      else if (family === 'moonshot') result = await probeMoonshot(family)
      else if (family === 'zhipu') result = await probeZhipu(family)
      else result = { status: 'unsupported', detail: NOTES[family] || '该平台没有余额接口' }
    } catch (error) {
      result = { status: 'error', detail: error instanceof Error ? error.message.slice(0, 120) : 'probe failed' }
    }
    const payload = {
      family,
      name: FAMILY_NAMES[family] || family,
      at: Date.now(),
      ...result,
    }
    cache.set(family, { at: Date.now(), payload })
    return payload
  })().finally(() => {
    pending.delete(family)
  })

  pending.set(family, task)
  return task
}

/**
 * Parse the query string of one balance request.
 * @param raw - the request URL.
 * @returns the parsed parameters.
 */
function queryOf(raw) {
  const params = new URL(raw || '/', 'http://127.0.0.1').searchParams
  const provider = params.get('provider') || ''
  return {
    provider,
    model: params.get('model') || '',
    version: params.get('version') || '0.2.0-rc.2',
    locale: params.get('locale') || 'zh',
    timezoneOffsetSeconds: Number(params.get('tz') || '0') || 0,
    fresh: params.get('refresh') === '1',
  }
}

/**
 * Build the request handler the plugin registers on the Host web server.
 * @param ctx - plugin context.
 * @returns the `(req, res)` handler.
 */
export function createBalanceHandler(ctx) {
  return async function handleBalanceRoute(req, res) {
    res.setHeader('cache-control', 'no-store')
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end()
      return
    }
    const query = queryOf(req.url)
    const family = familyOf(query.provider)
    if (family === undefined) {
      const body = JSON.stringify({
        provider: query.provider,
        family: null,
        name: query.provider || '—',
        status: 'unsupported',
        detail: '未识别的 provider',
        at: Date.now(),
      })
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(req.method === 'HEAD' ? undefined : body)
      return
    }
    const payload = await probe(ctx, family, {
      version: query.version,
      locale: query.locale,
      timezoneOffsetSeconds: query.timezoneOffsetSeconds,
    }, query.fresh)
    const body = JSON.stringify({ provider: query.provider, model: query.model, ...payload })
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(req.method === 'HEAD' ? undefined : body)
  }
}
