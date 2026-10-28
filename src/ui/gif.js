// Pure helpers for the GIF picker. Only an https URL and its pixel size ever leave the Giphy result: nothing else of the
// API response, and never the key, is stored on a card.
import { IMG_URL } from '../lib/validate.js'

export const SEARCH_DEBOUNCE_MS = 400
export const GIPHY_OPTIONS = Object.freeze({ rating: 'pg-13', lang: 'en' })
export const GIPHY_ATTRIBUTION = 'Powered by GIPHY' // Giphy's brand rule for apps that show its results
export const GIPHY_DISCLOSURE = 'Searching sends your query to Giphy.'
const MAX_LINK = 2000

const httpsUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) && IMG_URL.test(u) ? u : null)
const side = (n) => {
  const v = Math.round(Number(n))
  return Number.isFinite(v) && v >= 1 && v <= 4000 ? v : null
}

// A Giphy result (IGif) -> { url, w, h }, or null when it has no https rendition. fixed_height first, then downsized.
export function pickGif(result) {
  const images = result && typeof result === 'object' ? result.images : null
  if (!images || typeof images !== 'object') return null
  for (const name of ['fixed_height', 'downsized']) {
    const r = images[name]
    const url = httpsUrl(r?.url)
    if (url) return { url, w: side(r.width), h: side(r.height) }
  }
  return null
}

// A pasted link -> { ok: true, url } | { ok: false, error }. The same rule the server applies to card.gif (IMG_URL), narrowed
// to https.
export function checkGifLink(raw) {
  const link = typeof raw === 'string' ? raw.trim() : ''
  if (!link) return { ok: false, error: 'Paste a link that starts with https://' }
  if (/^http:\/\//i.test(link)) return { ok: false, error: 'GIF links must start with https://' }
  let host = ''
  try { host = new URL(link).hostname } catch { /* not a URL */ }
  if (!httpsUrl(link) || /\s/.test(link) || !host) return { ok: false, error: 'That does not look like a web link. Paste an address that starts with https://' }
  if (link.length > MAX_LINK) return { ok: false, error: 'That link is too long' }
  return { ok: true, url: link }
}
