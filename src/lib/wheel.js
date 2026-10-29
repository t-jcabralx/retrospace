// The Event board's prize wheel: setup validation and the round state machine. Pure and browser-safe. The server is the
// only place a result is chosen: `pick(n)` (a crypto random integer in [0, n)) is passed in, never called by the client.
//
// wheel = { participants, prizes, helpers, rules, round, history }
//   participants [{ id, name, on, won?, uid? }]   the outer ring (uid: the per-board id of someone who joined)
//   prizes       [{ id, name, emoji, qty, color }] the inner ring (qty = how many are left)
//   helpers      [uid]                              people besides the owner who may run the round
//   rules        { removeWinners }
//   round        { state, prizeId, winnerId, sitOut[], spin, n }
//   history      [{ n, at, prize, winner, by }]     newest last
//
// round.state: idle -> prizeChosen -> winnerChosen -> (accept) idle. `spin` = { id, step, index, count, startAt, durationMs }
// describes the latest spin so every client turns the same ring to the same angle at the same server time. The result is
// stored at once; screens hold it back until the spin has finished (see ui/event/timeline.js).

export const LIMITS = { participants: 200, prizes: 30, helpers: 10, name: 60, qty: 99, history: 500 }
export const SPIN = { leadMs: 700, prizeMs: 5000, winnerMs: 6000, turns: 5 }
export const PRIZE_COLORS = ['#7f77dd', '#1d9e75', '#d85a30', '#d4537e', '#378add', '#639922', '#ba7517', '#888780']

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const ID = /^[a-z0-9_-]{1,24}$/i
const HEX = /^#[0-9a-f]{6}$/i
const newId = () => globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10)
const text = (v, max) => (typeof v === 'string' ? Array.from(v.replace(/\s+/g, ' ').trim()).slice(0, max).join('') : '')

export const defaultWheel = () => ({
  participants: [], prizes: [], helpers: [], rules: { removeWinners: true },
  round: { state: 'idle', prizeId: null, winnerId: null, sitOut: [], spin: null, n: 0 }, history: [],
})

// --- setup ----------------------------------------------------------------------------------------------------
// -> { value: { participants, prizes, helpers, rules } } | { error }. Blank and repeated names are dropped, not refused, so a
// pasted list can be sloppy. `won` survives only for ids that were already marked won (the owner cannot hand it out here).
export function cleanSetup(input, { previous = defaultWheel(), genId = newId } = {}) {
  if (!isObj(input)) return { error: 'wheel must be an object' }
  const { participants, prizes, helpers, rules } = input
  if (!Array.isArray(participants) || participants.length > LIMITS.participants * 2) return { error: `A wheel holds up to ${LIMITS.participants} people` }
  if (!Array.isArray(prizes) || prizes.length > LIMITS.prizes * 2) return { error: `A wheel holds up to ${LIMITS.prizes} prizes` }
  const wonBefore = new Set(previous.participants.filter((p) => p.won).map((p) => p.id))

  const seen = new Set()
  const people = []
  const ids = new Set()
  for (const p of participants) {
    if (!isObj(p)) return { error: 'invalid participant' }
    const name = text(p.name, LIMITS.name)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const id = typeof p.id === 'string' && ID.test(p.id) && !ids.has(p.id) ? p.id : genId()
    ids.add(id)
    const uid = typeof p.uid === 'string' && p.uid.length <= 40 ? p.uid : undefined
    people.push({ id, name, on: p.on !== false, ...(wonBefore.has(id) && { won: true }), ...(uid && { uid }) })
  }
  if (people.length > LIMITS.participants) return { error: `A wheel holds up to ${LIMITS.participants} people` }

  const gifts = []
  const gids = new Set()
  for (const z of prizes) {
    if (!isObj(z)) return { error: 'invalid prize' }
    const name = text(z.name, LIMITS.name)
    if (!name) continue
    const qty = z.qty === undefined ? 1 : z.qty
    if (!Number.isInteger(qty) || qty < 0 || qty > LIMITS.qty) return { error: `Prize quantity is 0 to ${LIMITS.qty}` }
    const id = typeof z.id === 'string' && ID.test(z.id) && !gids.has(z.id) ? z.id : genId()
    gids.add(id)
    gifts.push({ id, name, emoji: text(z.emoji, 8), qty, color: typeof z.color === 'string' && HEX.test(z.color) ? z.color.toLowerCase() : PRIZE_COLORS[gifts.length % PRIZE_COLORS.length] })
  }
  if (gifts.length > LIMITS.prizes) return { error: `A wheel holds up to ${LIMITS.prizes} prizes` }

  const helperList = helpers === undefined ? previous.helpers : helpers
  if (!Array.isArray(helperList) || helperList.length > LIMITS.helpers || !helperList.every((h) => typeof h === 'string' && h.length > 0 && h.length <= 40)) return { error: `Up to ${LIMITS.helpers} helpers` }
  if (rules !== undefined && !(isObj(rules) && typeof rules.removeWinners === 'boolean')) return { error: 'invalid rules' }

  return { value: { participants: people, prizes: gifts, helpers: [...new Set(helperList)], rules: { removeWinners: (rules ?? previous.rules).removeWinners } } }
}

// --- the two rings --------------------------------------------------------------------------------------------
export const ringPrizes = (w) => w.prizes.filter((z) => z.qty > 0)
export const ringPeople = (w) => w.participants.filter((p) => p.on && !p.won && !w.round.sitOut.includes(p.id))
export const isRunner = (w, uid, isOwner) => Boolean(isOwner || (uid && w.helpers.includes(uid)))
export const spinning = (round, now) => Boolean(round.spin && now < round.spin.startAt + round.spin.durationMs)

// Degrees to turn a ring clockwise so the centre of slice `index` (of `count`) sits under the pointer at the top.
export const spinAngle = (index, count, turns = SPIN.turns) => turns * 360 + 360 - ((index + 0.5) * 360) / count

// --- the round ------------------------------------------------------------------------------------------------
const bad = (error) => ({ error })
const clone = (w) => structuredClone(w)

function startSpin(w, step, { now, pick }) {
  const list = step === 'prize' ? ringPrizes(w) : ringPeople(w)
  if (!list.length) return bad(step === 'prize' ? 'Add a prize with at least one left' : 'No one is left to win')
  const index = pick(list.length)
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return bad('Could not pick')
  const next = clone(w)
  const n = next.round.n + 1
  next.round.n = n
  next.round.spin = { id: n, step, index, count: list.length, startAt: now + SPIN.leadMs, durationMs: step === 'prize' ? SPIN.prizeMs : SPIN.winnerMs }
  if (step === 'prize') { next.round.state = 'prizeChosen'; next.round.prizeId = list[index].id } else { next.round.state = 'winnerChosen'; next.round.winnerId = list[index].id }
  return { wheel: next }
}

// -> { wheel } | { error }. Every action checks the state it needs, so a double press or a stale screen gets a plain message.
export function applyAction(w, action, { now, pick, by = null } = {}) {
  const { state } = w.round
  if (['spin-prize', 'spin-winner', 'accept', 'skip', 'back'].includes(action) && spinning(w.round, now)) return bad('Wait for the spin to finish')
  switch (action) {
    case 'spin-prize':
      if (state !== 'idle') return bad('Finish or go back from the current round first')
      if (!ringPeople(w).length) return bad('Add a participant first')
      return startSpin(w, 'prize', { now, pick })
    case 'spin-winner':
      if (state !== 'prizeChosen') return bad('Pick the prize first')
      return startSpin(w, 'winner', { now, pick })
    case 'accept': {
      if (state !== 'winnerChosen') return bad('There is no winner to accept')
      const next = clone(w)
      const prize = next.prizes.find((z) => z.id === w.round.prizeId)
      const winner = next.participants.find((p) => p.id === w.round.winnerId)
      if (!prize || !winner) return bad('That prize or person is no longer on the wheel')
      next.history.push({ n: next.history.length ? next.history.at(-1).n + 1 : 1, at: now, prize: { id: prize.id, name: prize.name, emoji: prize.emoji }, winner: { id: winner.id, name: winner.name }, by })
      if (next.history.length > LIMITS.history) next.history.splice(0, next.history.length - LIMITS.history)
      prize.qty = Math.max(0, prize.qty - 1)
      if (next.rules.removeWinners) winner.won = true
      next.round = { ...next.round, state: 'idle', prizeId: null, winnerId: null, sitOut: [], spin: null }
      return { wheel: next }
    }
    case 'skip': { // not here: they sit out this round, the winner is spun again
      if (state !== 'winnerChosen') return bad('There is no winner to skip')
      const next = clone(w)
      next.round = { ...next.round, state: 'prizeChosen', sitOut: [...next.round.sitOut, w.round.winnerId], winnerId: null, spin: null }
      return { wheel: next }
    }
    case 'back': { // winnerChosen -> prizeChosen (spin the winner again); prizeChosen -> idle (pick another prize)
      if (state === 'idle') return bad('Nothing to go back from')
      const next = clone(w)
      next.round = state === 'winnerChosen' ? { ...next.round, state: 'prizeChosen', winnerId: null, spin: null } : { ...next.round, state: 'idle', prizeId: null, sitOut: [], spin: null }
      return { wheel: next }
    }
    case 'undo': { // takes back the last accepted result
      if (state !== 'idle') return bad('Finish or go back from the current round first')
      if (!w.history.length) return bad('There is nothing to undo')
      const next = clone(w)
      const last = next.history.pop()
      const prize = next.prizes.find((z) => z.id === last.prize.id)
      if (prize) prize.qty = Math.min(LIMITS.qty, prize.qty + 1)
      const winner = next.participants.find((p) => p.id === last.winner.id)
      if (winner) delete winner.won
      return { wheel: next }
    }
    default:
      return bad('Unknown action')
  }
}

// Rows for the CSV export, header first.
export const historyRows = (w) => [['Draw', 'Time (UTC)', 'Prize', 'Winner', 'Run by'], ...w.history.map((h) => [h.n, new Date(h.at).toISOString(), `${h.prize.emoji ? `${h.prize.emoji} ` : ''}${h.prize.name}`, h.winner.name, h.by ?? ''])]
