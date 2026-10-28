import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./helpers/jsx-loader.mjs', import.meta.url)
const { createElement } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { buildPrintModel, printPhase, printable } = await import('../src/lib/printModel.js')
const { printHref } = await import('../src/ui/printLink.js')
const { default: PrintLink } = await import('../src/ui/PrintLink.jsx')
const { PrintDocument } = await import('../src/ui/PrintView.jsx')
const { default: ExportMenu } = await import('../src/ui/ExportMenu.jsx')

const frame = (id, x, title) => ({ id, kind: 'frame', x, y: 0, w: 300, h: 900, data: { title } })
const note = (id, x, y, text, extra = {}) => ({ id, kind: 'note', x, y, w: 100, h: 100, data: { text }, votes: [], authorUid: 'u1', authorName: 'Secret Sam', ...extra })
const people = [{ uid: 'u1', name: 'Sam Persona' }, { uid: 'u2', name: 'Pat Persona' }]
const board = { title: 'Sprint 12', type: 'retro', createdAt: Date.UTC(2026, 9, 28, 10), summary: null }
const retro = () => [
  frame('f1', 0, 'Went Well'), frame('f2', 400, 'Could Improve'),
  note('a', 20, 50, 'Pairing helped'), note('b', 20, 200, 'Great demo', { votes: ['x', 'y', 'z'] }),
  note('c', 420, 50, 'CI is slow', { votes: ['x'] }), note('gone', 420, 300, 'DELETED-NOTE', { deleted: true }),
  { id: 't1', kind: 'theme', x: 0, y: 1000, w: 240, h: 150, data: { title: 'Tooling', noteIds: ['c', 'gone', 'missing'] }, votes: ['x', 'y'] },
]

test('the print path is /b/<code>/print and the link is a plain anchor to it', () => {
  assert.equal(printHref('ABC234'), '/b/ABC234/print')
  assert.equal(printHref('a/b c'), '/b/a%2Fb%20c/print')
  const html = renderToStaticMarkup(createElement(PrintLink, { code: 'ABC234' }))
  assert.match(html, /<a [^>]*href="\/b\/ABC234\/print"[^>]*target="_blank"[^>]*>Print \/ Save as PDF<\/a>/)
})

test('the export menu shows the print item only when it is given a printHref, and the board screen gives it one', async () => {
  const { readFile } = await import('node:fs/promises')
  const menu = await readFile(new URL('../src/ui/ExportMenu.jsx', import.meta.url), 'utf8')
  assert.match(menu, /\{printHref && \(\s*<a [\s\S]*?href=\{printHref\}[\s\S]*?>Print \/ Save as PDF<\/a>/)
  const screen = await readFile(new URL('../src/ui/BoardScreen.jsx', import.meta.url), 'utf8')
  assert.match(screen, /<ExportMenu [^>]*printHref=\{printHref\(code\)\}/)
  // closed, the menu renders only its button (no throw without the prop)
  const html = renderToStaticMarkup(createElement(ExportMenu, { ctl: { code: 'ABC234', isOwner: false, items: [] }, title: 't' }))
  assert.ok(!html.includes('Print / Save as PDF'))
})

test('sections follow the columns left to right; most voted first; deleted notes and votes are handled', () => {
  const m = buildPrintModel(board, retro(), people, { now: Date.UTC(2026, 9, 29) })
  assert.deepEqual(m.sections.map((s) => s.title), ['Went Well', 'Could Improve'])
  assert.deepEqual(m.sections[0].items.map((i) => [i.text, i.votes]), [['Great demo', 3], ['Pairing helped', 0]])
  assert.deepEqual(m.sections[1].items.map((i) => i.text), ['CI is slow'])
  assert.equal(m.showVotes, true)
  assert.deepEqual(m.cover, { title: 'Sprint 12', type: 'Retrospective', created: '2026-10-28', printed: '2026-10-29', participants: 2 })
  assert.ok(!JSON.stringify(m).includes('DELETED-NOTE'))
})

test('themes list their live source notes with votes; a deleted or unknown source is skipped', () => {
  const m = buildPrintModel(board, retro(), people)
  assert.deepEqual(m.themes, [{ id: 't1', title: 'Tooling', votes: 2, notes: [{ id: 'c', text: 'CI is slow' }] }])
  assert.ok(!m.sections.some((s) => s.items.some((i) => i.kind === 'theme')), 'a theme is not also a note')
})

test('only a SHARED summary is printed; a draft never is, whoever prints', () => {
  const draft = { ...board, summary: { status: 'draft', text: 'PRIVATE-DRAFT-TEXT', source: 'ai' } }
  for (const isOwner of [true, false]) assert.equal(buildPrintModel(draft, retro(), people, { isOwner }).summary, null)
  const shared = buildPrintModel({ ...board, summary: { status: 'shared', text: 'Team did well.\n\n\n\nNext.', source: 'ai' } }, retro(), people)
  assert.deepEqual(shared.summary, { text: 'Team did well.\n\nNext.', ai: true })
})

test('authors are off by default and only the owner can turn them on', () => {
  const items = retro()
  const bytes = (o) => JSON.stringify(buildPrintModel(board, items, people, o))
  for (const o of [undefined, {}, { authors: false, isOwner: true }, { authors: true, isOwner: false }]) {
    const s = bytes(o)
    for (const n of ['Sam Persona', 'Secret Sam', 'u1']) assert.ok(!s.includes(n), `${JSON.stringify(o)} ${n}`)
  }
  const on = buildPrintModel(board, items, people, { authors: true, isOwner: true })
  assert.equal(on.authors, true)
  assert.equal(on.sections[0].items[0].author, 'Sam Persona')
  const html = renderToStaticMarkup(createElement(PrintDocument, { model: on }))
  assert.match(html, /Sam Persona/)
  assert.ok(!renderToStaticMarkup(createElement(PrintDocument, { model: buildPrintModel(board, items, people) })).includes('Sam Persona'))
})

test('a fallback author name is used when the participant is gone', () => {
  const m = buildPrintModel(board, [note('z', 1, 1, 'hi', { authorUid: 'removed' })], [], { authors: true, isOwner: true })
  assert.equal(m.sections[0].items[0].author, 'Secret Sam')
})

test('nothing owner-only is read: the model carries only what the document shows (checked by bytes)', () => {
  const rich = { ...board, ownerId: 'OWNER-ID', createdBy: 'CREATOR', passcodeHash: 'HASH', ai: { enabled: true, model: 'MODEL-X' }, themeSuggestions: { themes: [{ title: 'SUGGESTION-X' }] }, bans: ['BAN-X'], summary: { status: 'draft', text: 'DRAFT-X' } }
  const s = JSON.stringify(buildPrintModel(rich, retro(), people, { authors: true, isOwner: true }))
  for (const secret of ['OWNER-ID', 'CREATOR', 'HASH', 'MODEL-X', 'SUGGESTION-X', 'BAN-X', 'DRAFT-X']) assert.ok(!s.includes(secret), secret)
})

test('celebration cards are one block each, with signers; wall shoutouts group by badge; media must be a safe url', () => {
  const card = (id, y, message, extra = {}) => ({ id, kind: 'card', x: 0, y, w: 300, h: 200, votes: [], data: { message, signer: 'Mo', color: 'yellow', ...extra } })
  const items = [card('c1', 0, 'Thanks!', { gif: 'https://media.giphy.com/x.gif' }), card('c2', 300, 'Great job', { image: 'javascript:alert(1)' }), card('c3', 600, 'Bravo', { image: 'data:image/png;base64,AAAA' })]
  const m = buildPrintModel({ ...board, type: 'celebration', title: 'For Dana' }, items, [])
  assert.deepEqual(m.sections.map((s) => s.title), ['Cards'])
  assert.deepEqual(m.sections[0].items.map((i) => [i.text, i.signer, i.media?.type ?? null]), [['Thanks!', 'Mo', 'gif'], ['Great job', 'Mo', null], ['Bravo', 'Mo', 'photo']])
  const html = renderToStaticMarkup(createElement(PrintDocument, { model: m }))
  assert.equal((html.match(/class="pv-card"/g) ?? []).length, 3)
  assert.ok(!html.includes('javascript:'))
  const wall = buildPrintModel({ ...board, type: 'wall' }, [{ id: 's1', kind: 'shoutout', x: 0, y: 0, w: 1, h: 1, votes: [], data: { toName: 'Dana', message: 'Nice work', badge: 'Teamwork' } }], [])
  assert.deepEqual(wall.sections.map((s) => [s.title, s.items[0].to, s.items[0].text]), [['Teamwork', 'Dana', 'Nice work']])
})

test('text is cleaned of control and bidi characters, and the document renders it as text, never markup', () => {
  assert.equal(printable('a\u0000b‮c​d\r\ne'), 'abcd\ne')
  const m = buildPrintModel({ ...board, title: '<img src=x onerror=1>' }, [note('x', 1, 1, '<script>alert(1)</script>')], [])
  const html = renderToStaticMarkup(createElement(PrintDocument, { model: m }))
  assert.ok(!html.includes('<script>') && !html.includes('<img src=x'))
  assert.match(html, /&lt;script&gt;/)
})

test('an empty board still gives a document with a cover; a 40-note board is one list per column', () => {
  const m = buildPrintModel(board, [], [])
  assert.equal(m.empty, true)
  assert.match(renderToStaticMarkup(createElement(PrintDocument, { model: m })), /nothing on this board yet/)
  const many = [frame('f1', 0, 'A'), ...Array.from({ length: 40 }, (_, i) => note(`n${i}`, 10, 10 + i * 20, `note ${i}`))]
  const big = buildPrintModel(board, many, [])
  assert.equal(big.sections[0].items.length, 40)
  assert.equal((renderToStaticMarkup(createElement(PrintDocument, { model: big })).match(/class="pv-item"/g) ?? []).length, 40)
})

test('printPhase maps the board API answer to what the print page shows', () => {
  assert.equal(printPhase(200), 'ready')
  assert.equal(printPhase(404), 'missing')
  assert.equal(printPhase(401, 'Passcode required'), 'passcode')
  assert.equal(printPhase(403, 'This link was revoked'), 'revoked')
  assert.equal(printPhase(403, 'You were removed from this board'), 'removed')
  assert.equal(printPhase(401, 'Sign in'), 'error')
  assert.equal(printPhase(500), 'error')
})
