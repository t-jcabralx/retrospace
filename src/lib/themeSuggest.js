// Server only: asking the model to group a retro board's notes into themes, and the owner's edits of what came back.
//   board.themeSuggestions { themes: [{ id, title, noteIds }], generatedAt, model } | null   (OWNER-ONLY, never in any board view)
//   board.themesState      'idle' | 'generating'  (+ themesStartedAt)
// Same family as summary.js: 5 an hour per board and 40 a day per owner, counted SEPARATELY from summaries (own keys), a slot is
// given back only when nothing was billed (nothing sent, or the provider rejected the request). The one parse retry is inside the slot.
import { getStore } from './store.js'
import { getProvider } from './ai/provider.js'
import { buildThemeInput, parseThemes, withIds, editSuggestions } from './ai/themes.js'
import { aiReady, aiMessage, STALE_MS } from './aiBoard.js'
import { forgetBoard } from './boardCache.js'
import { windowHit, windowRefund, retryAfterSecs } from './http.js'

const BOARD_WINDOW_MS = 60 * 60_000
const BOARD_MAX = 5
const OWNER_WINDOW_MS = 24 * 60 * 60_000
const OWNER_MAX = 40
const LIMITS = { localFallback: true }
const STATUS = { busy: 503, unavailable: 503, misconfigured: 503, timeout: 504, empty: 502 }
export const NOT_CONFIGURED = "AI isn't set up on this server"
export const BAD_REPLY = 'The AI did not return themes in a form we can use. Try again.'

const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra })

// What the owner's panel sees: the suggestions and whether a request is in flight (a stale flag counts as idle).
export function themesView(board, now = Date.now()) {
  const generating = board?.themesState === 'generating' && now - (Number(board.themesStartedAt) || 0) <= STALE_MS
  return { suggestions: board?.themeSuggestions ?? null, themesState: generating ? 'generating' : 'idle' }
}

// -> { ok: true, suggestions } | { ok: false, status, error, code?, retryAfter? }
export async function generateThemes(code, { store = getStore(), now = Date.now(), provider = getProvider() } = {}) {
  const board = await store.getBoard(code)
  if (!board) return fail(404, 'Board not found')
  if (board.type !== 'retro') return fail(409, 'Themes are for retro boards')
  if (!aiReady(board)) return fail(403, 'AI is off for this board')
  if (!provider?.suggestThemes) return fail(503, NOT_CONFIGURED)
  const input = buildThemeInput(await store.listItems(code), { boardTitle: board.title })
  if (!input.count) return fail(409, 'Nothing to group yet')

  const bKey = `aithm:b:${code}`
  const oKey = `aithm:u:${board.ownerId}`
  const refund = () => Promise.all([windowRefund(bKey, BOARD_WINDOW_MS), windowRefund(oKey, OWNER_WINDOW_MS)])
  if ((await windowHit(bKey, BOARD_WINDOW_MS, LIMITS)) > BOARD_MAX) {
    await windowRefund(bKey, BOARD_WINDOW_MS)
    return fail(429, 'Too many theme suggestions for this board. Try again later.', { retryAfter: retryAfterSecs(BOARD_WINDOW_MS), code: 'limit' })
  }
  if ((await windowHit(oKey, OWNER_WINDOW_MS, LIMITS)) > OWNER_MAX) {
    await refund()
    return fail(429, 'Too many theme suggestions today. Try again tomorrow.', { retryAfter: retryAfterSecs(OWNER_WINDOW_MS), code: 'limit' })
  }
  const taken = await store.claimThemes(code, { now, staleMs: STALE_MS })
  if (!taken) { await refund(); return fail(409, 'Already suggesting themes') }
  const idle = async () => { await store.updateBoard(code, { themesState: 'idle', themesStartedAt: null }); forgetBoard(code) }

  let themes = null
  let errorCode = 'empty'
  let model = null
  for (let attempt = 0; attempt < 2 && !themes; attempt++) { // a reply that is not usable JSON gets one more try
    let result
    try { result = await provider.suggestThemes(input) } catch { result = { error: 'unavailable' } }
    if (result?.error) { errorCode = result.error; if (errorCode !== 'empty') break; continue }
    model = result?.model ?? null
    themes = parseThemes(result?.text, input.ids)
    if (!themes) errorCode = 'bad_reply'
  }
  if (!themes) {
    if (errorCode === 'misconfigured') await refund() // a rejected request is not billed; everything else may have been
    await idle()
    return errorCode === 'bad_reply' ? fail(502, BAD_REPLY, { code: 'bad_reply' }) : fail(STATUS[errorCode] ?? 503, aiMessage(errorCode), { code: errorCode })
  }

  const current = await store.getBoard(code)
  if (!current) return fail(404, 'Board not found')
  if (!aiReady(current)) { await idle(); return fail(409, 'AI was switched off while themes were being suggested, so they were dropped', { code: 'discarded' }) }
  const suggestions = { themes: withIds(themes), generatedAt: now, model }
  await store.updateBoard(code, { themeSuggestions: suggestions, themesState: 'idle', themesStartedAt: null })
  forgetBoard(code)
  return { ok: true, suggestions }
}

// The owner's edit of the stored suggestions -> { ok: true, suggestions } | { ok: false, status, error }.
export async function editThemes(code, edit, { store = getStore() } = {}) {
  const board = await store.getBoard(code)
  if (!board) return fail(404, 'Board not found')
  const cur = board.themeSuggestions
  if (!cur) return fail(409, 'There are no suggestions')
  const r = editSuggestions(cur.themes, edit)
  if (!r.ok) return fail(400, r.error)
  const suggestions = { ...cur, themes: r.themes }
  await store.updateBoard(code, { themeSuggestions: suggestions })
  forgetBoard(code)
  return { ok: true, suggestions }
}
