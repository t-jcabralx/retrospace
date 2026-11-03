// When the "please support Retrospace" pop-up shows, and how it remembers it has. Pure: the storage is passed in, so it is
// testable and never throws (private windows and blocked storage just mean it may show again).
import { stageKey } from './retro.js'

export const SHOW_DELAY_MS = 1500 // a moment after the end is reached, so it does not land on top of the last thing someone is reading

// Giphy ids, all rated G: puppy-dog eyes, "please", a sad one and a crying one. One is picked each time the pop-up opens.
export const SUPPORT_GIFS = ['ffzhLUixCtlsc', 'zZbf6UpZslp3nvFjIR', 'sXv0vaA4331Ti', 'zwSW1fSFQQqp4oAn6k']
export const gifUrl = (id) => `https://media.giphy.com/media/${id}/200.gif`
export const pickGif = (rand = Math.random) => SUPPORT_GIFS[Math.min(SUPPORT_GIFS.length - 1, Math.floor(rand() * SUPPORT_GIFS.length))]

const SEEN = 'retrospace-support-seen:'
const OPT_OUT = 'retrospace-support-optout'

// Why the board has reached its end, or null while it has not: a retro on its last stage ("review-end"), or any board that was
// closed ("closed").
export function promptReason(board) {
  if (!board) return null
  if (board.type === 'retro' && board.retro && stageKey(board.retro) === 'wrapup') return 'review-end'
  if (board.status === 'closed') return 'closed'
  return null
}

const safe = (fn, fallback) => { try { return fn() } catch { return fallback } }
export const browserStorage = () => safe(() => globalThis.localStorage ?? null, null)

// Show it at the end of a board, once for each board in a browser, and never for someone who chose "don't show this again".
export function shouldShow({ board, code, storage = browserStorage() }) {
  if (!promptReason(board) || !code) return false
  if (!storage) return true
  if (safe(() => storage.getItem(OPT_OUT), null) === '1') return false
  return safe(() => storage.getItem(SEEN + code), null) === null
}

export const markSeen = (code, storage = browserStorage()) => { safe(() => storage?.setItem(SEEN + code, String(Date.now()))) }
export const optOut = (storage = browserStorage()) => { safe(() => storage?.setItem(OPT_OUT, '1')) }
