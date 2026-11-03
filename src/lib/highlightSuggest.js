// Server only: asking the model which notes are worth highlighting. Nothing is stored and nothing on the board changes: the
// owner gets suggestions back and highlights the ones they accept with the ordinary highlight action.
// Same family as themeSuggest.js: 5 an hour per board and 40 a day per owner, counted SEPARATELY from summaries and themes (own
// keys); a slot is given back only when nothing was billed (nothing sent, or the provider rejected the request). The one parse
// retry is inside the slot. Only the notes' text leaves the server (see ai/input.js), never an author.
import { getStore } from './store.js'
import { getProvider } from './ai/provider.js'
import { buildHighlightInput, parseHighlights } from './ai/highlights.js'
import { aiReady, aiMessage } from './aiBoard.js'
import { isHighlighted } from './highlight.js'
import { windowHit, windowRefund, retryAfterSecs } from './http.js'

const BOARD_WINDOW_MS = 60 * 60_000
const BOARD_MAX = 5
const OWNER_WINDOW_MS = 24 * 60 * 60_000
const OWNER_MAX = 40
const LIMITS = { localFallback: true }
const STATUS = { busy: 503, unavailable: 503, misconfigured: 503, timeout: 504, empty: 502 }
export const NOT_CONFIGURED = "AI isn't set up on this server"
export const BAD_REPLY = 'The AI did not return highlights in a form we can use. Try again.'

const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra })

// -> { ok: true, suggestions: [{ id, reason }], model } | { ok: false, status, error, code?, retryAfter? }
export async function generateHighlights(code, { store = getStore(), provider = getProvider() } = {}) {
  const board = await store.getBoard(code)
  if (!board) return fail(404, 'Board not found')
  if (board.type === 'event') return fail(409, 'Highlights are for boards with notes')
  if (!aiReady(board)) return fail(403, 'AI is off for this board')
  if (!provider?.suggestHighlights) return fail(503, NOT_CONFIGURED)
  const items = await store.listItems(code)
  const input = buildHighlightInput(items, { boardTitle: board.title })
  if (!input.count) return fail(409, 'There are no notes to pick from yet')

  const bKey = `aihl:b:${code}`
  const oKey = `aihl:u:${board.ownerId}`
  const refund = () => Promise.all([windowRefund(bKey, BOARD_WINDOW_MS), windowRefund(oKey, OWNER_WINDOW_MS)])
  if ((await windowHit(bKey, BOARD_WINDOW_MS, LIMITS)) > BOARD_MAX) {
    await windowRefund(bKey, BOARD_WINDOW_MS)
    return fail(429, 'Too many highlight suggestions for this board. Try again later.', { retryAfter: retryAfterSecs(BOARD_WINDOW_MS), code: 'limit' })
  }
  if ((await windowHit(oKey, OWNER_WINDOW_MS, LIMITS)) > OWNER_MAX) {
    await refund()
    return fail(429, 'Too many highlight suggestions today. Try again tomorrow.', { retryAfter: retryAfterSecs(OWNER_WINDOW_MS), code: 'limit' })
  }

  let picks = null
  let errorCode = 'empty'
  let model = null
  for (let attempt = 0; attempt < 2 && !picks; attempt++) { // a reply that is not usable JSON gets one more try
    let result
    try { result = await provider.suggestHighlights(input) } catch { result = { error: 'unavailable' } }
    if (result?.error) { errorCode = result.error; if (errorCode !== 'empty') break; continue }
    model = result?.model ?? null
    picks = parseHighlights(result?.text, input.ids)
    if (!picks) errorCode = 'bad_reply'
  }
  if (!picks) {
    if (errorCode === 'misconfigured') await refund() // a rejected request is not billed; everything else may have been
    return errorCode === 'bad_reply' ? fail(502, BAD_REPLY, { code: 'bad_reply' }) : fail(STATUS[errorCode] ?? 503, aiMessage(errorCode), { code: errorCode })
  }

  const current = await store.getBoard(code)
  if (!current) return fail(404, 'Board not found')
  if (!aiReady(current)) return fail(409, 'AI was switched off while highlights were being picked, so they were dropped', { code: 'discarded' })
  // A note that is highlighted by now (or gone) is not worth suggesting again.
  const live = new Map((await store.listItems(code)).filter((i) => !i.deleted).map((i) => [i.id, i]))
  const suggestions = picks.filter((p) => live.has(p.id) && !isHighlighted(live.get(p.id)))
  return { ok: true, suggestions, model }
}
