// The live side of presence for one open board: keeps the presence model (presence.js) fed from the stream, says
// `hello` while this page is live and visible, sends our own cursor and selection, and expires people who go quiet.
// Plain JS with everything injected (send, timers, clock, frames) so it runs, and is tested, without a browser; the
// React hook (usePresence.js) is a thin wrapper.
//
// Link modes (setLink):
//   'live'   the realtime stream is open: everything works.
//   'paused' the stream dropped for a moment (the routine reconnect, a blip): nothing is sent or received, but the
//            people stay, and the 12 s expiry keeps running, so a short outage costs nothing and a long one ages out.
//   'off'    no realtime (polling, board left): nothing is sent, nobody is shown, no timer runs.
import { createPresence, applyEphemeral, prune, peers, cursors, selections } from './presence.js'

export const HELLO_MS = 5000
const FOLLOW_UP_MS = 2000 // one more hello after the first if still alone: covers the other side's stream opening a moment later
const TICK_MS = 1000 // expiry and idle-cursor check
const SEL_DEBOUNCE_MS = 100
// Every pointer message is a request and a broadcast to everyone on the board, so they are rationed by how many people are here:
// at most 4 a second with a few people, 2 with a dozen, 1 with more. The cursor on the other side glides between them.
export const cursorGapMs = (peers) => (peers <= 4 ? 250 : peers <= 14 ? 500 : 1000)
const MAX_SEL = 100
const MAX_NAMES = 500
const MAX_CURSORS = 50 // the most recently active pointers; more would only be noise
const REPLY_FAN = 4 // about this many people answer a newcomer's hello, however many are here

// How the board's state maps to a link mode: the stream dropping for a moment ('offline', or 'connecting' on the way
// up) only pauses presence; no realtime at all ('polling') or not being on the board wipes it.
export const linkMode = (phase, status) => (phase !== 'ready' ? 'off' : status === 'live' ? 'live' : status === 'offline' || status === 'connecting' ? 'paused' : 'off')

const defaultTimers = () => ({
  setTimeout: (...a) => globalThis.setTimeout(...a),
  clearTimeout: (...a) => globalThis.clearTimeout(...a),
  setInterval: (...a) => globalThis.setInterval(...a),
  clearInterval: (...a) => globalThis.clearInterval(...a),
})

// `selfUid`: our own per-board id; other tabs of ours are not shown (their messages are dropped on arrival).
// `send(msg)`: sync.sendEphemeral. `rand` jitters and thins the replies to a newcomer's hello.
// `requestFrame` / `cancelFrame`: what the display is recomputed on, at most once per frame (default: a 16 ms timer).
export function createPresenceClient({ selfUid, send, timers = defaultTimers(), now = Date.now, rand = Math.random, requestFrame, cancelFrame }) {
  const askFrame = requestFrame ?? ((fn) => timers.setTimeout(fn, 16))
  const dropFrame = cancelFrame ?? ((id) => timers.clearTimeout(id))
  let p = createPresence()
  let link = 'off'
  let visible = true
  let dead = false
  let helloTimer = null
  let followTimer = null
  let tickTimer = null
  let replyTimer = null
  let replyTo = new Set() // newcomers the pending reply is for
  let selTimer = null
  let frame = null
  let dirty = false
  let wantSel = []
  let sentSel = null // signature of the last selection sent
  let lastCursor = ''
  let cursorAt = 0 // when a cursor message last went out
  let cursorTimer = null
  let cursorPending = null // the newest pointer position that has not been sent
  let peerCount = 0
  let snap = { peers: [], cursors: [], selections: [] }
  let sigs = { peers: '', cursors: '', selections: '' }
  const listeners = new Set()
  const names = new Map() // from -> last known name; outlives expiry, so a late message (a celebration) can still be named

  const signature = {
    peers: (list) => list.map((x) => `${x.id}|${x.name}|${x.tabs}|${JSON.stringify(x.avatar)}`).join('\n'),
    cursors: (list) => list.map((c) => `${c.key}|${c.name}|${c.x}|${c.y}`).join('\n'),
    selections: (list) => list.map((s) => `${s.id}|${s.name}|${s.ids.join(',')}`).join('\n'),
  }

  // Recomputes what is shown. A slice keeps its array (same reference) unless something visible in it changed, so a
  // heartbeat re-renders nothing; listeners hear about a change only.
  function refresh() {
    const next = {
      peers: peers(p).filter((x) => x.id !== selfUid),
      cursors: cursors(p, now()).filter((c) => c.id !== selfUid).sort((a, b) => b.lastSeen - a.lastSeen).slice(0, MAX_CURSORS),
      selections: selections(p).filter((s) => s.id !== selfUid),
    }
    peerCount = next.peers.length
    let changed = false
    for (const k of Object.keys(next)) {
      const sig = signature[k](next[k])
      if (sig === sigs[k]) continue
      sigs = { ...sigs, [k]: sig }
      snap = { ...snap, [k]: next[k] }
      changed = true
    }
    if (changed) for (const fn of [...listeners]) { try { fn() } catch { /* one bad listener must not stop the rest */ } }
  }

  // Many messages arrive per frame (cursors): the display is recomputed once.
  function touch() {
    dirty = true
    if (frame === null && !dead) {
      frame = askFrame(() => {
        frame = null
        if (dirty && !dead) { dirty = false; refresh() }
      })
    }
  }
  function flushNow() {
    if (frame !== null) { dropFrame(frame); frame = null }
    dirty = false
    refresh()
  }

  const hasPeers = () => peerCount > 0
  const sayHello = () => send({ t: 'hello' })
  const live = () => link === 'live' && !dead
  const knownPeople = (except) => [...p.people.values()].filter((x) => x.name && x.id !== selfUid && x.id !== except).length

  const clear = (t, fn) => { if (t !== null) fn(t) }
  function stopHello() {
    clear(helloTimer, timers.clearInterval)
    clear(followTimer, timers.clearTimeout)
    helloTimer = followTimer = null
  }
  function stopSending() {
    stopHello()
    clear(cursorTimer, timers.clearTimeout)
    cursorTimer = cursorPending = null
    clear(replyTimer, timers.clearTimeout)
    clear(selTimer, timers.clearTimeout)
    replyTimer = selTimer = null
    replyTo = new Set()
  }
  function stopAll() {
    stopSending()
    clear(tickTimer, timers.clearInterval)
    tickTimer = null
    if (frame !== null) dropFrame(frame)
    frame = null
    dirty = false
  }

  // Hello on opening (and returning to a visible page), once more shortly after if nobody has answered; then only
  // every HELLO_MS while somebody is here. Alone, a heartbeat would cost Redis commands for nothing, and a
  // newcomer's own hello is what wakes us up (we answer it).
  function startHello() {
    if (helloTimer !== null || !live() || !visible) return
    sayHello()
    followTimer = timers.setTimeout(() => { followTimer = null; if (live() && visible && !hasPeers()) sayHello() }, FOLLOW_UP_MS)
    helloTimer = timers.setInterval(() => { if (hasPeers()) sayHello() }, HELLO_MS)
  }

  function flushCursor() {
    clear(cursorTimer, timers.clearTimeout)
    cursorTimer = null
    const pt = cursorPending
    cursorPending = null
    if (!pt || !live() || !visible || !hasPeers()) return
    cursorAt = now()
    send({ t: 'cursor', ...pt })
  }

  function flushSel() {
    selTimer = null
    if (!live() || !hasPeers()) return
    const sig = wantSel.join('\u0001')
    if (sig === sentSel) return
    sentSel = sig
    send({ t: 'sel', ids: wantSel })
  }

  // A hello arrived. A never-seen person is a newcomer: we answer (and tell them our selection) after a random delay,
  // but only some of us do (about REPLY_FAN whatever the head count) and the delay grows with the head count; hearing
  // an answer from somebody else first cancels ours. That keeps a join at a handful of messages, not one per person.
  function onHello(from, knew) {
    if (!live() || !visible) return
    if (knew) {
      if (replyTimer !== null && !replyTo.has(from)) { // somebody else already answered the newcomer
        timers.clearTimeout(replyTimer)
        replyTimer = null
        replyTo = new Set()
      }
      return
    }
    const known = knownPeople(from)
    if (rand() >= Math.min(1, REPLY_FAN / Math.max(1, known))) return
    replyTo.add(from)
    if (replyTimer !== null) return
    replyTimer = timers.setTimeout(() => {
      replyTimer = null
      replyTo = new Set()
      if (!live() || !visible) return
      sayHello()
      if (wantSel.length) { sentSel = wantSel.join('\u0001'); send({ t: 'sel', ids: wantSel }) }
    }, 100 + rand() * (500 + 20 * known))
  }

  function setLink(mode) {
    if (dead || mode === link) return
    const was = link
    link = mode
    if (mode === 'live') {
      sentSel = null
      if (tickTimer === null) tickTimer = timers.setInterval(() => { p = prune(p, now()); touch() }, TICK_MS)
      startHello()
    } else if (mode === 'paused') {
      stopSending() // the people stay; the tick keeps ageing them
      if (was === 'off' && tickTimer === null) tickTimer = timers.setInterval(() => { p = prune(p, now()); touch() }, TICK_MS)
    } else {
      stopAll()
      p = createPresence()
      lastCursor = ''
      flushNow()
    }
  }

  return {
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getPeers: () => snap.peers,
    getCursors: () => snap.cursors,
    getSelections: () => snap.selections,
    hasPeers,
    nameOf: (from) => names.get(from) ?? null,

    setLink,
    // Shorthand: the stream is open (true) or there is no realtime at all (false).
    setLive: (on) => setLink(on ? 'live' : 'off'),

    // The page was hidden or shown. Hidden pages stay quiet, and are forgotten by the others after the ttl.
    setVisible(on) {
      if (dead || on === visible) return
      visible = on
      if (on) startHello()
      else stopHello()
    },

    receive(msg, from, cid) {
      if (!live() || from === selfUid) return
      const knew = Boolean(p.people.get(from)?.name)
      const next = applyEphemeral(p, { from, cid, msg }, now())
      if (next === p) return
      p = next
      const name = p.people.get(from)?.name
      if (name) {
        names.delete(from)
        names.set(from, name)
        if (names.size > MAX_NAMES) names.delete(names.keys().next().value)
      }
      if (!knew && name) peerCount += 1 // until the next refresh recounts: the first cursor must not wait for a frame
      if (msg.t === 'hello' && name) onHello(from, knew)
      touch()
    },

    // Our pointer, in world coordinates. Skipped unless it can be seen by somebody.
    cursor(x, y) {
      if (!live() || !visible || !hasPeers()) return
      const pt = { x: Math.round(x), y: Math.round(y) }
      const sig = `${pt.x},${pt.y}`
      if (sig === lastCursor) return
      lastCursor = sig
      cursorPending = pt
      const wait = cursorGapMs(peerCount) - (now() - cursorAt)
      if (wait <= 0) flushCursor()
      else if (cursorTimer === null) cursorTimer = timers.setTimeout(flushCursor, wait) // the newest position goes out when the gap is over
    },

    // Our selection (item ids), sent 100 ms after the last change.
    select(ids) {
      if (dead) return
      wantSel = ids.slice(0, MAX_SEL)
      if (!live()) return // remembered for when the stream is back
      if (selTimer !== null) timers.clearTimeout(selTimer)
      selTimer = timers.setTimeout(flushSel, SEL_DEBOUNCE_MS)
    },

    destroy() {
      if (dead) return
      stopAll()
      dead = true
      listeners.clear()
    },
  }
}
