import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSummary, sectionStyle, votesTable, actionsTable, clipboardTables, escapeHtml, MAX_SECTIONS, MAX_ITEMS, MAX_ITEM_CHARS } from '../src/ui/summaryReport.js'

test('the retro prompt format: headings with a colon, dash bullets', () => {
  const r = parseSummary('What went well:\n- Fast deploys\n- Good pairing\n\nBlockers:\n- Flaky CI\n\nKey takeaways:\n- Fix CI first')
  assert.deepEqual(r.sections.map((s) => s.title), ['What went well', 'Blockers', 'Key takeaways'])
  assert.deepEqual(r.sections[0].items, ['Fast deploys', 'Good pairing'])
  assert.deepEqual(r.preamble, [])
})

test('variations: markdown headings, bold titles, underlined, bullets, numbers, wrapped lines, emphasis', () => {
  const r = parseSummary('Intro line\n\n## Ideas\n* **Pair** more\n• `Mob` sessions\n1. Demo day\n   continues here\n\n**Blockers:**\n2) Access\n\nWhat to improve\n---\n- Tests\n\nHeadlines: Shipped it')
  assert.deepEqual(r.preamble, ['Intro line'])
  const by = Object.fromEntries(r.sections.map((s) => [s.title, s]))
  assert.deepEqual(by.Ideas.items, ['Pair more', 'Mob sessions', 'Demo day continues here'])
  assert.deepEqual(by.Blockers.items, ['Access'])
  assert.deepEqual(by['What to improve'].items, ['Tests'])
  assert.deepEqual(by.Headlines.paragraphs, ['Shipped it'])
})

test('a recap with no headings is paragraphs in the preamble; empty input is empty', () => {
  assert.deepEqual(parseSummary('Warm words.\n\nMore warm words.').preamble, ['Warm words.', 'More warm words.'])
  assert.deepEqual(parseSummary(''), { sections: [], preamble: [] })
  assert.deepEqual(parseSummary(null), { sections: [], preamble: [] })
})

test('hostile and huge input is capped and stays plain text', () => {
  const many = Array.from({ length: 300 }, (_, n) => `Title ${n}:\n- x`).join('\n')
  assert.equal(parseSummary(many).sections.length, MAX_SECTIONS)
  const items = 'Ideas:\n' + Array.from({ length: 200 }, (_, n) => `- i${n}`).join('\n')
  assert.equal(parseSummary(items).sections[0].items.length, MAX_ITEMS)
  assert.ok(Array.from(parseSummary(`Ideas:\n- ${'a'.repeat(5000)}`).sections[0].items[0]).length <= MAX_ITEM_CHARS)
  const r = parseSummary('Ideas:\n- <script>alert(1)</script>\n- <img src=x onerror=alert(1)>')
  assert.equal(r.sections[0].items[0], '<script>alert(1)</script>') // kept as a string; React escapes it on render
})

test('sectionStyle by keyword', () => {
  assert.deepEqual(sectionStyle('What went well'), { icon: '✅', tone: 'good' })
  assert.deepEqual(sectionStyle('What to improve'), { icon: '⚠️', tone: 'warn' })
  assert.deepEqual(sectionStyle('Blockers'), { icon: '🚧', tone: 'block' })
  assert.deepEqual(sectionStyle('Ideas'), { icon: '💡', tone: 'idea' })
  assert.deepEqual(sectionStyle('Key takeaways'), { icon: '⭐', tone: 'key' })
  assert.equal(sectionStyle('Action items').icon, '🎯')
  assert.equal(sectionStyle('Open questions').icon, '❓')
  assert.deepEqual(sectionStyle('Whatever'), { icon: '📝', tone: 'neutral' })
})

const note = (id, text, votes, over = {}) => ({ id, kind: 'note', x: 0, y: 0, w: 10, h: 10, data: { text }, votes: Array.from({ length: votes }, (_, n) => `u${n}`), authorUid: 'secret', authorName: 'Secret', anon: true, ...over })

test('votesTable: ranks with ties, cap, kinds, no author fields', () => {
  const items = [note('a', 'B note', 2), note('b', 'A note', 2), note('c', 'top', 5), note('d', 'none', 0), note('e', 'gone', 9, { deleted: true }),
    { id: 't', kind: 'theme', x: 0, y: 0, data: { title: 'Theme' }, votes: ['u'] }, { id: 'f', kind: 'frame', x: 0, y: 0, data: {}, votes: ['u'] }]
  const rows = votesTable(items)
  assert.deepEqual(rows.map((r) => [r.rank, r.text, r.votes, r.tied]), [[1, 'top', 5, false], [2, 'A note', 2, true], [2, 'B note', 2, true], [4, 'Theme', 1, false]])
  assert.equal(votesTable(items, { max: 2 }).length, 2)
  assert.ok(!JSON.stringify(rows).match(/secret|author|anon/i))
  assert.ok(votesTable([note('l', 'x'.repeat(300), 1)])[0].text.length <= 90)
  assert.deepEqual(votesTable(null), [])
})

test('actionsTable: flags and ordering', () => {
  const a = (id, data, over = {}) => ({ id, kind: 'action', data, ...over })
  const rows = actionsTable([a('1', { action: 'done one', status: 'done', owner: 'Ana', due: '2026-11-01', priority: 'high' }), a('2', { action: 'low open', status: 'open', priority: 'low', owner: 'Bo', due: 'x' }),
    a('3', { action: 'high open', status: 'open', priority: 'high' }), a('4', { action: 'doing', status: 'doing', owner: 'Cy', due: 'y' }), a('5', { action: 'deleted' }, { deleted: true }), { id: '6', kind: 'note', data: { text: 'n' } }])
  assert.deepEqual(rows.map((r) => r.action), ['high open', 'low open', 'doing', 'done one'])
  assert.deepEqual(rows[0].flags, ['Needs owner', 'Needs due date'])
  assert.deepEqual(rows[1].flags, [])
  assert.equal(rows[2].status, 'In progress')
  assert.ok(!('authorName' in rows[0]))
})

test('clipboard html is escaped and plain text is tab separated', () => {
  assert.equal(escapeHtml(`<script>"&'`), '&lt;script&gt;&quot;&amp;&#39;')
  const { html, text } = clipboardTables({ sections: [{ title: '<b>T</b>', items: ['<script>alert(1)</script> & "q"'], paragraphs: [] }], votes: [{ rank: 1, text: 'v\tx', votes: 2, category: 'C' }], actions: [{ action: 'a', owner: '', due: '', status: 'Open', priority: 'Low' }] })
  assert.ok(!html.includes('<script>') && !html.includes('<b>'))
  assert.match(html, /<table[^>]*><caption>Summary<\/caption><thead><tr><th scope="col">Section<\/th>/)
  assert.match(html, /Needs owner/)
  assert.match(text, /^Summary\nSection\tPoint\n&lt;|^Summary\nSection\tPoint\n<b>T<\/b>\t<script>/)
  assert.match(text, /1\tv x\t2\tC/)
})
