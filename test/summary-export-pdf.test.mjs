import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPdf, pageBreaks } from '../src/ui/pdfWriter.js'
import { summaryFilename } from '../src/ui/summaryExport.js'

const jpeg = (n) => Uint8Array.from([0xff, 0xd8, ...Array.from({ length: n }, (_, i) => (i * 7) & 0xff), 0xff, 0xd9])
const latin = (u8) => Buffer.from(u8).toString('latin1')

for (const count of [1, 5]) {
  test(`buildPdf structure with ${count} page(s)`, () => {
    const pages = Array.from({ length: count }, (_, n) => ({ jpeg: jpeg(100 + n), width: 1588, height: 2000 }))
    const pdf = buildPdf(pages)
    const s = latin(pdf)
    assert.ok(s.startsWith('%PDF-1.4\n%'))
    assert.ok(pdf[10] > 127 && pdf[11] > 127)
    assert.ok(s.trimEnd().endsWith('%%EOF'))
    const start = Number(/startxref\n(\d+)\n/.exec(s)[1])
    assert.equal(s.slice(start, start + 4), 'xref')
    const total = 3 + count * 3
    assert.match(s, new RegExp(`/Size ${total} /Root 1 0 R`))
    const entries = [...s.slice(start).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]))
    assert.equal(entries.length, total - 1)
    entries.forEach((off, i) => assert.ok(s.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`))
    assert.match(s, new RegExp(`/Count ${count}`))
    assert.equal((s.match(/\/Type \/Page /g) ?? []).length, count)
    assert.equal((s.match(/\/Filter \/DCTDecode/g) ?? []).length, count)
    assert.ok(s.includes('/ColorSpace /DeviceRGB /BitsPerComponent 8'))
    // content stream /Length matches
    for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) assert.equal(Number(m[1]), m[2].length)
    // image /Length matches the jpeg bytes
    const img = /\/Length (\d+) >>\nstream\n\xff\xd8/.exec(s)
    assert.equal(Number(img[1]), 100 + 4)
    assert.match(s, /q 539\.28 0 0 [\d.]+ 28 [\d.]+ cm \/Im0 Do Q/)
  })
}

test('pageBreaks', () => {
  assert.deepEqual(pageBreaks([], 0, 100), [])
  assert.deepEqual(pageBreaks([50], 100, 100), [100]) // exact fit
  assert.deepEqual(pageBreaks([40, 90, 130, 180], 250, 100), [90, 180, 250]) // prefers the last boundary that fits
  assert.deepEqual(pageBreaks([300], 450, 100), [100, 200, 300, 400, 450]) // oversize block: hard cuts
  assert.equal(pageBreaks([], 1000, 100).length, 10)
})

test('summaryFilename sanitises', () => {
  const d = new Date(2026, 9, 29)
  assert.equal(summaryFilename('Sprint 12 retro', 'pdf', d), 'Sprint-12-retro-summary-2026-10-29.pdf')
  assert.equal(summaryFilename('🎉 a/b\\c:d', 'png', d), 'abcd-summary-2026-10-29.png')
  assert.match(summaryFilename('x'.repeat(300), 'pdf', d), /^x{60}-summary-2026-10-29\.pdf$/)
  assert.equal(summaryFilename('', 'png', d), 'board-summary-2026-10-29.png')
})
