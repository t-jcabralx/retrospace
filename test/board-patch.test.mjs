import test from 'node:test'
import assert from 'node:assert/strict'
import { checkPatch, resolvePatch } from '../src/lib/boardPatch.js'
import { verifyPassword } from '../src/lib/password.js'

const ok = async (patch) => {
  const r = await checkPatch(patch)
  assert.equal(r.error, undefined, JSON.stringify(patch))
  return r.value
}
const bad = async (patch, message) => {
  const r = await checkPatch(patch)
  assert.equal(typeof r.error, 'string', JSON.stringify(patch))
  if (message) assert.match(r.error, message)
}

test('the existing settings still validate', async () => {
  assert.deepEqual(await ok({ title: '  Hi  ', locked: true }), { title: 'Hi', locked: true })
  assert.deepEqual(await ok({ vote: { active: true, perPerson: 3 }, timer: null, recipient: { name: 'Zed' }, revealAt: null }), { vote: { active: true, perPerson: 3 }, timer: null, recipient: { name: 'Zed' }, revealAt: null })
  await bad({ title: 'x'.repeat(81) })
  await bad({ vote: { active: true, perPerson: 99 } })
  await bad({ color: 'red' }, /unknown setting/)
  await bad({}, /non-empty/)
  await bad(null)
  await bad([])
})

test('status accepts only open and closed', async () => {
  assert.deepEqual(await ok({ status: 'closed' }), { status: 'closed' })
  assert.deepEqual(await ok({ status: 'open' }), { status: 'open' })
  for (const v of ['archived', '', null, true, 1, undefined]) await bad({ status: v })
})

test('revoked must be a boolean', async () => {
  assert.deepEqual(await ok({ revoked: true }), { revoked: true })
  assert.deepEqual(await ok({ revoked: false }), { revoked: false })
  for (const v of ['true', 1, null, {}]) await bad({ revoked: v })
})

test('a passcode of 4-64 characters becomes passcodeHash and is never kept in plain text', async () => {
  const value = await ok({ passcode: 'open sesame', title: 'T' })
  assert.equal('passcode' in value, false)
  assert.equal(value.title, 'T')
  assert.match(value.passcodeHash, /^scrypt\$/)
  assert.ok(!value.passcodeHash.includes('open sesame'))
  assert.equal(await verifyPassword('open sesame', value.passcodeHash), true)
  assert.equal(await verifyPassword('open sesamE', value.passcodeHash), false)
  await ok({ passcode: 'abcd' })
  await ok({ passcode: 'x'.repeat(64) })
})

test('passcode null clears the hash; a bad passcode is rejected', async () => {
  assert.deepEqual(await ok({ passcode: null }), { passcodeHash: null })
  for (const v of ['abc', '', 'x'.repeat(65), 1234, true, {}, []]) await bad({ passcode: v }, /passcode/)
})

test('passcodeHash, ownerId, code and other internals cannot be set directly', async () => {
  for (const k of ['passcodeHash', 'ownerId', 'createdBy', 'code', 'ownerKeyHash', 'lastTs', 'type']) await bad({ [k]: 'x' }, /unknown setting/)
})

// ---- timer, throwables, vote (Task 7B) ----
const MIN = 60_000

test('timer needs endsAt and durationMs; durationMs 10 s..4 h; endsAt within now-5s..now+durationMs+1min; null clears', async () => {
  const now = Date.now()
  const good = { endsAt: now + 5 * MIN, durationMs: 5 * MIN }
  assert.deepEqual(await ok({ timer: good }), { timer: good })
  assert.deepEqual(await ok({ timer: null }), { timer: null })
  await ok({ timer: { endsAt: now - 2_000, durationMs: 10_000 } }) // a slow request
  await ok({ timer: { endsAt: now + 4 * 60 * MIN, durationMs: 4 * 60 * MIN } })
  await ok({ timer: { endsAt: now + 5 * MIN + 59_000, durationMs: 5 * MIN } }) // just under a minute beyond: the +1 min extension
  await ok({ timer: { endsAt: now + 6 * MIN - 1000, durationMs: 6 * MIN } })
  for (const t of [
    {}, { endsAt: now + MIN }, { durationMs: MIN }, { endsAt: '1', durationMs: MIN }, { endsAt: now + MIN, durationMs: '60000' },
    { endsAt: NaN, durationMs: MIN }, { endsAt: Infinity, durationMs: MIN }, { endsAt: now + MIN, durationMs: NaN },
    { endsAt: now + MIN, durationMs: 9_999 }, { endsAt: now + MIN, durationMs: 4 * 60 * MIN + 1 }, { endsAt: now + MIN, durationMs: -5 },
    { endsAt: now - 30_000, durationMs: MIN }, { endsAt: now - 2 * MIN, durationMs: MIN }, { endsAt: 0, durationMs: MIN },
    { endsAt: now + 4 * 60 * MIN + 2 * MIN, durationMs: MIN },
    { endsAt: now + 5 * MIN + 2 * MIN, durationMs: 5 * MIN }, // ends more than a minute after now + duration
    { endsAt: now + 3 * 60 * MIN, durationMs: MIN }, // a 1 minute timer cannot end in 3 hours
    5, 'x', [], true,
  ]) await bad({ timer: t }, /timer/)
})

test('the +1 min extension (endsAt and durationMs both plus a minute) stays valid while the timer runs', async () => {
  const now = Date.now()
  let t = { endsAt: now + 90_000, durationMs: 90_000 }
  for (let i = 0; i < 3; i++) {
    t = { endsAt: t.endsAt + MIN, durationMs: t.durationMs + MIN }
    assert.deepEqual(await ok({ timer: t }), { timer: t }, `extension ${i + 1}`)
  }
  await ok({ timer: { endsAt: now - 3_000 + MIN, durationMs: 10_000 + MIN } }) // extended 3 s after it ran out
})

test('timer keeps only endsAt and durationMs', async () => {
  const now = Date.now()
  const v = await ok({ timer: { endsAt: now + MIN, durationMs: MIN, evil: 1, x: '<b>' } })
  assert.deepEqual(Object.keys(v.timer).sort(), ['durationMs', 'endsAt'])
})

test('throwables: enabled boolean and 1-12 unique single emoji', async () => {
  const t = { enabled: true, emojis: ['🍌', '🗑️', '👩‍💻'] }
  assert.deepEqual(await ok({ throwables: t }), { throwables: t })
  assert.deepEqual(await ok({ throwables: { enabled: false, emojis: ['🍌'], junk: 1 } }), { throwables: { enabled: false, emojis: ['🍌'] } })
  const twelve = ['🍌', '🗑️', '🐵', '🍅', '🌹', '❤️', '👏', '🎉', '🔥', '😂', '🙌', '🚀']
  await ok({ throwables: { enabled: true, emojis: twelve } })
  await bad({ throwables: { enabled: true, emojis: [...twelve, '🧀'] } }, /throwables/) // 13
  await bad({ throwables: { enabled: true, emojis: [] } }, /throwables/)
  await bad({ throwables: { enabled: true, emojis: ['🍌', '🍌'] } }, /throwables/) // duplicate
  for (const e of ['a', '12', '🍌🍌', '<b>', '🍌x', ' ', '', 5, null, {}]) await bad({ throwables: { enabled: true, emojis: ['🍌', e] } }, /throwables/)
  for (const v of [{ emojis: ['🍌'] }, { enabled: 'yes', emojis: ['🍌'] }, { enabled: true }, { enabled: true, emojis: '🍌' }, null, 'x', [], true]) await bad({ throwables: v }, /throwables/)
})

test('vote: active boolean, perPerson integer 1..20', async () => {
  assert.deepEqual(await ok({ vote: { active: false, perPerson: 20, extra: 1 } }), { vote: { active: false, perPerson: 20 } })
  await ok({ vote: { active: true, perPerson: 1 } })
  for (const v of [{ active: true, perPerson: 0 }, { active: true, perPerson: 21 }, { active: true, perPerson: 2.5 }, { active: 'yes', perPerson: 3 }, { perPerson: 3 }, { active: true }, { active: true, perPerson: '3' }, null, 5])
    await bad({ vote: v }, /vote/)
})

test('revealAt takes an ISO date-time (any zone, past included) or null, and nothing else', async () => {
  const iso = '2030-05-01T12:00:00.000Z'
  assert.deepEqual(await ok({ revealAt: iso }), { revealAt: new Date(iso) })
  assert.deepEqual(await ok({ revealAt: null }), { revealAt: null })
  assert.equal((await ok({ revealAt: '2030-05-01T14:00:00+02:00' })).revealAt.toISOString(), iso)
  assert.equal((await ok({ revealAt: '2028-02-29T10:00:00Z' })).revealAt.getUTCDate(), 29, 'a leap day exists')
  assert.equal((await ok({ revealAt: '2001-01-01T00:00:00Z' })).revealAt.getUTCFullYear(), 2001, 'a time in the past is accepted: "Reveal now" is one')
  for (const v of ['', ' ', '1', '12', 'tomorrow', 'soon 5pm', '2030-13-01T00:00:00Z', '2030-02-31T00:00:00Z', '2030-04-31T10:00:00Z', '2030-05-01T24:00:00Z', '2030-05-01T12:61:00Z', '2030-05-01T12:00:61Z', '2030-05-01T12:00', '2030-05-01', 'Wed, 01 May 2030 12:00:00 GMT', '1999-12-31T23:59:59Z', '2101-01-01T00:00:00Z', 1893499200000, true, {}, [], undefined]) {
    await bad({ revealAt: v }, /revealAt/)
  }
})

test('recipient takes { name } of 1-60 characters or null', async () => {
  assert.deepEqual(await ok({ recipient: { name: '  Sam Rivera ' } }), { recipient: { name: 'Sam Rivera' } })
  assert.deepEqual(await ok({ recipient: null }), { recipient: null })
  assert.equal((await ok({ recipient: { name: 'n'.repeat(60) } })).recipient.name.length, 60)
  for (const v of [{ name: '' }, { name: '   ' }, { name: 'n'.repeat(61) }, { name: 5 }, {}, 'Sam', [], 5]) await bad({ recipient: v }, /recipient/)
})

test('ai: only enabled, autoSummary, autoShare and ack, all booleans', async () => {
  assert.deepEqual(await ok({ ai: { enabled: true, ack: true } }), { ai: { enabled: true, ack: true } })
  assert.deepEqual(await ok({ ai: { autoShare: false } }), { ai: { autoShare: false } })
  for (const v of [{}, [], null, 'on', { enabled: 'yes' }, { enabled: 1 }, { ack: null }, { enabled: true, model: 'x' }, { ackAt: 1 }, { __proto__: null, x: 1 }]) await bad({ ai: v })
})

test('summary: text (1-4000, control characters stripped), status draft|shared, or null', async () => {
  assert.deepEqual(await ok({ summary: null }), { summary: null })
  assert.deepEqual(await ok({ summary: { text: '  Line one\r\n\r\n\r\n\r\nLine two\u0007 ' } }), { summary: { text: 'Line one\n\nLine two' } })
  assert.deepEqual(await ok({ summary: { status: 'shared' } }), { summary: { status: 'shared' } })
  assert.deepEqual(await ok({ summary: { text: 'x'.repeat(4000), status: 'draft' } }), { summary: { text: 'x'.repeat(4000), status: 'draft' } })
  await bad({ summary: { text: 'x'.repeat(4001) } }, /4000/)
  for (const v of [{}, [], 'text', { text: '' }, { text: '   ' }, { text: '\u0007' }, { text: 5 }, { status: 'published' }, { status: null }, { source: 'manual' }, { model: 'x' }, { text: 'a', editedAt: 1 }]) await bad({ summary: v })
})

const aiBoard = (ai, extra = {}) => ({ code: 'ABC234', status: 'open', ai, ...extra })

test('resolvePatch: the first enable needs ack:true and records ackAt; later toggles do not', () => {
  const off = aiBoard({ enabled: false, ackAt: null, autoSummary: false, autoShare: false })
  assert.match(resolvePatch(off, { ai: { enabled: true } }, 1000).error, /understand/)
  assert.match(resolvePatch(off, { ai: { enabled: true, ack: false } }, 1000).error, /understand/)
  assert.deepEqual(resolvePatch(off, { ai: { enabled: true, ack: true } }, 1000).value.ai, { enabled: true, ackAt: 1000, autoSummary: false, autoShare: false })
  const again = aiBoard({ enabled: false, ackAt: 500, autoSummary: false, autoShare: false })
  assert.deepEqual(resolvePatch(again, { ai: { enabled: true } }, 1000).value.ai, { enabled: true, ackAt: 500, autoSummary: false, autoShare: false })
  // a board made before AI existed has no ai field at all
  assert.match(resolvePatch({ code: 'X' }, { ai: { enabled: true } }, 1).error, /understand/)
  assert.equal(resolvePatch({ code: 'X' }, { ai: { enabled: true, ack: true } }, 7).value.ai.ackAt, 7)
})

test('resolvePatch: autoSummary and autoShare only while AI is on; turning AI off clears them', () => {
  const off = aiBoard({ enabled: false, ackAt: 500, autoSummary: false, autoShare: false })
  assert.match(resolvePatch(off, { ai: { autoSummary: true } }).error, /on first/)
  assert.match(resolvePatch(off, { ai: { enabled: false, autoShare: true } }).error, /on first/)
  assert.deepEqual(resolvePatch(off, { ai: { enabled: true, autoSummary: true, autoShare: true } }, 9).value.ai, { enabled: true, ackAt: 500, autoSummary: true, autoShare: true })
  const on = aiBoard({ enabled: true, ackAt: 500, autoSummary: true, autoShare: true })
  assert.deepEqual(resolvePatch(on, { ai: { autoShare: false } }).value.ai, { enabled: true, ackAt: 500, autoSummary: true, autoShare: false })
  assert.deepEqual(resolvePatch(on, { ai: { enabled: false } }).value.ai, { enabled: false, ackAt: 500, autoSummary: false, autoShare: false })
})

test('resolvePatch: summary edits keep the source and mark the edit; a first manual summary is a draft by hand', () => {
  const ai = { text: 'Original', status: 'draft', source: 'ai', model: 'm', generatedAt: 5, editedAt: null }
  assert.deepEqual(resolvePatch(aiBoard({}, { summary: ai }), { summary: { text: 'Better' } }, 100).value.summary, { ...ai, text: 'Better', editedAt: 100 })
  assert.deepEqual(resolvePatch(aiBoard({}, { summary: ai }), { summary: { text: 'Original' } }, 100).value.summary, ai, 'the same text is not an edit')
  assert.deepEqual(resolvePatch(aiBoard({}, { summary: ai }), { summary: { status: 'shared' } }, 100).value.summary, { ...ai, status: 'shared' })
  assert.deepEqual(resolvePatch(aiBoard({}, { summary: ai }), { summary: { text: 'T', status: 'shared' } }, 100).value.summary, { ...ai, text: 'T', status: 'shared', editedAt: 100 })
  assert.deepEqual(resolvePatch(aiBoard({}), { summary: { text: 'Mine' } }, 100).value.summary, { text: 'Mine', status: 'draft', source: 'manual', model: null, generatedAt: null, editedAt: 100 })
  assert.deepEqual(resolvePatch(aiBoard({}), { summary: { text: 'Mine', status: 'shared' } }, 100).value.summary.status, 'shared')
  assert.match(resolvePatch(aiBoard({}), { summary: { status: 'shared' } }).error, /no summary/i)
  assert.equal(resolvePatch(aiBoard({}, { summary: ai }), { summary: null }).value.summary, null)
  assert.deepEqual(resolvePatch(aiBoard({}, { summary: ai, summaryState: 'failed' }), { summary: null }).value, { summary: null, summaryState: 'idle', summaryError: null })
})

test('resolvePatch: closing records closedAt once; reopening clears it', () => {
  assert.equal(resolvePatch(aiBoard({}), { status: 'closed' }, 42).value.closedAt, 42)
  assert.equal(Object.hasOwn(resolvePatch(aiBoard({}, { status: 'closed', closedAt: 10 }), { status: 'closed' }, 42).value, 'closedAt'), false, 'closing twice keeps the first time')
  assert.equal(resolvePatch(aiBoard({}, { status: 'closed', closedAt: 10 }), { status: 'open' }, 42).value.closedAt, null)
  assert.equal(resolvePatch(aiBoard({}, { status: 'closed' }), { status: 'closed' }, 42).value.closedAt, 42, 'a closed board with no stamp gets one')
  assert.equal(resolvePatch(aiBoard({}, { autoSummaryFor: 42 }), { status: 'closed' }, 42).value.closedAt, 43, 'a new closure never reuses the stamp of one that had its summary')
  assert.deepEqual(resolvePatch(aiBoard({}), { title: 'T' }, 1).value, { title: 'T' })
})
