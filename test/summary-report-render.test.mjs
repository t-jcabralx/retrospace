import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./helpers/jsx-loader.mjs', import.meta.url)
const { createElement } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { default: SummaryReport } = await import('../src/ui/SummaryReport.jsx')
await import('../src/ui/SummaryPanel.jsx')
await import('../src/ui/SummaryOwner.jsx')

const board = { type: 'retro', title: 'Sprint 12' }
const items = [
  { id: 'n1', kind: 'note', x: 0, y: 0, data: { text: 'Great demo' }, votes: ['a', 'b'], authorName: 'Hidden Person', anon: true },
  { id: 'a1', kind: 'action', x: 0, y: 0, data: { action: 'Fix CI', status: 'open', priority: 'high' } },
]
const text = 'What went well:\n- Demo\n\nKey takeaways:\n- Ship <script>alert(1)</script>\n- <img src=x onerror=alert(1)>'
const render = (over = {}) => renderToStaticMarkup(createElement(SummaryReport, { summary: { text, source: 'ai', editedAt: null }, board, items, generatedLabel: '29 Oct 2026', ...over }))

test('report: header, chip, section cards, real tables with caption and th scope', () => {
  const html = render()
  assert.match(html, /<h2[^>]*>Retrospective summary<\/h2>/)
  assert.match(html, /AI-generated/)
  assert.match(html, /<h3[^>]*><span aria-hidden="true">✅<\/span> What went well<\/h3>/)
  assert.match(html, /is-wide/)
  assert.match(html, /<table[^>]*><caption[^>]*>Most voted<\/caption><thead><tr><th scope="col"[^>]*>Rank/)
  assert.match(html, /<caption[^>]*>Action items<\/caption>/)
  assert.match(html, /role="region"[^>]*tabindex="0"|tabindex="0"[^>]*role="region"/)
  assert.match(html, /Needs owner/)
  assert.match(html, /Download PDF/)
  assert.match(html, /Copy as table/)
  assert.doesNotMatch(html, /Hidden Person/)
})

test('untrusted markup is escaped, never rendered', () => {
  const html = render()
  assert.doesNotMatch(html, /<script/i)
  assert.doesNotMatch(html, /<img/i)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
})

test('tables are omitted when empty; titles follow the board type', () => {
  const html = render({ items: [], board: { type: 'celebration', title: 'T' } })
  assert.doesNotMatch(html, /<table/)
  assert.match(html, /Celebration recap/)
  assert.match(render({ board: { type: 'workshop', title: 'W' } }), /Board summary/)
})

test('paper variant: same content, no controls', () => {
  const html = render({ variant: 'paper' })
  assert.doesNotMatch(html, /<button/)
  assert.match(html, /sr-paper/)
  assert.match(html, /<caption[^>]*>Most voted<\/caption>/)
  assert.match(html, /<th scope="col"/)
})
