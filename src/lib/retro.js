// The staged Retro workflow, as pure functions shared by the server (PATCH rules, planOps) and the board UI.
// `board.retro` is created for every new retro board; a board without it runs with no workflow at all.
import { DEFAULT_PER_PERSON } from './vote.js'

export class RetroError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RetroError'
  }
}

export const STAGE_KEYS = ['join', 'collect', 'group', 'vote', 'discuss', 'actions', 'wrapup']
const MIN = 60_000
export const DEFAULT_STAGES = [
  { key: 'join', label: 'Join', durationMs: 1 * MIN, enabled: true },
  { key: 'collect', label: 'Collect feedback', durationMs: 5 * MIN, enabled: true },
  { key: 'group', label: 'Group', durationMs: null, enabled: true },
  { key: 'vote', label: 'Vote', durationMs: 2 * MIN, enabled: true },
  { key: 'discuss', label: 'Review and discuss', durationMs: 8 * MIN, enabled: true },
  { key: 'actions', label: 'Create actions', durationMs: 5 * MIN, enabled: true },
  { key: 'wrapup', label: 'Wrap up', durationMs: 2 * MIN, enabled: true },
]
export const MAX_LABEL = 40
export const MIN_DURATION_MS = 10_000
export const MAX_DURATION_MS = 4 * 60 * MIN
export const TOPIC_STATUSES = ['not', 'discussed', 'deferred', 'action']
export const MAX_TOPIC_NOTE = 300
export const MAX_TOPIC_NOTES = 20
export const MAX_TOPICS = 60
const TOPIC_ID = /^[A-Za-z0-9_-]{1,40}$/
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype'])
// Item kinds a non-owner may only touch while the Collect stage is open and unlocked.
export const CONTENT_KINDS = ['note', 'text', 'shape', 'connector', 'frame', 'image']

// Extra fields each PATCH retro action may carry (the PATCH rule rejects anything else).
export const RETRO_ACTION_KEYS = {
  start: [], next: [], prev: [], pause: [], resume: [],
  goto: ['index'], extend: ['ms'], setEditing: ['value'], topic: ['itemId', 'status', 'note'],
  config: ['stages', 'topN', 'maxActions', 'votesPerPerson'],
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
const bad = (error) => ({ ok: false, error })

// `votesPerPerson`: the creation-time choice, so entering the Vote stage does not overwrite it with the default.
export function defaultRetro(votesPerPerson = DEFAULT_PER_PERSON) {
  return {
    stages: DEFAULT_STAGES.map((s) => ({ ...s })),
    current: 0,
    stageStartedAt: null,
    pausedAt: null,
    elapsedBeforePause: 0,
    editing: false,
    topN: 3,
    maxActions: 3,
    votesPerPerson,
    topics: {},
  }
}

// Strict shape of the settings an owner may change: { stages?, topN?, maxActions?, votesPerPerson? } -> { ok, value } | { ok: false, error }.
export function validateRetroConfig(input) {
  if (!isObj(input)) return bad('invalid retro settings')
  const allowed = ['stages', 'topN', 'maxActions', 'votesPerPerson']
  if (Object.keys(input).some((k) => !allowed.includes(k))) return bad('invalid retro settings')
  const out = {}
  if (input.stages !== undefined) {
    const list = input.stages
    if (!Array.isArray(list) || list.length < 2 || list.length > STAGE_KEYS.length) return bad('invalid stages')
    const seen = new Set()
    out.stages = []
    for (const s of list) {
      if (!isObj(s) || !STAGE_KEYS.includes(s.key) || seen.has(s.key)) return bad('invalid stage')
      seen.add(s.key)
      if (typeof s.label !== 'string') return bad('stage name must be text')
      // eslint-disable-next-line no-control-regex
      const label = s.label.replace(/[\u0000-\u001f\u007f]/g, '').trim()
      if (!label || Array.from(label).length > MAX_LABEL) return bad(`stage name must be 1-${MAX_LABEL} characters`)
      const d = s.durationMs
      if (d !== null && !isInt(d, MIN_DURATION_MS, MAX_DURATION_MS)) return bad('a stage lasts 10 seconds to 4 hours, or has no timer')
      if (typeof s.enabled !== 'boolean') return bad('stage enabled must be true or false')
      out.stages.push({ key: s.key, label, durationMs: d, enabled: s.enabled })
    }
    if (out.stages.filter((s) => s.enabled).length < 2) return bad('keep at least two stages on')
  }
  if (input.topN !== undefined) { if (!isInt(input.topN, 1, 10)) return bad('topics to discuss must be 1-10'); out.topN = input.topN }
  if (input.maxActions !== undefined) { if (!isInt(input.maxActions, 1, 20)) return bad('actions must be 1-20'); out.maxActions = input.maxActions }
  if (input.votesPerPerson !== undefined) { if (!isInt(input.votesPerPerson, 1, 20)) return bad('votes per person must be 1-20'); out.votesPerPerson = input.votesPerPerson }
  return { ok: true, value: out }
}

export const enabledStages = (retro) => retro.stages.filter((s) => s.enabled)
export const currentStage = (retro) => {
  const list = enabledStages(retro)
  return list[Math.min(Math.max(retro.current, 0), list.length - 1)]
}
export const stageKey = (retro) => currentStage(retro)?.key ?? null
export const isStarted = (retro) => retro.stageStartedAt != null

// Milliseconds spent in the current stage, pauses excluded (extensions make it smaller, even negative).
function elapsed(retro, now) {
  return retro.elapsedBeforePause + (retro.pausedAt == null && retro.stageStartedAt != null ? Math.max(0, now - retro.stageStartedAt) : 0)
}

// -> { endsAt, remainingMs, paused }: endsAt is the server-clock instant the stage runs out (null: no timer, not started or paused).
export function timerState(retro, now) {
  const dur = currentStage(retro)?.durationMs ?? null
  if (dur == null || !isStarted(retro)) return { endsAt: null, remainingMs: null, paused: retro.pausedAt != null }
  const left = dur - elapsed(retro, now)
  if (retro.pausedAt != null) return { endsAt: null, remainingMs: Math.max(0, left), paused: true }
  return { endsAt: now + left, remainingMs: Math.max(0, left), paused: false }
}

const enter = (retro, index, now, started) => {
  const key = enabledStages(retro)[index].key
  return { ...retro, current: index, stageStartedAt: started ? now : null, pausedAt: null, elapsedBeforePause: 0, editing: key === 'collect' }
}

// The state machine. Pure; an impossible action throws RetroError. Actions: start, next, prev, goto {index}, pause, resume,
// extend {ms}, setEditing {value}, config {...}, topic {itemId, status?, note?}. `current` indexes the ENABLED stages.
export function applyRetroAction(retro, action, now) {
  if (!isObj(action) || typeof action.type !== 'string') throw new RetroError('unknown action')
  const last = enabledStages(retro).length - 1
  switch (action.type) {
    case 'start':
      return { ...enter(retro, retro.current, now, true) }
    case 'next':
      if (retro.current >= last) throw new RetroError('This is the last stage')
      return enter(retro, retro.current + 1, now, true)
    case 'prev':
      if (retro.current <= 0) throw new RetroError('This is the first stage')
      return enter(retro, retro.current - 1, now, true)
    case 'goto':
      if (!isInt(action.index, 0, last)) throw new RetroError('No such stage')
      return enter(retro, action.index, now, true)
    case 'pause':
      if (!isStarted(retro) || retro.pausedAt != null) throw new RetroError('Nothing to pause')
      return { ...retro, pausedAt: now, elapsedBeforePause: elapsed(retro, now) }
    case 'resume':
      if (retro.pausedAt == null) throw new RetroError('Not paused')
      return { ...retro, pausedAt: null, stageStartedAt: now }
    case 'extend': {
      const dur = currentStage(retro).durationMs
      if (dur == null) throw new RetroError('This stage has no timer')
      if (!isInt(action.ms, 1000, 60 * MIN)) throw new RetroError('Extend by 1 second to 1 hour')
      const bonus = Math.max(dur - MAX_DURATION_MS, elapsed(retro, now) - action.ms) // never more than 4 hours left
      return { ...retro, elapsedBeforePause: retro.elapsedBeforePause + (bonus - elapsed(retro, now)) }
    }
    case 'setEditing':
      if (typeof action.value !== 'boolean') throw new RetroError('value must be true or false')
      return { ...retro, editing: action.value }
    case 'config': {
      const { type, ...rest } = action // eslint-disable-line no-unused-vars
      const r = validateRetroConfig(rest)
      if (!r.ok) throw new RetroError(r.error)
      const next = { ...retro, ...r.value }
      if (r.value.stages) {
        // Keep the stage the room is in when the list is edited; if it was switched off, land on the one at the same place.
        const key = stageKey(retro)
        const list = enabledStages(next)
        const at = list.findIndex((s) => s.key === key)
        next.current = at >= 0 ? at : Math.min(retro.current, list.length - 1)
        if (at < 0 && isStarted(retro)) Object.assign(next, { stageStartedAt: now, pausedAt: null, elapsedBeforePause: 0, editing: list[next.current].key === 'collect' })
        else if (at >= 0 && list[at].durationMs == null) Object.assign(next, { pausedAt: null, elapsedBeforePause: 0 })
      }
      return next
    }
    case 'topic':
      return withTopic(retro, action, now)
    default:
      throw new RetroError('unknown action')
  }
}

function withTopic(retro, a, now) {
  if (typeof a.itemId !== 'string' || !TOPIC_ID.test(a.itemId) || FORBIDDEN_IDS.has(a.itemId)) throw new RetroError('invalid topic')
  if (a.status === undefined && a.note === undefined) throw new RetroError('nothing to change')
  const topics = isObj(retro.topics) ? retro.topics : {}
  const known = Object.hasOwn(topics, a.itemId)
  if (!known && Object.keys(topics).length >= MAX_TOPICS) throw new RetroError('Too many topics')
  const cur = known ? topics[a.itemId] : { status: 'not', notes: [] }
  const next = { status: cur.status, notes: [...cur.notes] }
  if (a.status !== undefined) {
    if (!TOPIC_STATUSES.includes(a.status)) throw new RetroError('invalid topic status')
    next.status = a.status
  }
  if (a.note !== undefined) {
    // eslint-disable-next-line no-control-regex
    const text = typeof a.note === 'string' ? a.note.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim() : ''
    if (!text || Array.from(text).length > MAX_TOPIC_NOTE) throw new RetroError(`A note is 1-${MAX_TOPIC_NOTE} characters`)
    if (next.notes.length >= MAX_TOPIC_NOTES) throw new RetroError('Too many notes on this topic')
    next.notes.push({ text, at: now })
  }
  return { ...retro, topics: { ...topics, [a.itemId]: next } }
}

// Board fields that follow a change of the workflow (the existing vote and timer features are driven from the stage):
// -> { vote?, timer? } to store alongside the new retro state. Voting is open in a started Vote stage; the shared timer
// runs while a timed stage does and is null otherwise. The vote setting is only touched when the stage, the start state
// or the votes per person changed, so the owner's manual Stop voting inside the Vote stage is not undone by a pause.
export function retroEffects(prev, next, board, now) {
  const out = {}
  const was = prev ? stageKey(prev) === 'vote' && isStarted(prev) : false
  const is = stageKey(next) === 'vote' && isStarted(next)
  if (was !== is || (is && prev?.votesPerPerson !== next.votesPerPerson)) out.vote = { active: is, perPerson: next.votesPerPerson }
  const t = timerState(next, now)
  const dur = currentStage(next)?.durationMs
  out.timer = t.endsAt != null ? { endsAt: Math.round(t.endsAt), durationMs: Math.max(dur, Math.round(t.remainingMs)) } : null
  return out
}

// --- who may do what, per stage -------------------------------------------------------------------------------------
const TEXT_ACTION_MAX = 'Action limit reached'

// A pure gate for planOps. `op` is the validated op, `item` the stored item it touches (or the new one for an add; undefined
// when it does not exist, which the caller reports itself), `liveActions` the live `action` items now on the board.
// -> { ok: true } | { ok: false, error }. The owner is exempt; boards without a workflow (or not retro boards) are unaffected.
export function retroAllows(board, op, item, actor, liveActions = 0) {
  const ok = { ok: true }
  if (!board || board.type !== 'retro' || !isObj(board.retro) || actor?.isOwner) return ok
  const retro = board.retro
  const stage = stageKey(retro)
  if (op.op === 'react') return ok
  if (op.op === 'vote') return stage === 'vote' ? ok : bad('Voting is not open')
  if (!item) return ok
  const kind = item.kind
  if (kind === 'theme' || kind === 'topic') return bad('Only the facilitator can change this')
  if (kind === 'action') {
    if (stage !== 'actions') return bad('Actions are not open yet')
    if (op.op === 'add' && liveActions >= (retro.maxActions ?? 3)) return bad(TEXT_ACTION_MAX)
    return ok
  }
  if (CONTENT_KINDS.includes(kind) && !(stage === 'collect' && retro.editing === true)) return bad('This stage is closed for notes')
  return ok
}

// --- discussion topics ----------------------------------------------------------------------------------------------
const TOPIC_KINDS = ['note', 'theme']
const topicText = (i) => String(i.data?.title ?? i.data?.text ?? '')

// The most-voted notes and themes: -> [{ id, kind, text, votes, tied, selected }], most votes first.
// Items clearly inside the top N are `selected`. When several items share the vote count at the cut-off and do not all fit,
// every one of them is listed with `tied: true`, and only those the owner named in `picked` are `selected`.
export function rankTopics(items, topN, picked = []) {
  const ranked = items
    .filter((i) => !i.deleted && TOPIC_KINDS.includes(i.kind) && i.votes?.length > 0)
    .map((i) => ({ id: i.id, kind: i.kind, text: topicText(i), votes: i.votes.length, tied: false, selected: false, at: i.updatedAt ?? 0 }))
    .sort((a, b) => b.votes - a.votes || a.at - b.at || (a.id < b.id ? -1 : 1))
  if (!ranked.length) return []
  const cut = ranked.length > topN ? ranked[topN - 1].votes : 0
  const clear = ranked.filter((r) => r.votes > cut && cut > 0)
  const edge = cut > 0 ? ranked.filter((r) => r.votes === cut) : []
  const fits = clear.length + edge.length <= topN
  const pickSet = new Set(Array.isArray(picked) ? picked : [])
  let room = topN - clear.length
  const rows = (cut > 0 ? [...clear, ...edge] : ranked).map(({ at, ...r }) => r) // eslint-disable-line no-unused-vars
  for (const r of rows) {
    const inEdge = cut > 0 && r.votes === cut
    if (!inEdge) { r.selected = true; continue }
    if (fits) { r.selected = true; continue }
    r.tied = true
    if (pickSet.has(r.id) && room > 0) { r.selected = true; room-- }
  }
  return rows
}

// What the Discuss stage shows for one topic row: its saved status and notes.
export const topicOf = (retro, id) => (isObj(retro?.topics) && Object.hasOwn(retro.topics, id) ? retro.topics[id] : { status: 'not', notes: [] })
