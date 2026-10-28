import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

for (const k of ['MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k]

const { csvCell, csvRow, toCsv, boardCsv, BOM } = await import('../src/lib/csv.js')
const { exportName } = await import('../src/app/api/boards/[code]/export/route.js')

// A tiny RFC 4180 reader, to prove the output round-trips (not just that it looks right).
function parse(text) {
  const rows = []
  let row = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++ }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

describe('csvCell', () => {
  test('plain values stay bare; commas, quotes and line breaks are quoted with doubled quotes', () => {
    assert.equal(csvCell('hello'), 'hello')
    assert.equal(csvCell('a,b'), '"a,b"')
    assert.equal(csvCell('say "hi"'), '"say ""hi"""')
    assert.equal(csvCell('l1\nl2'), '"l1\nl2"')
    assert.equal(csvCell('l1\r\nl2'), '"l1\r\nl2"')
    assert.equal(csvCell(null), '')
    assert.equal(csvCell(undefined), '')
    assert.equal(csvCell(0), '0')
    assert.equal(csvCell('héllo ✓ 日本 😀'), 'héllo ✓ 日本 😀')
  })

  test('a cell that could be read as a formula is defused with a leading quote', () => {
    for (const bad of ['=1+1', '+cmd', '-2+3', '@SUM(A1)', '\tx', '\rx', '=HYPERLINK("http://x","y")']) {
      const cell = csvCell(bad)
      assert.ok(cell.startsWith("'") || cell.startsWith('"\''), `${JSON.stringify(bad)} -> ${cell}`)
    }
    assert.equal(csvCell('=1+1'), "'=1+1")
    assert.equal(csvCell('=SUM(A1,B1)'), '"\'=SUM(A1,B1)"')
    assert.equal(csvCell('a=b'), 'a=b', 'only a LEADING character matters')
    assert.equal(csvCell("'already"), "'already")
  })

  test('control, zero-width and bidi characters are stripped; tab and line breaks survive inside', () => {
    assert.equal(csvCell('a\u0000b\u0007c\u001bd\u007fe'), 'abcde')
    assert.equal(csvCell('a​b‮c⁦d﻿e f'), 'abcdef')
    assert.equal(csvCell('a\tb'), 'a\tb')
    assert.equal(csvCell('‮=1+1'), "'=1+1", 'a bidi mark cannot hide the formula')
    assert.equal(csvCell('​=1+1'), "'=1+1", 'nor a zero-width one')
  })
})

describe('toCsv / csvRow', () => {
  test('BOM first, CRLF line ends, trailing CRLF, and it parses back', () => {
    const rows = [['a', 'b,c', 'd"e'], ['1\n2', '', "=x"]]
    const text = toCsv(rows)
    assert.equal(text[0], BOM)
    assert.ok(text.endsWith('\r\n'))
    assert.equal(csvRow(['x', 'y']), 'x,y')
    assert.deepEqual(parse(text.slice(1)), [['a', 'b,c', 'd"e'], ['1\n2', '', "'=x"]])
  })
})

describe('boardCsv', () => {
  const frame = (id, x, title) => ({ id, kind: 'frame', x, y: 0, w: 400, h: 600, data: { title }, votes: [], deleted: false, updatedAt: 1 })
  const note = (id, x, text, extra = {}) => ({ id, kind: 'note', x, y: 50, w: 100, h: 100, data: { text, color: 'yellow' }, votes: [], deleted: false, updatedAt: 1000, authorUid: 'KM-AAAA-AAAA-AAAA', authorName: 'Old Ann', ...extra })
  const board = { code: 'ABCDEF', type: 'retro', title: 'Sprint 12' }
  const people = [{ uid: 'KM-AAAA-AAAA-AAAA', name: 'Ann' }]

  test('header, category by frame, order by column then votes, deleted excluded, no authors by default', () => {
    const items = [
      frame('f2', 500, 'Went poorly'), frame('f1', 0, 'Went well'),
      note('n1', 10, 'low', { votes: [] }),
      note('n2', 20, 'high', { votes: ['a', 'b'] }),
      note('n3', 600, 'bad thing'),
      note('n4', 700, 'gone', { deleted: true }),
      note('n5', 5000, 'floating'),
    ]
    const rows = parse(boardCsv(board, items, people).slice(1))
    assert.deepEqual(rows[0], ['Board', 'Type', 'Category', 'Item', 'Kind', 'Votes', 'Color', 'Created', 'Author'].slice(0, 8))
    assert.deepEqual(rows.slice(1).map((r) => [r[2], r[3], r[5]]), [['Went well', 'high', '2'], ['Went well', 'low', '0'], ['Went poorly', 'bad thing', '0'], ['Uncategorised', 'floating', '0']])
    assert.ok(rows.every((r) => r.length === 8), 'no Author cell at all')
    assert.equal(rows[1][0], 'Sprint 12')
    assert.equal(rows[1][6], 'yellow')
    assert.match(rows[1][7], /^1970-01-01T00:00:01\.000Z$/)
  })

  test('authors=1 adds persona NAMES only, falling back to the stored name for a removed person, never ids', () => {
    const items = [note('n1', 10, 'mine'), note('n2', 20, 'theirs', { authorUid: 'KM-GONE-GONE-GONE', authorName: 'Left Lee' })]
    const text = boardCsv(board, items, people, { authors: true })
    const rows = parse(text.slice(1))
    assert.equal(rows[0][8], 'Author')
    assert.deepEqual(rows.slice(1).map((r) => r[8]).sort(), ['Ann', 'Left Lee'])
    assert.equal(text.includes('KM-'), false, 'no public ids')
  })

  test('celebration cards are "Cards", shoutouts show the badge and "To <name>: <message>"', () => {
    const card = { id: 'c1', kind: 'card', x: 0, y: 0, w: 200, h: 200, data: { message: 'Congrats!', signer: 'Bo', color: 'pink' }, votes: [], deleted: false, updatedAt: 5 }
    const shout = { id: 's1', kind: 'shoutout', x: 10, y: 0, w: 200, h: 200, data: { toName: 'Cy', message: 'Great job', badge: 'Teamwork' }, votes: [], deleted: false, updatedAt: 6 }
    const rows = parse(boardCsv({ ...board, type: 'celebration' }, [card, shout], []).slice(1))
    assert.deepEqual(rows.slice(1).map((r) => [r[2], r[3], r[4]]), [['Cards', 'Congrats!', 'card'], ['Teamwork', 'To Cy: Great job', 'shoutout']])
  })

  test('a shared summary is a trailing Summary row; a draft is never exported', () => {
    const items = [note('n1', 10, 'x')]
    const shared = parse(boardCsv({ ...board, summary: { text: 'All good', status: 'shared', generatedAt: 2000, editedAt: null } }, items, []).slice(1))
    assert.deepEqual([shared.at(-1)[2], shared.at(-1)[3], shared.at(-1)[4]], ['Summary', 'All good', 'Summary'])
    assert.equal(shared.at(-1)[7], '1970-01-01T00:00:02.000Z')
    const draft = parse(boardCsv({ ...board, summary: { text: 'Secret draft', status: 'draft' } }, items, []).slice(1))
    assert.equal(draft.length, 2)
  })

  test('hostile content is defused in every cell, including the board title and the summary', () => {
    const items = [note('n1', 10, '=cmd|\' /C calc\'!A0'), note('n2', 20, '@SUM(1)', { authorName: '+evil' })]
    const text = boardCsv({ ...board, title: '=1+1', summary: { text: '-9', status: 'shared' } }, items, [], { authors: true })
    for (const row of parse(text.slice(1)).slice(1)) for (const cell of row) assert.ok(!/^[=+\-@\t\r]/.test(cell), `unsafe cell ${JSON.stringify(cell)}`)
  })

  test('an empty board is just the header; missing fields do not throw', () => {
    assert.deepEqual(parse(boardCsv(board, [], []).slice(1)).length, 1)
    assert.doesNotThrow(() => boardCsv({ title: 'x' }, [{ id: 'a', kind: 'note', x: 1, y: 1, data: {} }, null], undefined))
  })

  test('2,000 items in under 200 ms', () => {
    const items = [frame('f', 0, 'Col'), ...Array.from({ length: 2000 }, (_, i) => note(`n${i}`, i % 300, `item ${i}, "quoted"\nline`, { votes: i % 3 ? ['a'] : [] }))]
    const t0 = performance.now()
    const text = boardCsv(board, items, people, { authors: true })
    const ms = performance.now() - t0
    assert.ok(ms < 200, `took ${ms} ms`)
    assert.equal(parse(text.slice(1)).length, 2001 + 0)
  })
})

describe('exportName', () => {
  test('sanitised, dated, never empty', () => {
    const d = new Date('2026-10-29T12:00:00Z')
    assert.equal(exportName('Sprint 12 retro!', d), 'Sprint-12-retro-2026-10-29')
    assert.equal(exportName('../../etc/passwd"\r\n', d), 'etcpasswd-2026-10-29')
    assert.equal(exportName('日本語', d), 'board-2026-10-29')
    assert.equal(exportName('', d), 'board-2026-10-29')
    assert.ok(exportName('x'.repeat(500), d).length < 80)
  })
})

// --- the route ---------------------------------------------------------------------------------------------------
const { POST: createBoard } = await import('../src/app/api/boards/route.js')
const board = await import('../src/app/api/boards/[code]/route.js')
const { POST: opsRoute } = await import('../src/app/api/boards/[code]/ops/route.js')
const { PUT: personaRoute } = await import('../src/app/api/boards/[code]/persona/route.js')
const { GET: exportRoute } = await import('../src/app/api/boards/[code]/export/route.js')
const { POST: register } = await import('../src/app/api/auth/register/route.js')

const rnd = () => randomBytes(5).toString('hex')
const fakeIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${rnd()}`
async function call(handler, method, path, { body, cookie, code, ip } = {}) {
  const h = { 'x-forwarded-for': ip ?? fakeIp() }
  if (body !== undefined) h['content-type'] = 'application/json'
  if (cookie) h.cookie = cookie
  const res = await handler(new Request(`http://localhost:3430${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), code ? { params: Promise.resolve({ code }) } : undefined)
  return { status: res.status, headers: res.headers, text: Buffer.from(await res.arrayBuffer()).toString('utf8'), setCookies: res.headers.getSetCookie() }
}
const j = (r) => JSON.parse(r.text)
async function signUp(name) {
  const r = await call(register, 'POST', '/api/auth/register', { body: { email: `${name.toLowerCase()}-${rnd()}@example.com`, name, password: 'correct horse battery' } })
  assert.equal(r.status, 200)
  return r.setCookies.find((c) => c.startsWith('rs_session=')).split(';')[0]
}

describe('GET /export', () => {
  test('owner only, CSV headers, hostile note is defused, authors off by default and opt-in, bad params 400', async () => {
    const owner = await signUp('Dana')
    const created = j(await call(createBoard, 'POST', '/api/boards', { cookie: owner, body: { type: 'workshop', template: 'blank', title: 'Plan "A", v2' } }))
    const code = created.code
    const snap = await call(board.GET, 'GET', `/api/boards/${code}`, { code })
    const rsg = snap.setCookies.find((c) => c.startsWith('rs_g=')).split(';')[0]
    const named = await call(personaRoute, 'PUT', `/api/boards/${code}/persona`, { code, cookie: rsg, body: { persona: { kind: 'custom', name: 'Gus', avatar: { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 } } } })
    assert.equal(named.status, 200)
    const add = await call(opsRoute, 'POST', `/api/boards/${code}/ops`, { code, cookie: rsg, body: { ops: [{ op: 'add', item: { id: 'n1', kind: 'note', x: 1, y: 2, w: 200, h: 200, data: { text: '=cmd|calc' } } }, { op: 'add', item: { id: 'n2', kind: 'note', x: 5, y: 2, w: 200, h: 200, data: { text: 'fine, with comma' } } }] } })
    assert.equal(add.status, 200)

    assert.equal((await call(exportRoute, 'GET', `/api/boards/${code}/export?format=csv`, { code })).status, 401, 'anonymous')
    assert.equal((await call(exportRoute, 'GET', `/api/boards/${code}/export?format=csv`, { code, cookie: rsg })).status, 401, 'a guest has no account')
    assert.equal((await call(exportRoute, 'GET', `/api/boards/${code}/export?format=csv`, { code, cookie: await signUp('Mallory') })).status, 403)

    const ok = await call(exportRoute, 'GET', `/api/boards/${code}/export?format=csv`, { code, cookie: owner })
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('cache-control'), 'no-store')
    assert.match(ok.headers.get('content-type'), /^text\/csv; charset=utf-8/)
    assert.match(ok.headers.get('content-disposition'), /^attachment; filename="Plan-A-v2-\d{4}-\d\d-\d\d\.csv"$/)
    assert.equal(ok.text[0], BOM)
    const rows = parse(ok.text.slice(1))
    assert.equal(rows[0].length, 8)
    const texts = rows.slice(1).map((r) => r[3]).sort()
    assert.deepEqual(texts, ["'=cmd|calc", 'fine, with comma'])
    assert.equal(rows[1][0], 'Plan "A", v2')
    assert.equal(ok.text.includes('Gus'), false, 'author names are off by default')

    const withAuthors = await call(exportRoute, 'GET', `/api/boards/${code}/export?format=csv&authors=1`, { code, cookie: owner })
    const arows = parse(withAuthors.text.slice(1))
    assert.equal(arows[0][8], 'Author')
    assert.ok(arows.slice(1).every((r) => r[8] === 'Gus'))
    assert.equal(/KM-[A-Z0-9]{4}-/.test(withAuthors.text), false, 'no public ids')

    assert.equal((await call(exportRoute, 'GET', `/api/boards/${code}/export`, { code, cookie: owner })).status, 400)
    assert.equal((await call(exportRoute, 'GET', `/api/boards/${code}/export?format=xlsx`, { code, cookie: owner })).status, 400)
    assert.equal((await call(exportRoute, 'GET', `/api/boards/${code}/export?format=csv&authors=yes`, { code, cookie: owner })).status, 400)
    assert.equal((await call(exportRoute, 'GET', '/api/boards/ZZZZZZ/export?format=csv', { code: 'ZZZZZZ', cookie: owner })).status, 404)
  })

  test('rate limited to 10 a minute per owner', async () => {
    const owner = await signUp('Rita')
    const code = j(await call(createBoard, 'POST', '/api/boards', { cookie: owner, body: { type: 'workshop', template: 'blank', title: 'T' } })).code
    const statuses = []
    for (let i = 0; i < 12; i++) statuses.push((await call(exportRoute, 'GET', `/api/boards/${code}/export?format=csv`, { code, cookie: owner })).status)
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200))
    assert.deepEqual(statuses.slice(10), [429, 429])
  })
})
