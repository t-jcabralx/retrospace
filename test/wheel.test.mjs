import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultWheel, cleanSetup, celebrationFor, applyAction, ringPeople, ringPrizes, isRunner, spinAngle, spinning, historyRows, LIMITS, SPIN } from '../src/lib/wheel.js'

let n = 0
const genId = () => `g${++n}`
const NOW = 1_000_000
const first = () => 0
const last = (len) => len - 1

function setup(people = ['Maria', 'John', 'Priya'], prizes = [['Gift card', 1], ['Coffee', 2]], extra = {}) {
  const r = cleanSetup({ participants: people.map((name) => ({ name })), prizes: prizes.map(([name, qty]) => ({ name, qty, emoji: '🎁' })), ...extra }, { genId })
  assert.ok(r.value, r.error)
  return { ...defaultWheel(), ...r.value }
}
const run = (w, action, ctx = {}) => applyAction(w, action, { now: NOW, pick: first, by: 'owner-uid', ...ctx })
const ok = (r) => { assert.ok(r.wheel, r.error); return r.wheel }
const after = NOW + SPIN.leadMs + SPIN.winnerMs + 1 // later than any spin

test('the default wheel is empty, idle and removes winners', () => {
  const w = defaultWheel()
  assert.deepEqual([w.participants, w.prizes, w.helpers, w.history], [[], [], [], []])
  assert.equal(w.round.state, 'idle')
  assert.equal(w.rules.removeWinners, true)
})

test('cleanSetup trims, drops blank and repeated names, keeps valid ids and fills the rest', () => {
  const r = cleanSetup({ participants: [{ name: '  Maria ' }, { name: 'maria' }, { name: '   ' }, { id: 'keep_1', name: 'John', on: false }, { name: 'Priya' }], prizes: [{ name: 'Mug', qty: 3, color: '#ABCDEF' }, { name: '' }] }, { genId })
  assert.deepEqual(r.value.participants.map((p) => [p.name, p.on]), [['Maria', true], ['John', false], ['Priya', true]])
  assert.equal(r.value.participants[1].id, 'keep_1')
  assert.equal(r.value.prizes.length, 1)
  assert.equal(r.value.prizes[0].color, '#abcdef')
  assert.equal(new Set(r.value.participants.map((p) => p.id)).size, 3)
})

test('cleanSetup enforces the limits and rejects bad shapes', () => {
  const many = (k) => Array.from({ length: k }, (_, i) => ({ name: `P${i}` }))
  assert.ok(cleanSetup({ participants: many(LIMITS.participants), prizes: [] }, { genId }).value)
  assert.match(cleanSetup({ participants: many(LIMITS.participants + 1), prizes: [] }, { genId }).error, /200/)
  assert.match(cleanSetup({ participants: [], prizes: Array.from({ length: 31 }, (_, i) => ({ name: `Z${i}` })) }, { genId }).error, /30/)
  for (const qty of [-1, 100, 1.5, '2']) assert.ok(cleanSetup({ participants: [], prizes: [{ name: 'x', qty }] }, { genId }).error, String(qty))
  for (const bad of [null, [], 'x', { participants: 'no', prizes: [] }, { participants: [], prizes: [], rules: { removeWinners: 'yes' } }, { participants: [], prizes: [], helpers: new Array(11).fill('h') }]) assert.ok(cleanSetup(bad, { genId }).error, JSON.stringify(bad))
  assert.equal(cleanSetup({ participants: [{ name: 'x'.repeat(200) }], prizes: [] }, { genId }).value.participants[0].name.length, LIMITS.name)
})

test('cleanSetup cannot hand out the won flag, only keep it for ids already won', () => {
  const prev = { ...defaultWheel(), participants: [{ id: 'w1', name: 'Won', on: true, won: true }] }
  const r = cleanSetup({ participants: [{ id: 'w1', name: 'Won', won: false }, { id: 'n1', name: 'New', won: true }], prizes: [] }, { previous: prev, genId })
  assert.deepEqual(r.value.participants.map((p) => [p.id, Boolean(p.won)]), [['w1', true], ['n1', false]])
})

test('a full round: prize, winner, accept lowers the quantity, marks the winner and records history', () => {
  let w = setup()
  w = ok(run(w, 'spin-prize'))
  assert.equal(w.round.state, 'prizeChosen')
  assert.equal(w.round.prizeId, w.prizes[0].id)
  assert.deepEqual(w.round.spin, { id: 1, step: 'prize', index: 0, count: 2, startAt: NOW + SPIN.leadMs, durationMs: SPIN.prizeMs })
  w = ok(run(w, 'spin-winner', { now: after, pick: last }))
  assert.equal(w.round.state, 'winnerChosen')
  assert.equal(w.round.winnerId, w.participants[2].id)
  w = ok(run(w, 'accept', { now: after + SPIN.winnerMs + 1000 }))
  assert.equal(w.round.state, 'idle')
  assert.equal(w.prizes[0].qty, 0)
  assert.equal(w.participants[2].won, true)
  assert.equal(w.history.length, 1)
  assert.deepEqual(w.history[0].winner, { id: w.participants[2].id, name: 'Priya' })
  assert.equal(w.history[0].by, 'owner-uid')
  assert.deepEqual(ringPrizes(w).map((z) => z.name), ['Coffee'])
  assert.deepEqual(ringPeople(w).map((p) => p.name), ['Maria', 'John'])
})

test('the pick is the only source of the result and is used as given', () => {
  const w = setup(['A', 'B', 'C', 'D'], [['X', 1], ['Y', 1], ['Z', 1]])
  const seen = []
  const w1 = ok(run(w, 'spin-prize', { pick: (len) => { seen.push(len); return 1 } }))
  assert.equal(w1.round.prizeId, w.prizes[1].id)
  const w2 = ok(run(w1, 'spin-winner', { now: after, pick: (len) => { seen.push(len); return 3 } }))
  assert.equal(w2.round.winnerId, w.participants[3].id)
  assert.deepEqual(seen, [3, 4])
  assert.ok(run(w, 'spin-prize', { pick: () => 99 }).error)
  assert.ok(run(w, 'spin-prize', { pick: () => -1 }).error)
  assert.ok(run(w, 'spin-prize', { pick: () => 0.5 }).error)
})

test('a spin refuses to start without people or a prize, or from the wrong state', () => {
  assert.match(run(setup([], [['Mug', 1]]), 'spin-prize').error, /participant/)
  assert.match(run(setup(['A'], []), 'spin-prize').error, /prize/)
  assert.match(run(setup(['A'], [['Mug', 0]]), 'spin-prize').error, /prize/)
  const w = setup()
  assert.match(run(w, 'spin-winner').error, /prize first/)
  assert.match(run(w, 'accept').error, /no winner/)
  const chosen = ok(run(w, 'spin-prize'))
  assert.match(run(chosen, 'spin-prize', { now: after }).error, /current round/)
  assert.match(run(w, 'nonsense').error, /Unknown/)
})

test('nothing can be pressed while a spin is still turning', () => {
  const w = ok(run(setup(), 'spin-prize'))
  assert.equal(spinning(w.round, NOW + 100), true)
  assert.match(run(w, 'spin-winner', { now: NOW + 100 }).error, /Wait/)
  assert.match(run(w, 'back', { now: NOW + 100 }).error, /Wait/)
  assert.equal(spinning(w.round, after), false)
  assert.ok(run(w, 'spin-winner', { now: after }).wheel)
})

test('skip sits the winner out for this round only and spins again; back steps one stage', () => {
  let w = ok(run(setup(), 'spin-prize'))
  w = ok(run(w, 'spin-winner', { now: after }))
  const skipped = w.round.winnerId
  w = ok(run(w, 'skip', { now: after + 9000 }))
  assert.equal(w.round.state, 'prizeChosen')
  assert.deepEqual(w.round.sitOut, [skipped])
  assert.ok(!ringPeople(w).some((p) => p.id === skipped))
  w = ok(run(w, 'spin-winner', { now: after + 9000 }))
  assert.notEqual(w.round.winnerId, skipped)
  w = ok(run(w, 'back', { now: after + 20000 }))
  assert.equal(w.round.state, 'prizeChosen')
  w = ok(run(w, 'back', { now: after + 20000 }))
  assert.equal(w.round.state, 'idle')
  assert.deepEqual(w.round.sitOut, [])
  assert.ok(ringPeople(w).some((p) => p.id === skipped)) // back in the draw next round
  assert.match(run(w, 'back').error, /Nothing/)
})

test('skipping the last person leaves no one to spin for', () => {
  let w = ok(run(setup(['Only'], [['Mug', 1]]), 'spin-prize'))
  w = ok(run(w, 'spin-winner', { now: after }))
  w = ok(run(w, 'skip', { now: after + 9000 }))
  assert.match(run(w, 'spin-winner', { now: after + 9000 }).error, /No one is left/)
})

test('with remove winners off the same person can win again', () => {
  let w = setup(['A', 'B'], [['Mug', 5]], { rules: { removeWinners: false } })
  for (let i = 0; i < 2; i++) {
    w = ok(run(w, 'spin-prize', { now: NOW + i * 100_000 }))
    w = ok(run(w, 'spin-winner', { now: NOW + i * 100_000 + 20_000 }))
    w = ok(run(w, 'accept', { now: NOW + i * 100_000 + 40_000 }))
  }
  assert.equal(ringPeople(w).length, 2)
  assert.deepEqual(w.history.map((h) => h.winner.name), ['A', 'A'])
  assert.deepEqual(w.history.map((h) => h.n), [1, 2])
})

test('undo takes back the last accepted result exactly once', () => {
  let w = ok(run(setup(), 'spin-prize'))
  w = ok(run(w, 'spin-winner', { now: after }))
  w = ok(run(w, 'accept', { now: after + 9000 }))
  const before = structuredClone(w)
  assert.equal(before.history.length, 1)
  const undone = ok(run(w, 'undo', { now: after + 9000 }))
  assert.equal(undone.history.length, 0)
  assert.equal(undone.prizes[0].qty, 1)
  assert.equal(undone.participants[0].won, undefined)
  assert.match(run(undone, 'undo').error, /nothing to undo/)
  assert.equal(before.history.length, 1) // inputs are never mutated
})

test('undo copes with a prize or person deleted since', () => {
  let w = ok(run(setup(), 'spin-prize'))
  w = ok(run(w, 'spin-winner', { now: after }))
  w = ok(run(w, 'accept', { now: after + 9000 }))
  w.prizes = []
  w.participants = []
  const undone = ok(run(w, 'undo', { now: after + 9000 }))
  assert.equal(undone.history.length, 0)
})

test('history keeps the latest 500 lines', () => {
  let w = setup(['A'], [['Mug', 99]], { rules: { removeWinners: false } })
  w.history = Array.from({ length: LIMITS.history }, (_, i) => ({ n: i + 1, at: 1, prize: { id: 'p', name: 'x', emoji: '' }, winner: { id: 'w', name: 'y' }, by: null }))
  w = ok(run(w, 'spin-prize'))
  w = ok(run(w, 'spin-winner', { now: after }))
  w = ok(run(w, 'accept', { now: after + 9000 }))
  assert.equal(w.history.length, LIMITS.history)
  assert.equal(w.history.at(-1).n, LIMITS.history + 1)
  assert.equal(w.history[0].n, 2)
})

test('spinAngle puts the middle of the chosen slice under the pointer for any count', () => {
  for (const count of [1, 2, 3, 5, 8, 24, 200]) {
    for (const index of [0, Math.floor(count / 2), count - 1]) {
      const centre = ((index + 0.5) * 360) / count
      const r = (centre + spinAngle(index, count)) % 360
      assert.ok(Math.min(r, 360 - r) < 1e-9, `${index}/${count}: ${r}`)
      assert.ok(spinAngle(index, count) >= SPIN.turns * 360)
    }
  }
})

test('only the owner and named helpers run the round', () => {
  const w = { ...defaultWheel(), helpers: ['h1'] }
  assert.equal(isRunner(w, 'x', true), true)
  assert.equal(isRunner(w, 'h1', false), true)
  assert.equal(isRunner(w, 'g1', false), false)
  assert.equal(isRunner(w, undefined, false), false)
})

test('history rows give a CSV-ready table with the prize emoji', () => {
  let w = ok(run(setup(), 'spin-prize'))
  w = ok(run(w, 'spin-winner', { now: after }))
  w = ok(run(w, 'accept', { now: after + 9000 }))
  const rows = historyRows(w)
  assert.deepEqual(rows[0], ['Draw', 'Time (UTC)', 'Prize', 'Winner', 'Run by'])
  assert.equal(rows[1][2], '🎁 Gift card')
  assert.equal(rows[1][3], 'Maria')
  assert.match(rows[1][1], /^\d{4}-\d{2}-\d{2}T/)
})

test('applyAction never mutates the wheel it is given', () => {
  const w = setup()
  const copy = structuredClone(w)
  run(w, 'spin-prize')
  assert.deepEqual(w, copy)
})

test('celebrations: effects and GIF links are validated, kept per prize, and the GIF wins over the animation', () => {
  const ok = (extra, prizes) => cleanSetup({ participants: [], prizes: prizes ?? [], ...extra }, { genId })
  assert.deepEqual(defaultWheel().rules, { removeWinners: true, effect: 'confetti', gif: null })
  const r = ok({ rules: { removeWinners: false, effect: 'fireworks', gif: 'https://media.giphy.com/media/abc/giphy.gif' } }, [{ name: 'Mug', effect: 'balloons', gif: 'https://media.giphy.com/media/xyz/giphy.gif' }, { name: 'Pen' }])
  assert.deepEqual(r.value.rules, { removeWinners: false, effect: 'fireworks', gif: 'https://media.giphy.com/media/abc/giphy.gif' })
  assert.deepEqual([r.value.prizes[0].effect, r.value.prizes[0].gif, r.value.prizes[1].effect, r.value.prizes[1].gif], ['balloons', 'https://media.giphy.com/media/xyz/giphy.gif', undefined, undefined])
  for (const bad of [{ effect: 'nuke' }, { gif: 'http://x.example/a.gif' }, { gif: 'javascript:alert(1)' }, { gif: 'https://x.example/a b.gif' }, { gif: 'https://x.example/"onerror=' }]) assert.ok(ok({ rules: { removeWinners: true, ...bad } }).error, JSON.stringify(bad))
  assert.ok(ok({}, [{ name: 'x', effect: 'nuke' }]).error)
  assert.ok(ok({}, [{ name: 'x', gif: 'ftp://x/y.gif' }]).error)
  assert.equal(ok({ rules: { removeWinners: true, gif: '' } }).value.rules.gif, null)
  const keep = cleanSetup({ participants: [], prizes: [] }, { previous: { ...defaultWheel(), rules: { removeWinners: true, effect: 'stars', gif: null } }, genId })
  assert.equal(keep.value.rules.effect, 'stars') // a setup that does not mention the effect keeps it
  const w = { ...defaultWheel(), rules: { removeWinners: true, effect: 'fireworks', gif: null } }
  assert.deepEqual(celebrationFor(w, { name: 'Mug' }), { gif: null, effect: 'fireworks' })
  assert.deepEqual(celebrationFor(w, { name: 'Mug', effect: 'stars' }), { gif: null, effect: 'stars' })
  assert.deepEqual(celebrationFor({ ...w, rules: { ...w.rules, gif: 'https://a.example/w.gif' } }, { name: 'Mug' }).gif, 'https://a.example/w.gif')
  assert.equal(celebrationFor({ ...w, rules: { ...w.rules, gif: 'https://a.example/w.gif' } }, { gif: 'https://a.example/p.gif' }).gif, 'https://a.example/p.gif')
  assert.deepEqual(celebrationFor({ ...defaultWheel(), rules: { removeWinners: true } }, null), { gif: null, effect: 'confetti' }) // an older wheel without the new fields
})
