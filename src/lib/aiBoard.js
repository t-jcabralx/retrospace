// What a board stores about AI summaries and what each viewer may see of it. Pure. The rule that matters: a DRAFT
// summary, the AI settings and any failure detail are the owner's alone; everyone else gets only a shared summary and a
// plain "generating or not". Every transport (snapshot, /since, the stream broadcast, the reveal route) builds its board
// through viewerBoard() in access.js, which calls guestAiView / ownerAiView below.
export const MAX_SUMMARY = 4000
export const STALE_MS = 60_000 // a "generating" flag older than this is a request that died: it no longer blocks anything
export const AI_DEFAULTS = { enabled: false, ackAt: null, autoSummary: false, autoShare: false }

// What the owner is told when a summary could not be written (the codes the server stores and returns).
export const AI_MESSAGES = {
  busy: 'The AI service is busy right now. Try again in a minute.',
  unavailable: 'The AI service could not be reached. Try again in a moment.',
  misconfigured: 'AI is not set up correctly on this server, so a summary cannot be written.',
  timeout: 'The AI took too long to answer. Try again.',
  empty: 'The AI did not write anything. Try again.',
  limit: 'You have reached the limit for summaries. Try again later.',
}
export const aiMessage = (code) => AI_MESSAGES[code] ?? AI_MESSAGES.unavailable

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export const aiOf = (board) => ({ ...AI_DEFAULTS, ...(isObj(board?.ai) ? board.ai : {}) })
// AI may write for this board only when the owner switched it on after seeing the notice.
export const aiReady = (board) => { const a = aiOf(board); return Boolean(a.enabled && a.ackAt) }
export const summaryKind = (type) => (type === 'celebration' ? 'celebration' : type === 'retro' ? 'retro' : 'workshop')

// 'idle' | 'generating' | 'failed' (a stale 'generating' counts as failed: the owner can retry).
export function summaryStateOf(board, now = Date.now()) {
  if (board?.summaryState === 'generating') return now - (Number(board.summaryStartedAt) || 0) > STALE_MS ? 'failed' : 'generating'
  return board?.summaryState === 'failed' ? 'failed' : 'idle'
}

// Control characters and invisible bidi / zero-width marks go (newlines and tabs stay), CRLF becomes LF, and runs of blank lines collapse. -> '' when nothing is left.
export function cleanSummaryText(raw) {
  if (typeof raw !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

// themeSuggestions / themesState / themesStartedAt: the owner reads them from GET /themes only, never from a board view.
const INTERNAL = ['summaryStartedAt', 'autoSummaryFor', 'closedAt', 'summaryError', 'themeSuggestions', 'themesState', 'themesStartedAt']

// What a non-owner may see. Only a SHARED summary, never `model`, never a failure.
export function guestAiView(board, out) {
  const rest = { ...out }
  for (const k of ['ai', ...INTERNAL]) delete rest[k]
  const s = board.summary
  rest.summary = isObj(s) && s.status === 'shared' ? { text: s.text, status: 'shared', source: s.source === 'manual' ? 'manual' : 'ai', editedAt: s.editedAt ?? null } : null
  rest.summaryState = summaryStateOf(board) === 'generating' ? 'generating' : 'idle'
  return rest
}

// The owner sees everything (defaults filled in for boards made before AI existed), minus the bookkeeping fields.
export function ownerAiView(board, out) {
  const rest = { ...out }
  for (const k of INTERNAL) delete rest[k]
  const state = summaryStateOf(board)
  rest.ai = aiOf(board)
  rest.summary = isObj(board.summary) ? board.summary : null
  rest.summaryState = state
  if (state === 'failed') rest.summaryError = board.summaryState === 'generating' ? 'timeout' : board.summaryError || 'unavailable'
  return rest
}
