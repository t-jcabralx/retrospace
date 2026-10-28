import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultRetro, validateRetroConfig, applyRetroAction as act, timerState, retroEffects, stageKey, enabledStages, rankTopics, topicOf, RetroError, STAGE_KEYS, RETRO_ACTION_KEYS } from '../src/lib/retro.js'

const MIN = 60_000
const T0 = 1_000_000
const started = (now = T0) => act(defaultRetro(), { type: 'start' }, now)
const goTo = (key, now = T0) => act(defaultRetro(), { type: 'goto', index: STAGE_KEYS.indexOf(key) }, now)

test('the default workflow: seven stages in order with their default timers', () => {
  const r = defaultRetro()
  assert.deepEqual(r.stages.map((s) => s.key), ['join', 'collect', 'group', 'vote', 'discuss', 'actions', 'wrapup'])
  assert.deepEqual(r.stages.map((s) => s.durationMs), [1 * MIN, 5 * MIN, null, 2 * MIN, 8 * MIN, 5 * MIN, 2 * MIN])
  assert.ok(r.stages.every((s) => s.enabled))
  assert.deepEqual([r.current, r.stageStartedAt, r.pausedAt, r.elapsedBeforePause, r.editing, r.topN, r.maxActions, r.votesPerPerson], [0, null, null, 0, false, 3, 3, 3])
  assert.notEqual(defaultRetro().stages, r.stages) // a fresh copy each time
})

test('config validation: bounds, keys, labels, durations', () => {
  const ok = (i) => assert.equal(validateRetroConfig(i).ok, true, JSON.stringify(i))
  const no = (i, m) => { const r = validateRetroConfig(i); assert.equal(r.ok, false, JSON.stringify(i)); if (m) assert.match(r.error, m) }
  ok({}); ok({ topN: 1 }); ok({ topN: 10 }); ok({ maxActions: 20 }); ok({ votesPerPerson: 1 })
  for (const v of [0, 11, 1.5, '3', null]) no({ topN: v })
  for (const v of [0, 21]) { no({ maxActions: v }); no({ votesPerPerson: v }) }
  no({ extra: 1 }); no(null); no([]); no('x')
  const base = defaultRetro().stages
  ok({ stages: base })
  const mut = (f) => base.map((s, i) => f({ ...s }, i))
  no({ stages: mut((s) => (s.key === 'group' ? { ...s, key: 'bogus' } : s)) })
  no({ stages: mut((s, i) => (i === 1 ? { ...s, key: 'join' } : s)) }, /invalid stage/) // duplicate key
  no({ stages: mut((s) => ({ ...s, enabled: s.key === 'join' })) }, /two stages/)
  no({ stages: base.slice(0, 1) })
  no({ stages: mut((s) => ({ ...s, label: 'x'.repeat(41) })) })
  no({ stages: mut((s) => ({ ...s, label: '  ' })) })
  ok({ stages: mut((s) => ({ ...s, label: 'x'.repeat(40) })) })
  no({ stages: mut((s) => ({ ...s, durationMs: 9_999 })) })
  no({ stages: mut((s) => ({ ...s, durationMs: 4 * 60 * MIN + 1 })) })
  ok({ stages: mut((s) => ({ ...s, durationMs: 10_000 })) })
  ok({ stages: mut((s) => ({ ...s, durationMs: 4 * 60 * MIN })) })
  ok({ stages: mut((s) => ({ ...s, durationMs: null })) })
  no({ stages: mut((s) => ({ ...s, enabled: 'yes' })) })
  const out = validateRetroConfig({ stages: mut((s) => ({ ...s, label: ` ${s.label}\n`, junk: 1 })) })
  assert.deepEqual(out.value.stages[0], { key: 'join', label: 'Join', durationMs: MIN, enabled: true }) // trimmed, unknown fields dropped
})

test('start sets stageStartedAt; next/prev move through the stages and restart the clock', () => {
  const s = started()
  assert.equal(s.stageStartedAt, T0)
  const n = act(s, { type: 'next' }, T0 + 5000)
  assert.deepEqual([n.current, n.stageStartedAt, n.pausedAt, n.elapsedBeforePause, stageKey(n)], [1, T0 + 5000, null, 0, 'collect'])
  assert.equal(n.editing, true) // Collect opens for notes
  const g = act(n, { type: 'next' }, T0 + 6000)
  assert.equal(g.editing, false)
  assert.equal(act(g, { type: 'prev' }, T0 + 7000).current, 1)
  assert.throws(() => act(defaultRetro(), { type: 'prev' }, T0), RetroError)
  assert.throws(() => act(goTo('wrapup'), { type: 'next' }, T0), /last stage/)
})

test('goto: any stage, bounds checked; skipped stages are not counted', () => {
  assert.equal(stageKey(act(defaultRetro(), { type: 'goto', index: 6 }, T0)), 'wrapup')
  for (const index of [-1, 7, 1.5, '1', undefined]) assert.throws(() => act(defaultRetro(), { type: 'goto', index }, T0), RetroError)
  const stages = defaultRetro().stages.map((s) => ({ ...s, enabled: !['group', 'join'].includes(s.key) }))
  const r = act(defaultRetro(), { type: 'config', stages }, T0)
  assert.deepEqual(enabledStages(r).map((s) => s.key), ['collect', 'vote', 'discuss', 'actions', 'wrapup'])
  assert.equal(stageKey(r), 'collect') // the current stage was switched off: the one at the same place
  assert.equal(stageKey(act(r, { type: 'next' }, T0)), 'vote') // Group is skipped
  assert.throws(() => act(r, { type: 'goto', index: 5 }, T0), RetroError)
})

test('timer: nothing before start, no timer on Group, countdown otherwise', () => {
  assert.deepEqual(timerState(defaultRetro(), T0), { endsAt: null, remainingMs: null, paused: false })
  const c = goTo('collect')
  assert.deepEqual(timerState(c, T0 + 1000), { endsAt: T0 + 5 * MIN, remainingMs: 5 * MIN - 1000, paused: false })
  assert.deepEqual(timerState(goTo('group'), T0 + 1000), { endsAt: null, remainingMs: null, paused: false })
  assert.equal(timerState(c, T0 + 10 * MIN).remainingMs, 0) // past the end: zero, not negative
})

test('pause and resume account for the paused time', () => {
  const c = goTo('collect') // 5 min from T0
  const p = act(c, { type: 'pause' }, T0 + 2 * MIN)
  assert.deepEqual(timerState(p, T0 + 9 * MIN), { endsAt: null, remainingMs: 3 * MIN, paused: true })
  const r = act(p, { type: 'resume' }, T0 + 10 * MIN)
  assert.equal(timerState(r, T0 + 10 * MIN).endsAt, T0 + 13 * MIN)
  const p2 = act(r, { type: 'pause' }, T0 + 11 * MIN) // 1 more minute used
  assert.equal(timerState(p2, T0 + 20 * MIN).remainingMs, 2 * MIN)
  assert.throws(() => act(p, { type: 'pause' }, T0), /Nothing to pause/)
  assert.throws(() => act(c, { type: 'resume' }, T0), /Not paused/)
  assert.throws(() => act(defaultRetro(), { type: 'pause' }, T0), RetroError) // not started
  assert.equal(act(p, { type: 'next' }, T0 + 3 * MIN).pausedAt, null) // moving on clears the pause
})

test('extend adds time, also while paused and after the end; bounded', () => {
  const c = goTo('collect')
  assert.equal(timerState(act(c, { type: 'extend', ms: MIN }, T0 + MIN), T0 + MIN).endsAt, T0 + 6 * MIN)
  const p = act(c, { type: 'pause' }, T0 + MIN)
  assert.equal(timerState(act(p, { type: 'extend', ms: MIN }, T0 + 2 * MIN), T0 + 3 * MIN).remainingMs, 5 * MIN)
  const late = act(c, { type: 'extend', ms: MIN }, T0 + 7 * MIN) // 2 min over, +1 min: still over, but closer
  assert.equal(timerState(late, T0 + 7 * MIN).remainingMs, 0)
  assert.throws(() => act(goTo('group'), { type: 'extend', ms: MIN }, T0), /no timer/)
  for (const ms of [0, 999, 61 * MIN, 1.5, '60000']) assert.throws(() => act(c, { type: 'extend', ms }, T0), RetroError)
})

test('setEditing and unknown actions', () => {
  assert.equal(act(defaultRetro(), { type: 'setEditing', value: true }, T0).editing, true)
  assert.throws(() => act(defaultRetro(), { type: 'setEditing', value: 'yes' }, T0), RetroError)
  for (const a of [{ type: 'explode' }, { type: 5 }, null, 'next', []]) assert.throws(() => act(defaultRetro(), a, T0), RetroError)
  assert.equal(Object.hasOwn(RETRO_ACTION_KEYS, 'toString'), false)
})

test('config keeps the room on the same stage when the list is reordered, and changes the numbers', () => {
  const r = goTo('vote')
  const stages = [...r.stages].reverse()
  const n = act(r, { type: 'config', stages, topN: 5, maxActions: 7, votesPerPerson: 4 }, T0 + 1000)
  assert.equal(stageKey(n), 'vote')
  assert.deepEqual([n.topN, n.maxActions, n.votesPerPerson, n.stageStartedAt], [5, 7, 4, T0])
  assert.throws(() => act(r, { type: 'config', topN: 99 }, T0), RetroError)
  assert.throws(() => act(r, { type: 'config', current: 3 }, T0), RetroError) // state cannot be set directly
})

test('effects: the vote opens in a started Vote stage and closes after it; the timer follows the stage', () => {
  const board = {}
  const c = goTo('collect')
  const v = act(c, { type: 'goto', index: 3 }, T0 + 1000)
  const e = retroEffects(c, v, board, T0 + 1000)
  assert.deepEqual(e.vote, { active: true, perPerson: 3 })
  assert.deepEqual(e.timer, { endsAt: T0 + 1000 + 2 * MIN, durationMs: 2 * MIN })
  const d = act(v, { type: 'next' }, T0 + 2000)
  assert.deepEqual(retroEffects(v, d, board, T0 + 2000).vote, { active: false, perPerson: 3 })
  const g = act(c, { type: 'next' }, T0 + 2000) // Group has no timer
  assert.deepEqual(retroEffects(c, g, board, T0 + 2000), { timer: null })
  const p = act(v, { type: 'pause' }, T0 + 3000)
  const pe = retroEffects(v, p, board, T0 + 3000)
  assert.equal(pe.timer, null)
  assert.equal('vote' in pe, false) // pausing does not close voting
  assert.deepEqual(retroEffects(null, started(), board, T0).vote, undefined) // starting Join: nothing about votes
})

// --- topics ---------------------------------------------------------------------------------------------------
const it = (id, votes, extra = {}) => ({ id, kind: 'note', data: { text: `t-${id}` }, votes: Array.from({ length: votes }, (_, n) => `u${n}`), updatedAt: 1, ...extra })

test('rankTopics: top N by votes, no ties flagged when they fit', () => {
  const rows = rankTopics([it('a', 5), it('b', 3), it('c', 1), it('z', 0), it('d', 2, { deleted: true }), { ...it('f', 9), kind: 'frame' }], 2)
  assert.deepEqual(rows.map((r) => [r.id, r.votes, r.tied, r.selected]), [['a', 5, false, true], ['b', 3, false, true]])
  assert.equal(rows[0].text, 't-a')
  assert.deepEqual(rankTopics([], 3), [])
  assert.deepEqual(rankTopics([it('a', 0)], 3), [])
  assert.deepEqual(rankTopics([it('a', 2), it('b', 1)], 5).map((r) => r.selected), [true, true])
})

test('rankTopics: a tie at the cut-off is flagged and the owner picks', () => {
  const items = [it('a', 5), it('b', 3), it('c', 3), it('d', 3), it('e', 1)]
  const rows = rankTopics(items, 3)
  assert.deepEqual(rows.map((r) => [r.id, r.tied, r.selected]), [['a', false, true], ['b', true, false], ['c', true, false], ['d', true, false]])
  const picked = rankTopics(items, 3, ['c', 'd', 'e', 'zzz'])
  assert.deepEqual(picked.filter((r) => r.selected).map((r) => r.id), ['a', 'c', 'd'])
  assert.equal(rankTopics(items, 3, ['b', 'c', 'd']).filter((r) => r.selected).length, 3) // never more than topN
  assert.equal(rankTopics([it('a', 2), it('b', 2), it('c', 2)], 3).every((r) => r.selected && !r.tied), true) // all fit
  assert.equal(rankTopics([it('a', 2), it('b', 2)], 1).every((r) => r.tied && !r.selected), true)
})

test('topic action: status and notes, bounded, prototype-safe', () => {
  const r0 = defaultRetro()
  const r1 = act(r0, { type: 'topic', itemId: 'a1', status: 'discussed', note: ' We agreed ' }, T0)
  assert.deepEqual(topicOf(r1, 'a1'), { status: 'discussed', notes: [{ text: 'We agreed', at: T0 }] })
  assert.deepEqual(topicOf(r1, 'nope'), { status: 'not', notes: [] })
  assert.deepEqual(r0.topics, {}) // not mutated
  const r2 = act(r1, { type: 'topic', itemId: 'a1', note: 'More' }, T0 + 1)
  assert.deepEqual([r2.topics.a1.status, r2.topics.a1.notes.length], ['discussed', 2])
  for (const bad of [{ itemId: '__proto__', status: 'action' }, { itemId: 'constructor', status: 'action' }, { itemId: 'a b', status: 'action' }, { itemId: 'a1' }, { itemId: 'a1', status: 'later' }, { itemId: 'a1', note: '' }, { itemId: 'a1', note: 'x'.repeat(301) }, { itemId: 5, status: 'action' }])
    assert.throws(() => act(r1, { type: 'topic', ...bad }, T0), RetroError, JSON.stringify(bad))
  let r = r0
  for (let i = 0; i < 20; i++) r = act(r, { type: 'topic', itemId: 'a1', note: `n${i}` }, T0)
  assert.throws(() => act(r, { type: 'topic', itemId: 'a1', note: 'one more' }, T0), /Too many notes/)
  assert.equal(({}).polluted, undefined)
  assert.equal(topicOf({ topics: {} }, 'toString').status, 'not')
})
