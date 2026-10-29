// Browser-only: draws the offscreen "paper" report to a canvas and saves it as a PNG or a PDF (pages cut at card and row
// boundaries). The pure parts (filename, pdfWriter) are unit-tested; the capture itself needs a browser.
import { toCanvas } from 'html-to-image'
import { exportFilename } from './exportPng.js'
import { buildPdf, pageBreaks } from './pdfWriter.js'

// "<title>-summary-<YYYY-MM-DD>.<ext>", same sanitising as the board PNG.
export const summaryFilename = (title, ext, date = new Date()) =>
  exportFilename(title, date).replace(/-(\d{4}-\d{2}-\d{2})\.png$/, `-summary-$1.${ext}`)

const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

// `el` is the offscreen wrapper (position: fixed; left: -10000px): the clone keeps that offset and renders blank, so the paper inside is what is drawn.
const paperOf = (el) => el.firstElementChild ?? el

async function capture(wrapper) {
  const el = paperOf(wrapper)
  await frames()
  await document.fonts?.ready
  const opts = { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: false }
  try { return await toCanvas(el, opts) } catch { return toCanvas(el, { ...opts, skipFonts: true }) } // remote CSS that cannot be read: system fonts
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const toBlob = (canvas) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('no blob'))), 'image/png'))

export async function exportSummaryPng(el, { filename }) {
  download(await toBlob(await capture(el)), filename)
}

export async function exportSummaryPdf(wrapper, { filename }) {
  const canvas = await capture(wrapper)
  const el = paperOf(wrapper)
  const k = canvas.width / (el.offsetWidth || canvas.width) // canvas pixels per CSS pixel
  const top = el.getBoundingClientRect().top
  const marks = []
  for (const b of el.querySelectorAll('[data-sr-break]')) {
    const r = b.getBoundingClientRect()
    marks.push((r.top - top) * k, (r.bottom - top) * k)
  }
  const margin = 28
  const pagePx = Math.floor(canvas.width * ((841.89 - margin * 2) / (595.28 - margin * 2)))
  const cuts = pageBreaks(marks, canvas.height, pagePx)
  const pages = []
  let from = 0
  for (const to of cuts) {
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = Math.max(1, to - from)
    const ctx = slice.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, slice.width, slice.height)
    ctx.drawImage(canvas, 0, from, canvas.width, to - from, 0, 0, canvas.width, to - from)
    const bin = atob(slice.toDataURL('image/jpeg', 0.92).split(',')[1])
    const jpeg = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    pages.push({ jpeg, width: slice.width, height: slice.height })
    from = to
  }
  download(new Blob([buildPdf(pages)], { type: 'application/pdf' }), filename)
}
