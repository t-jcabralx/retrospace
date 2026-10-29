// A minimal PDF writer with no library: each page is one JPEG image scaled to fit the page width inside the margins. Pure.

// pages: [{ jpeg: Uint8Array, width, height }] (pixels) -> Uint8Array of a PDF 1.4 file.
export function buildPdf(pages, { pageWidth = 595.28, pageHeight = 841.89, margin = 28 } = {}) {
  const enc = new TextEncoder()
  const chunks = []
  let size = 0
  const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); size += b.length }
  const offsets = []
  const obj = (n, body, stream) => {
    offsets[n] = size
    put(`${n} 0 obj\n${body}`)
    if (stream) { put('\nstream\n'); put(stream); put('\nendstream') }
    put('\nendobj\n')
  }
  const count = pages.length
  const first = 3 // objects: 1 Catalog, 2 Pages, then 3 per page (Page, Image, Content)
  const kids = pages.map((_, n) => `${first + n * 3} 0 R`).join(' ')
  put('%PDF-1.4\n%âãÏÓ\n')
  // the binary comment above must be bytes >127: the string is written as UTF-8, which keeps them above 127
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${count} >>`)
  const fmt = (n) => (Math.round(n * 100) / 100).toString()
  pages.forEach((p, n) => {
    const page = first + n * 3
    const w = pageWidth - margin * 2
    const h = Math.min(pageHeight - margin * 2, (w * p.height) / p.width)
    const y = pageHeight - margin - h
    const content = `q ${fmt(w)} 0 0 ${fmt(h)} ${fmt(margin)} ${fmt(y)} cm /Im0 Do Q`
    obj(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(pageWidth)} ${fmt(pageHeight)}] /Resources << /XObject << /Im0 ${page + 1} 0 R >> >> /Contents ${page + 2} 0 R >>`)
    obj(page + 1, `<< /Type /XObject /Subtype /Image /Width ${Math.round(p.width)} /Height ${Math.round(p.height)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`, p.jpeg)
    obj(page + 2, `<< /Length ${enc.encode(content).length} >>`, content)
  })
  const total = first + count * 3
  const xref = size
  put(`xref\n0 ${total}\n0000000000 65535 f \n`)
  for (let n = 1; n < total; n++) put(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  put(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}

// Where to cut a tall picture into pages: boundariesPx are the offsets where a block starts or ends (cards, table rows),
// totalPx the picture height and pagePx the page height in picture pixels. -> the cut offsets, ascending, ending at totalPx.
// A page ends on the last boundary that still fits; a block taller than a page is hard-cut.
export function pageBreaks(boundariesPx, totalPx, pagePx) {
  const total = Math.max(0, Math.round(totalPx))
  if (!(total > 0) || !(pagePx > 0)) return []
  const bs = [...new Set((boundariesPx ?? []).map(Math.round))].filter((b) => b > 0 && b < total).sort((a, b) => a - b)
  const cuts = []
  let start = 0
  while (total - start > pagePx) {
    const limit = start + pagePx
    let cut = 0
    for (const b of bs) { if (b > start && b <= limit) cut = b; else if (b > limit) break }
    // a boundary so close to the start that the page would be nearly empty is not worth it only when nothing else fits
    if (!cut) cut = limit
    cuts.push(cut)
    start = cut
  }
  cuts.push(total)
  return cuts
}
