'use client'
// Owns a board's client state and its sync: loads the snapshot, wires createSync to the reducer and hands the
// canvas a few write helpers. State lives in a ref that is updated synchronously (and mirrored into React
// state) so back-to-back events such as key repeats never act on a stale copy.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { initialState, reducer, undo as undoStep, redo as redoStep, ordered, freshId } from '../client/state.js'
import { createSync } from '../client/sync.js'
import { reportDiag } from './diag.js'
import { fixLinks, coalesceUpdates, dropBuffered } from './ops.js'
import { createClock } from './timer.js'
import { votesLeft } from './voteResults.js'
import { isVotable } from '../lib/vote.js'
import { stageAllowsEdit } from '../lib/clientRules.js'
import { joinWithPasscode } from './passcodeApi.js'

const NUDGE_MERGE_MS = 700
const LIVE_FORCE_MS = 1000 // a held back drag update is sent anyway after this long
const STATUS_GRACE_MS = 4000 // "Connecting" turns into "Offline" if sync never reports in

// Counts every op handed to sync per item (see settle) and in total (`out`: sent, not yet answered).
function rawSend(r, ops) {
  if (ops.some((o) => o.op === 'add')) r.authored = true // a persona is fixed once its owner has added something
  for (const o of ops) r.pending.set(o.id, (r.pending.get(o.id) ?? 0) + 1)
  r.out += ops.length
  r.sync?.send(ops)
}

// Live (untracked) drag updates wait while an earlier batch is unanswered, and only the newest update per item is
// kept, so a slow connection never queues stale positions of a dragged frame's contents.
function flushLive(r, force = false) {
  if (!r.liveBuf.size || (r.out > 0 && !force)) return
  clearTimeout(r.liveTimer)
  r.liveTimer = null
  // A peer may have deleted an item while its drag update was held back: sending it would be rejected.
  const ops = [...r.liveBuf.values()].filter((o) => r.state?.items.has(o.id))
  r.liveBuf.clear()
  if (ops.length) rawSend(r, ops)
}

// Tells peers a live drag is over: `cancel` puts their temporary positions back, otherwise they keep them until the write arrives.
function endDrag(r, cancel) {
  const ids = [...(r.dragIds ?? [])].slice(0, 20)
  r.dragIds = null
  if (ids.length) r.sync?.sendEphemeral({ t: 'drag', end: true, ...(cancel && { cancel: true }), ids })
}

// Forgets held-back live updates for `ids` (their tracked/revert op supersedes them, or the item is gone).
function forgetLive(r, ids) {
  dropBuffered(r.liveBuf, ids)
  if (!r.liveBuf.size) { clearTimeout(r.liveTimer); r.liveTimer = null }
}

// -> { snapshot } | { missing } | { passcode } (401: the guest must enter the passcode) | { revoked } (403, link revoked)
async function fetchSnapshot(code) {
  const sentAt = Date.now()
  const res = await fetch(`/api/boards/${code}`, { cache: 'no-store' })
  if (res.status === 404) return { missing: true }
  if (res.status === 401 || res.status === 403) {
    const error = (await res.json().catch(() => ({})))?.error
    if (res.status === 401 && error === 'Passcode required') return { passcode: true }
    if (res.status === 403 && error === 'This link was revoked') return { revoked: true }
    if (res.status === 403 && error === 'You were removed from this board') return { removed: true }
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const snapshot = await res.json()
  return { snapshot, sentAt, receivedAt: Date.now() }
}

// `viewOnly` (the board's ?view=1 link, used by the recipient's reveal page): a visitor who is not the owner just looks. No
// persona is asked for, nothing can be written, and the board is followed by polling only (no room is joined).
export function useBoard(code, { viewOnly = false } = {}) {
  const [phase, setPhase] = useState('loading') // loading | persona | ready | missing | passcode | revoked | error
  const [state, setState] = useState(null)
  const [status, setStatus] = useState('connecting')
  const [toast, setToast] = useState(null)
  const [lockedByServer, setLockedByServer] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const ref = useRef({ state: null, sync: null, pending: new Map(), merge: null, toastTimer: null, out: 0, liveBuf: new Map(), liveTimer: null, authored: false, eph: new Set() })
  if (!ref.current.clock) ref.current.clock = createClock()

  const put = useCallback((next) => {
    ref.current.state = next
    setState(next)
  }, [])
  const dispatch = useCallback((action) => {
    const cur = ref.current.state
    if (action.type === 'load') return put(initialState(action.snapshot))
    if (!cur) return
    const next = reducer(cur, action)
    // A peer's temporary position that never got its real write is put back after 10 s: say so, it is one reason a change "goes back".
    if (action.type === 'peer-drag-expire' && next.drags.size < cur.drags.size) reportDiag('drag-expired', { n: cur.drags.size - next.drags.size, board: cur.board?.type, role: cur.viewer?.role })
    put(next)
  }, [put])

  const notify = useCallback((message, ms = 3500) => {
    clearTimeout(ref.current.toastTimer)
    setToast({ message, id: Date.now() })
    ref.current.toastTimer = setTimeout(() => setToast(null), ms)
  }, [])

  // Every sent op is counted per item; an ack only reaches the state once the item has no newer op in flight,
  // so a late ack for an earlier drag step cannot yank the item back for a moment.
  const send = useCallback((ops) => {
    const r = ref.current
    forgetLive(r, ops.map((o) => o.id)) // a tracked op supersedes a held back drag update of the same item
    rawSend(r, ops)
  }, [])

  useEffect(() => {
    let dead = false
    let sync = null
    const r = ref.current
    r.pending = new Map()
    r.out = 0
    r.liveBuf = new Map()
    r.sync = null
    r.authored = false
    setPhase('loading')
    setStatus('connecting')
    const dragSweep = setInterval(() => dispatch({ type: 'peer-drag-expire', now: Date.now() }), 1000) // a peer's temporary position nobody finished goes back
    const grace = setTimeout(() => setStatus((s) => (s === 'connecting' ? 'offline' : s)), STATUS_GRACE_MS)

    const resync = async () => {
      try {
        const got = await fetchSnapshot(code)
        if (dead) return
        if (got.snapshot) {
          r.clock.sample(got.snapshot.now, got.sentAt, got.receivedAt)
          // A different guest identity (the cookie was lost) or a persona that is gone: start over from the top.
          const was = r.state?.viewer
          const v = got.snapshot.viewer
          if (v?.uid !== was?.uid || (was?.persona && !v?.persona)) setAttempt((n) => n + 1)
          else dispatch({ type: 'load', snapshot: got.snapshot })
        } else if (got.missing) { // deleted while open
          sync?.close()
          r.sync = null
          setPhase('missing')
        } else if (got.passcode || got.revoked || got.removed) { // access was withdrawn while the board was open
          sync?.close()
          r.sync = null
          setPhase(got.passcode ? 'passcode' : got.removed ? 'removed' : 'revoked')
        }
      } catch { /* the next rejection or poll will try again */ }
    }
    const settle = (docs) => {
      const live = []
      r.out = Math.max(0, r.out - docs.length)
      for (const d of docs) {
        const n = (r.pending.get(d.id) ?? 1) - 1
        if (n > 0) r.pending.set(d.id, n)
        else { r.pending.delete(d.id); live.push(d) }
      }
      return live
    }

    ;(async () => {
      let got
      try { got = await fetchSnapshot(code) } catch { if (!dead) setPhase('error'); return }
      if (dead) return
      if (got.missing) { setPhase('missing'); return }
      if (got.passcode) { setPhase('passcode'); return }
      if (got.revoked) { setPhase('revoked'); return }
      if (got.removed) { setPhase('removed'); return }
      r.clock.sample(got.snapshot.now, got.sentAt, got.receivedAt) // the server's clock, for the shared timer
      put(initialState(got.snapshot))
      // The server minted this uid (a signed cookie); a guest who has not yet chosen how to appear does that first,
      // unless the board is read-only for them anyway (closed or locked): then they just watch.
      const { viewer, board: b } = got.snapshot
      const watching = viewOnly && viewer?.role !== 'owner'
      if (!watching && !viewer?.persona && (viewer?.role === 'owner' || (b.status !== 'closed' && !b.locked))) { setPhase('persona'); return }
      setPhase('ready')
      sync = createSync({
        watchOnly: watching,
        code, identity: { uid: viewer.uid }, lastSeen: r.state.lastSeen, boardRev: Number.isFinite(Number(b.rev)) ? Number(b.rev) : undefined, boardAt: Number(b.updatedAt) || 0,
        onRemote: (items) => dispatch({ type: 'remote', items }),
        onKicked: (id) => dispatch({ type: 'forget-participant', uid: id }),
        onBoard: (next) => dispatch({ type: 'board', board: next }),
        onClock: (serverNow, sentAt, receivedAt) => r.clock.sample(serverNow, sentAt, receivedAt),
        onEphemeral: (msg, from, cid) => {
          if (msg?.t === 'drag') { // a peer is moving items: a temporary position, no history
            dispatch(msg.end === true ? { type: 'peer-drag-end', ids: msg.ids, cancel: msg.cancel === true, now: Date.now() } : { type: 'peer-drag', items: msg.items, from, q: msg.q, now: Date.now() })
            return
          }
          for (const fn of [...r.eph]) fn(msg, from, cid)
        },
        onAck: (items) => {
          const live = settle(items)
          if (live.length) dispatch({ type: 'ack', items: live })
          flushLive(r)
        },
        onStatus: (s) => { if (s !== 'denied') setStatus(s) }, // 'denied' is handled by onDenied below
        onDenied: (httpStatus, message) => {
          // Access was withdrawn while the board was open (sync already stopped all traffic): same panels as a snapshot 401/403.
          sync?.close()
          r.sync = null
          if (httpStatus === 401 && message === 'Passcode required') setPhase('passcode')
          else if (httpStatus === 403 && message === 'This link was revoked') setPhase('revoked')
          else if (httpStatus === 403 && message === 'You were removed from this board') setPhase('removed')
          else if (httpStatus === 404) setPhase('missing') // the board was deleted while it was open
          else setPhase('error')
        },
        onRejected: (list) => {
          settle(list)
          flushLive(r)
          const real = list.filter((x) => x.error !== 'Item already exists')
          if (!real.length) return
          const st = r.state
          reportDiag('rejected', { error: String(real[0].error ?? ''), n: real.length, board: st?.board?.type, role: st?.viewer?.role, stage: st?.board?.retro ? String(st.board.retro.current ?? '') : undefined, status: r.sync?.status?.() })
          notify(real[0].error, 8000) // long enough to read, and to tell us: it says why the change was put back
          resync()
        },
      })
      r.sync = sync
    })()

    return () => {
      dead = true
      sync?.close()
      r.sync = null
      clearTimeout(r.toastTimer)
      clearTimeout(r.liveTimer)
      clearTimeout(grace)
      clearInterval(dragSweep)
    }
  }, [code, attempt, viewOnly, dispatch, put, notify])

  const board = state?.board
  const isOwner = state?.viewer?.role === 'owner'

  // The owner revoked the link while this board was open (the new settings arrive over the stream or /since): the same
  // as a 403 'This link was revoked' from the server. The owner themselves keeps working.
  const revokedNow = Boolean(board?.revoked) && !isOwner
  useEffect(() => {
    if (!revokedNow) return
    ref.current.sync?.close()
    ref.current.sync = null
    setPhase((ph) => (ph === 'ready' ? 'revoked' : ph))
  }, [revokedNow])

  // Ephemeral traffic (cursors, presence, celebrations) for the collaboration layer.
  const sendEphemeral = useCallback((msg, done) => ref.current.sync?.sendEphemeral(msg, done), [])
  const subscribeEphemeral = useCallback((fn) => {
    ref.current.eph.add(fn)
    return () => ref.current.eph.delete(fn)
  }, [])
  // Why a non-owner cannot edit: the owner closed the board, or locked it (the server enforces both), or they are only viewing.
  const readOnlyReason = isOwner ? null : board?.status === 'closed' ? 'closed' : board?.locked ? 'locked' : viewOnly ? 'view-only' : null
  const readOnly = readOnlyReason !== null
  const uid = state?.viewer?.uid
  const persona = state?.viewer?.persona ?? null

  const items = useMemo(() => (state ? ordered(state) : []), [state])
  // The server refuses a change once the participant has authored anything (deleted items count too, which this
  // client cannot see), so a 403 from it locks the control for good. The owner is never locked.
  const personaLocked = !isOwner && (lockedByServer || ref.current.authored || items.some((i) => i.authorUid === uid || i.mine))
  const canEdit = useCallback(
    (item) => !readOnly && stageAllowsEdit(board, item, isOwner) && (isOwner || !item.authorUid || item.authorUid === uid || item.mine === true),
    [readOnly, isOwner, uid, board],
  )

  // Applies ops locally as one undo step and sends them. Ops that cannot apply (item gone) are dropped first.
  // `mergeKey`: repeated calls with the same key inside a short window share a single undo step (nudging).
  // `draft`: text saved while it is still being typed. Applied and sent like any change, but it is not an undo step (the editor
  // closing is), and it does not disturb a nudge merge in progress.
  const local = useCallback((ops, { mergeKey, draft = false } = {}) => {
    const cur = ref.current.state
    if (!cur) return false
    if (readOnly) { notify(`Board is ${readOnlyReason}`); return false }
    const valid = ops.filter((o) => (o.op === 'add' ? !cur.items.has(o.id) : cur.items.has(o.id)))
    if (!valid.length) return false
    if (draft) {
      put(reducer(cur, { type: 'local', ops: valid, track: false }))
      send(valid)
      return true
    }
    const m = ref.current.merge
    const joins = mergeKey && m && m.key === mergeKey && Date.now() - m.at < NUDGE_MERGE_MS && m.undoLen === cur.undo.length
    const next = reducer(cur, { type: 'local', ops: valid })
    put(joins ? { ...next, undo: cur.undo } : next)
    ref.current.merge = mergeKey ? { key: mergeKey, at: Date.now(), undoLen: ref.current.state.undo.length } : null
    send(valid)
    return true
  }, [readOnly, readOnlyReason, notify, put, send])

  // What the owner's write calls (useOwnerActions) need from this board.
  const syncCid = useCallback(() => ref.current.sync?.cid, [])
  const applyBoard = useCallback((next) => dispatch({ type: 'board', board: next }), [dispatch])
  const votesCleared = useCallback(() => dispatch({ type: 'votes-cleared' }), [dispatch])
  const participantRemoved = useCallback((uid, tombstones = []) => {
    if (tombstones.length) dispatch({ type: 'remote', items: tombstones }) // the owner's own tab skips the stream echo of the deletions
    dispatch({ type: 'forget-participant', uid })
  }, [dispatch])

  // Toggles the viewer's vote on an item. The server decides (voting open, votes left); it is not applied here, the ack
  // brings the result, and a refusal comes back as a toast. Out of votes is caught first so that costs no request.
  const vote = useCallback((id) => {
    const cur = ref.current.state
    if (!cur?.board?.vote?.active) return false
    const item = cur.items.get(id)
    if (!isVotable(item)) return false // frames and connectors are not votable (the server says so too)
    if (!item.votes?.includes(cur.viewer.uid) && votesLeft(cur.board, [...cur.items.values()], cur.viewer.uid) <= 0) { notify('No votes left'); return false }
    dispatch({ type: 'vote-local', id, uid: cur.viewer.uid }) // shown at once; the answer from the server settles it
    return local([{ op: 'vote', id }])
  }, [local, notify, dispatch])

  // Streams drag steps to peers without touching history or state (the canvas draws the motion itself).
  const live = useCallback((ops) => {
    if (readOnly) return
    const r = ref.current
    // Over the realtime stream, steps go as relayed-only messages (no database write, newest wins), like cursors do: peers
    // see the motion at about 15 steps a second. Without the stream (polling) they are saved, the slower way, as before.
    if (r.sync?.status() === 'live') {
      const items = []
      for (const o of coalesceUpdates([...r.liveBuf.values(), ...ops])) {
        const p = o.patch ?? {}
        if (o.op === 'update' && Number.isFinite(p.x) && Number.isFinite(p.y)) items.push({ id: o.id, x: p.x, y: p.y, v: r.state?.items.get(o.id)?.updatedAt ?? 0, ...(Number.isFinite(p.w) && { w: p.w }), ...(Number.isFinite(p.h) && { h: p.h }) })
      }
      r.liveBuf.clear()
      if (items.length) { r.dragIds = new Set([...(r.dragIds ?? []), ...items.map((i) => i.id)]); r.sync.sendEphemeral({ t: 'drag', items: items.slice(0, 20), q: Date.now() }) }
      return
    }
    for (const o of coalesceUpdates([...r.liveBuf.values(), ...ops])) r.liveBuf.set(o.id, o)
    flushLive(r)
    if (r.liveBuf.size && !r.liveTimer) r.liveTimer = setTimeout(() => { r.liveTimer = null; flushLive(r, true) }, LIVE_FORCE_MS)
  }, [readOnly])

  // Drop: put the items back at their pre-drag values without recording it, then apply the final values as the
  // single tracked step, so undoing restores the position from before the drag whatever acks arrived meanwhile.
  // Ops for items a peer deleted in the meantime are dropped, so they cannot be rejected (toast + refetch).
  const commit = useCallback((restore, final) => {
    const cur = ref.current.state
    if (!cur || readOnly) return
    endDrag(ref.current, false)
    forgetLive(ref.current, [...restore, ...final].map((o) => o.id)) // also for items that vanished
    const exists = (o) => cur.items.has(o.id)
    const ops = final.filter(exists)
    if (!ops.length) return
    put(reducer(reducer(cur, { type: 'local', ops: restore.filter(exists), track: false }), { type: 'local', ops }))
    ref.current.merge = null
    send(ops)
  }, [readOnly, put, send])

  // A drag/resize ended without a change: put what was streamed back, on the server and locally, untracked.
  const revert = useCallback((ops) => {
    const cur = ref.current.state
    if (!cur || readOnly) return
    endDrag(ref.current, true)
    forgetLive(ref.current, ops.map((o) => o.id))
    const valid = ops.filter((o) => cur.items.has(o.id))
    if (!valid.length) return
    put(reducer(cur, { type: 'local', ops: valid, track: false }))
    send(valid)
  }, [readOnly, put, send])

  const stepHistory = useCallback((fn, from) => {
    const cur = ref.current.state
    if (!cur || readOnly || !cur[from].length) return
    const olds = cur[from].at(-1).ops.filter((o) => o.op === 'add').map((o) => o.id)
    const map = new Map()
    let n = 0
    const res = fixLinks(fn(cur, () => { const id = freshId(); map.set(olds[n++], id); return id }), map)
    put(res.state)
    ref.current.merge = null
    if (res.ops.length) send(res.ops)
  }, [readOnly, put, send])
  const undo = useCallback(() => stepHistory(undoStep, 'undo'), [stepHistory])
  const redo = useCallback(() => stepHistory(redoStep, 'redo'), [stepHistory])

  // Saves how this viewer appears. -> null on success, else { error, status?, suggestion? } for the chooser to show.
  // The first persona starts the board (a fresh snapshot, then sync); a later one is patched in place.
  const savePersona = useCallback(async (next) => {
    const put = () => fetch(`/api/boards/${code}/persona`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ persona: next }) })
    try {
      let res = await put()
      if (res.status === 401) { // the guest cookie is gone: the snapshot mints a new one, then try once more
        const body = await res.clone().json().catch(() => ({}))
        if (body?.error === 'Join the board first') {
          await fetch(`/api/boards/${code}`, { cache: 'no-store' }).catch(() => {})
          res = await put()
        }
      }
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        if (ref.current.state?.viewer?.persona) dispatch({ type: 'persona', persona: data.persona, uid: ref.current.state.viewer.uid })
        else setAttempt((n) => n + 1)
        return null
      }
      if (res.status === 403 && /fixed/.test(data?.error ?? '')) setLockedByServer(true)
      if (res.status === 401 && data?.error === 'Join the board first') return { error: 'This browser is blocking the cookie the board needs. Allow cookies for this site and try again.', status: 401 }
      return { error: data?.error || `Something went wrong (${res.status})`, status: res.status, suggestion: data?.suggestion }
    } catch {
      return { error: 'Could not reach the server. Check your connection and try again.' }
    }
  }, [code, dispatch])

  // Exchanges the passcode for the access cookie, then reloads the board. -> an error message, or null on success.
  const submitPasscode = useCallback(async (passcode) => {
    const message = await joinWithPasscode(code, passcode)
    if (!message) setAttempt((n) => n + 1)
    return message
  }, [code])

  return {
    phase, status, toast, notify, retry: () => setAttempt((n) => n + 1), submitPasscode,
    state, board, items, isOwner, readOnly, readOnlyReason, uid, canEdit, persona, savePersona, personaLocked,
    local, live, commit, revert, undo, redo, sendEphemeral, subscribeEphemeral,
    code, vote, clock: ref.current.clock, syncCid, applyBoard, votesCleared, participantRemoved,
    canUndo: Boolean(state?.undo.length), canRedo: Boolean(state?.redo.length),
  }
}
