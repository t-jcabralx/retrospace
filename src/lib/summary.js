// Server only: writing a board's AI summary. Shared by POST /api/boards/[code]/summary (the owner pressed Generate) and by
// the PATCH route (the board was just closed and the owner asked for an automatic summary).
//   board.summary      { text, status: 'draft' | 'shared', source, model, generatedAt, editedAt } or null
//   board.summaryState 'idle' | 'generating' | 'failed' (+ summaryStartedAt, summaryError)
// Only an automatic summary honours `ai.autoShare`; a button press always makes a draft the owner reviews first.
// The provider call holds no lock: the "generating" flag (claimed atomically by the store) is what stops a second one.
import { getStore } from './store.js'
import { getProvider } from './ai/provider.js'
import { buildSummaryInput } from './ai/input.js'
import { aiOf, aiReady, aiMessage, summaryKind, cleanSummaryText, STALE_MS } from './aiBoard.js'
import { viewerBoard } from './access.js'
import { publish } from './rt.js'
import { forgetBoard } from './boardCache.js'
import { publicIdForUser } from './guest.js'
import { windowHit, windowRefund, retryAfterSecs } from './http.js'

const BOARD_WINDOW_MS = 60 * 60_000
const BOARD_MAX = 5
const OWNER_WINDOW_MS = 24 * 60 * 60_000
const OWNER_MAX = 40
const LIMITS = { localFallback: true }
const STATUS = { busy: 503, unavailable: 503, misconfigured: 503, timeout: 504, empty: 502 }

export const NOT_CONFIGURED = "AI isn't set up on this server"

// Everyone watching the board hears about the new state, in the guest-safe view only (a draft never goes out).
export const globalDailyCap = () => {
  const n = Number(process.env.AI_DAILY_CAP)
  return Number.isFinite(n) && n >= 0 && process.env.AI_DAILY_CAP !== undefined && process.env.AI_DAILY_CAP !== '' ? n : 300
}

export async function announce(board, cid) {
  forgetBoard(board.code)
  await publish(board.code, { t: 'board', from: publicIdForUser(board.code, board.ownerId), ...(cid && { cid }), board: viewerBoard(board, 'guest') })
}

const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra })

// -> { ok: true, summary } | { ok: false, status, error, code?, retryAfter? }
// `claimed`: the caller already took the slot (the PATCH route does, so the owner sees "generating" at once); then every
// way out of here gives it back.
export async function generateSummary(code, { auto = false, claimed = false, cid, store = getStore(), now = Date.now(), provider = getProvider() } = {}) {
  const board = await store.getBoard(code)
  const release = async (state, errorCode) => {
    if (!claimed) return
    const next = await store.updateBoard(code, { summaryState: state, summaryError: errorCode ?? null, summaryStartedAt: null })
    if (next) await announce(next, cid)
  }
  const stop = async (res, state = 'idle', errorCode) => { await release(state, errorCode); return res }

  if (!board) return fail(404, 'Board not found')
  if (!aiReady(board)) return stop(fail(403, 'AI is off for this board'))
  if (!provider) return stop(fail(503, NOT_CONFIGURED), 'failed', 'misconfigured')
  const kind = summaryKind(board.type)
  const input = buildSummaryInput(await store.listItems(code), { kind, boardTitle: board.title })
  if (!input.count) return stop(fail(409, 'Nothing to summarise yet'))

  // Rate limits: 5 an hour per board, 40 a day per owner. A slot is given back only when nothing was sent to the provider (or it rejected the request).
  const bKey = `aisum:b:${code}`
  const oKey = `aisum:u:${board.ownerId}`
  const gKey = 'aisum:global'
  const refund = () => Promise.all([windowRefund(bKey, BOARD_WINDOW_MS), windowRefund(oKey, OWNER_WINDOW_MS), windowRefund(gKey, OWNER_WINDOW_MS)])
  if ((await windowHit(bKey, BOARD_WINDOW_MS, LIMITS)) > BOARD_MAX) {
    await windowRefund(bKey, BOARD_WINDOW_MS)
    return stop(fail(429, 'Too many summaries for this board. Try again later.', { retryAfter: retryAfterSecs(BOARD_WINDOW_MS), code: 'limit' }), 'failed', 'limit')
  }
  if ((await windowHit(oKey, OWNER_WINDOW_MS, LIMITS)) > OWNER_MAX) {
    await refund()
    return stop(fail(429, 'Too many summaries today. Try again tomorrow.', { retryAfter: retryAfterSecs(OWNER_WINDOW_MS), code: 'limit' }), 'failed', 'limit')
  }
  // One cap for the whole app, whoever asks: AI_DAILY_CAP summaries a day (default 300), a ceiling on spend that no single
  // owner or board can lift. Also set a spend limit in the Anthropic console.
  if ((await windowHit(gKey, OWNER_WINDOW_MS, LIMITS)) > globalDailyCap()) {
    await refund()
    return stop(fail(429, 'AI summaries are paused for today. Try again tomorrow.', { retryAfter: retryAfterSecs(OWNER_WINDOW_MS), code: 'limit' }), 'failed', 'limit')
  }

  // The summary as it stood when the slot was taken: the result is stored only if it still is that when the model answers, so an
  // owner's own edit made meanwhile is never overwritten. (Re-read and compare right before the write; the write itself is not
  // conditional, so a change in the one round-trip between the two could still lose to this result.)
  let baseline = signature(board)
  if (!claimed) {
    const taken = await store.claimSummary(code, { now, staleMs: STALE_MS })
    if (!taken) { await refund(); return fail(409, 'Already writing') }
    baseline = signature(taken)
    await announce(taken, cid)
  }

  let result
  try { result = await provider.summarize(input, { kind }) } catch { result = { error: 'unavailable' } }
  const text = result?.error ? '' : cleanSummaryText(result?.text) // same cleaning as the owner's own edits; nothing left means nothing written

  if (!text) {
    const errorCode = result?.error ?? 'empty'
    // A slot comes back only when the call cannot have produced a billable answer: a rejected request (misconfigured). A
    // timeout, an empty or an overloaded answer may well have been billed, so those keep their slot.
    if (errorCode === 'misconfigured') await refund()
    const next = await store.updateBoard(code, { summaryState: 'failed', summaryError: errorCode, summaryStartedAt: null })
    if (next) await announce(next, cid)
    return fail(STATUS[errorCode] ?? 503, aiMessage(errorCode), { code: errorCode })
  }

  // Things may have changed while the model was writing: look again before storing anything.
  const settle = async (res) => {
    const next = await store.updateBoard(code, { summaryState: 'idle', summaryError: null, summaryStartedAt: null })
    if (next) await announce(next, cid)
    return res
  }
  const current = await store.getBoard(code)
  if (!current) return fail(404, 'Board not found') // deleted while the summary was being written
  if (!aiReady(current)) return settle(fail(409, 'AI was switched off while the summary was being written, so it was dropped', { code: 'discarded' }))
  if (signature(current) !== baseline) return settle(fail(409, 'The summary was changed while it was being written, so the new one was dropped', { code: 'discarded' }))

  const share = auto && aiOf(current).autoShare // the setting as it is now, not as it was when the board was closed
  const summary = { text, status: share ? 'shared' : 'draft', source: 'ai', model: result.model ?? null, generatedAt: now, editedAt: null }
  const next = await store.updateBoard(code, { summary, summaryState: 'idle', summaryError: null, summaryStartedAt: null })
  if (!next) return fail(404, 'Board not found')
  await announce(next, cid)
  return { ok: true, summary }
}

// What identifies the stored summary for the "unchanged since" comparison.
const signature = (b) => JSON.stringify(b?.summary ?? null)

// Gives the writing slot back without a summary, and lets that closure be tried again (used when the background run could not be
// scheduled at all). -> the board, or null.
export async function releaseClaim(code, { store = getStore() } = {}) {
  const next = await store.updateBoard(code, { summaryState: 'idle', summaryError: null, summaryStartedAt: null, autoSummaryFor: null })
  if (next) await announce(next)
  return next
}
