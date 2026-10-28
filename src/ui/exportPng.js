// PNG export of a board, client side (html-to-image). The pure helpers are unit-tested; exportPng itself needs a browser.
// What is drawn is a CLONE of the world layer, moved so the content's bounding box sits at the top left of an off-screen
// canvas-sized host: cursors, other people's selections, resize handles, drafts and editors are cut from the clone, and the
// minimap, toolbars and zoom live outside the world layer so they never appear. The host sits inside the board screen, so the
// colour tokens (and the dark theme, which follows the system) apply exactly as on screen.
export class ExportError extends Error {}

export const EXPORT_PAD = 48
export const EXPORT_RATIO = 2
export const EXPORT_MAX_SIDE = 4096

// Neutral stand-in for a picture that cannot be read (another site without CORS headers): the card text stays intact.
export const PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='120' viewBox='0 0 160 120'><rect width='160' height='120' fill='#e6e8ee'/><g fill='none' stroke='#9aa0b0' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'><rect x='50' y='35' width='60' height='50' rx='6'/><circle cx='68' cy='52' r='5'/><path d='M110 76L92 58L62 85'/></g></svg>",
)}`

const finite = (n) => typeof n === 'number' && Number.isFinite(n)

// Box of an item after its rotation (degrees, about its centre).
function itemBox(i) {
  if (!i.rot || !finite(i.rot)) return { x0: i.x, y0: i.y, x1: i.x + i.w, y1: i.y + i.h }
  const a = (i.rot * Math.PI) / 180
  const cx = i.x + i.w / 2
  const cy = i.y + i.h / 2
  const ex = (Math.abs(Math.cos(a)) * i.w + Math.abs(Math.sin(a)) * i.h) / 2
  const ey = (Math.abs(Math.sin(a)) * i.w + Math.abs(Math.cos(a)) * i.h) / 2
  return { x0: cx - ex, y0: cy - ey, x1: cx + ex, y1: cy + ey }
}

// The box of everything live on the board plus `pad` on every side, in whole world pixels; null for an empty board.
// Connectors are lines between items, so they never stretch it.
export function exportBounds(items, pad = EXPORT_PAD) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const i of items ?? []) {
    if (!i || i.deleted || i.kind === 'connector' || !finite(i.x) || !finite(i.y) || !finite(i.w) || !finite(i.h)) continue
    const b = itemBox(i)
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1)
  }
  if (x0 === Infinity) return null
  const x = Math.floor(x0 - pad)
  const y = Math.floor(y0 - pad)
  return { x, y, w: Math.ceil(x1 + pad) - x, h: Math.ceil(y1 + pad) - y }
}

// Pixel ratio: 2x, scaled down so the longer side of the PNG never passes `maxSide`.
export function exportScale(w, h, { ratio = EXPORT_RATIO, maxSide = EXPORT_MAX_SIDE } = {}) {
  const long = Math.max(w, h)
  if (!(long > 0)) return ratio
  return Math.min(ratio, maxSide / long)
}

// "<title>-<YYYY-MM-DD>.png", safe on every file system: letters, digits, dash and underscore, 60 characters of title at most.
export function exportFilename(title, date = new Date()) {
  const base = String(title ?? '').normalize('NFKC').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '') || 'board'
  const p = (n) => String(n).padStart(2, '0')
  return `${base}-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.png`
}

// Parts of the live view that must not be in a picture of the board.
const CUT = '.bd-cursor, .bd-peersel, .bd-draft, .bd-marquee, .bd-handle, .bd-editor'

function prepare(world, box) {
  const clone = world.cloneNode(true)
  clone.querySelectorAll(CUT).forEach((n) => n.remove())
  clone.querySelectorAll('.bd-item').forEach((n) => { n.classList.remove('is-selected', 'is-linking'); n.removeAttribute('tabindex') })
  clone.querySelectorAll('img').forEach((img) => { img.loading = 'eager'; img.removeAttribute('srcset') })
  clone.style.transform = `translate(${-box.x}px, ${-box.y}px)`
  clone.style.setProperty('--bd-inv', '1')
  return clone
}

// boardEl: the canvas element (.bd-canvas). Resolves { filename, width, height } once the download has started; rejects with an
// ExportError (message fit to show) when there is nothing to export or the picture could not be made.
export async function exportPng(boardEl, items, { title, pad = EXPORT_PAD, ratio = EXPORT_RATIO, maxSide = EXPORT_MAX_SIDE, now = new Date() } = {}) {
  const world = boardEl?.querySelector?.('.bd-world')
  const box = exportBounds(items, pad)
  if (!world || !box) throw new ExportError('There is nothing on the board to export yet.')
  const scale = exportScale(box.w, box.h, { ratio, maxSide })

  const host = document.createElement('div')
  host.className = 'bd-canvas bd-export-host'
  host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', right: 'auto', bottom: 'auto', width: `${box.w}px`, height: `${box.h}px`, backgroundImage: 'none', pointerEvents: 'none', overflow: 'hidden' })
  host.appendChild(prepare(world, box))
  boardEl.parentElement.appendChild(host)
  try {
    const { toBlob } = await import('html-to-image')
    const options = {
      width: box.w,
      height: box.h,
      pixelRatio: scale,
      backgroundColor: getComputedStyle(host).backgroundColor,
      imagePlaceholder: PLACEHOLDER,
      // html-to-image copies the host's computed style onto its clone: the off-screen position must not come along.
      style: { position: 'relative', left: '0px', top: '0px', right: 'auto', bottom: 'auto', margin: '0px', transform: 'none' },
    }
    let blob
    try {
      blob = await toBlob(host, options)
    } catch {
      blob = await toBlob(host, { ...options, skipFonts: true }) // a web font that cannot be read must not fail the export
    }
    if (!blob) throw new Error('empty')
    const filename = exportFilename(title, now)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return { filename, width: Math.round(box.w * scale), height: Math.round(box.h * scale) }
  } catch (e) {
    if (e instanceof ExportError) throw e
    throw new ExportError('The picture could not be made. Try again, or zoom out and reload the board first.')
  } finally {
    host.remove()
  }
}
