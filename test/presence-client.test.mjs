import test from 'node:test'
import assert from 'node:assert/strict'
import { createPresenceClient, linkMode } from '../src/ui/presenceClient.js'

const ME = 'KM-MMMM-MMMM-MMMM'
const ANN = 'KM-AAAA-AAAA-AAAA'
const BOB = 'KM-BBBB-BBBB-BBBB'
const AV = { bg: 1, body: 2, eyes: 3, mouth: 4, extra: 5 }

// A clock that drives both `now` and the timers, so heartbeats, frames and expiry are exact. A timer with delay 0 fires
// on the next advance(0), which is how the "frame" (the once-per-frame refresh) is flushed in these tests.
function clock() {
  let now = 1_000_000
  let seq = 0
  const pending = new Map()
  const timers = {
    setTimeout: (fn, ms) => { const id = ++seq; pending.set(id, { fn, at: now + ms, every: null }); return id },
    clearTimeout: (id) => void pending.delete(id),
    setInterval: (fn, ms) => { const id = ++seq; pending.set(id, { fn, at: now + ms, every: ms }); return id },
    clearInterval: (id) => void pending.delete(id),
  }
  return {
    timers, now: () => now, timersLeft: () => pending.size,
    advance(ms) {
      const end = now + ms
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
        if (!due) break
        const [id, t] = due
        now = Math.max(now, t.at)
        if (t.every) t.at = now + t.every
        else pending.delete(id)
        t.fn()
      }
      now = end
    },
  }
}

function make(extra = {}) {
  const c = clock()
  const sent = []
  const frames = []
  const client = createPresenceClient({
    selfUid: ME, send: (m) => sent.push(m), timers: c.timers, now: c.now, rand: () => 0,
    requestFrame: (fn) => { frames.push(1); return c.timers.setTimeout(fn, 0) }, cancelFrame: (id) => c.timers.clearTimeout(id),
    ...extra,
  })
  const seen = []
  client.subscribe(() => seen.push(1))
  const flush = () => c.advance(0)
  const recv = (msg, from, cid) => { client.receive(msg, from, cid); flush() }
  const hello = (from, name, cid = `c-${from}`) => recv({ t: 'hello', name, avatar: AV }, from, cid)
  const count = (t) => sent.filter((m) => m.t === t).length
  return { c, sent, client, seen, hello, recv, flush, frames, count }
}

test('nothing is sent or scheduled until the stream is live; going live says hello at once, once more at 2 s if still alone, then nothing', () => {
  const { c, sent, client } = make()
  assert.deepEqual(sent, [])
  assert.equal(c.timersLeft(), 0)
  client.setLive(true)
  assert.deepEqual(sent, [{ t: 'hello' }])
  c.advance(1999)
  assert.equal(sent.length, 1)
  c.advance(1)
  assert.equal(sent.length, 2, 'the follow-up')
  c.advance(120_000)
  assert.equal(sent.length, 2, 'alone: no heartbeat, no Redis commands')
  client.destroy()
})

test('the follow-up hello is skipped when somebody answered in time', () => {
  const { c, sent, client, hello } = make()
  client.setLive(true)
  c.advance(500)
  hello(ANN, 'Ann Otter')
  sent.length = 0
  c.advance(1600)
  assert.deepEqual(sent.map((m) => m.t), ['hello'], 'only the reply to ann: the follow-up saw a peer')
  client.destroy()
})

test('the 5 s heartbeat runs only while somebody is here, and resumes when somebody appears', () => {
  const { c, sent, client, hello, count } = make()
  client.setLive(true)
  c.advance(3000)
  hello(ANN, 'Ann Otter') // wakes us: we answer her, and from now on there is somebody to beat for
  sent.length = 0
  for (let i = 0; i < 3; i++) { c.advance(4000); hello(ANN, 'Ann Otter') } // 12 s, ann keeps talking
  assert.ok(count('hello') >= 2, `heartbeating while ann is here (${count('hello')})`)
  c.advance(13_000) // ann goes silent and expires
  assert.equal(client.getPeers().length, 0)
  sent.length = 0
  c.advance(60_000)
  assert.equal(count('hello'), 0, 'alone again: quiet')
  hello(BOB, 'Bob Beaver')
  sent.length = 0
  c.advance(10_000)
  assert.ok(count('hello') >= 1, 'a peer appeared: heartbeat resumed')
  client.destroy()
})

test('hello stops while the page is hidden and starts again, with an immediate hello, when it is visible', () => {
  const { c, sent, client, hello } = make()
  client.setLive(true)
  hello(ANN, 'Ann Otter')
  c.advance(1000)
  sent.length = 0
  client.setVisible(false)
  hello(ANN, 'Ann Otter')
  c.advance(30_000)
  assert.equal(sent.length, 0, 'no heartbeat, no reply while hidden')
  client.setVisible(true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].t, 'hello')
  client.setVisible(true)
  assert.equal(sent.length, 1, 'a repeated visible does not double the heartbeat')
  client.destroy()
})

test('going live while hidden waits for visibility; "off" forgets everyone and stops every timer', () => {
  const { c, sent, client, hello } = make()
  client.setVisible(false)
  client.setLive(true)
  assert.equal(sent.length, 0)
  client.setVisible(true)
  assert.equal(sent.length, 1)
  hello(ANN, 'Ann Otter')
  assert.equal(client.getPeers().length, 1)
  client.setLink('off')
  assert.deepEqual([client.getPeers(), client.getCursors(), client.getSelections()], [[], [], []])
  const n = sent.length
  c.advance(60_000)
  assert.equal(sent.length, n)
  assert.equal(c.timersLeft(), 0, 'no timer survives')
  client.destroy()
})

test('a dropped stream pauses (people kept, nothing sent or applied); coming back resumes with a hello and no change', () => {
  const { c, sent, client, hello, seen, recv } = make()
  client.setLink('live')
  hello(ANN, 'Ann Otter')
  hello(BOB, 'Bob Beaver')
  recv({ t: 'cursor', x: 3, y: 4, name: 'Ann Otter', avatar: AV }, ANN, `c-${ANN}`)
  const peers = client.getPeers()
  const n = seen.length
  client.setLink('paused')
  c.advance(5000)
  assert.equal(client.getPeers(), peers, 'same people, same array')
  const quiet = sent.length
  c.advance(4000)
  recv({ t: 'hello', name: 'Zed Late', avatar: AV }, 'KM-ZZZZ-ZZZZ-ZZZZ', 'z')
  assert.equal(sent.length, quiet, 'nothing is sent while paused')
  assert.equal(client.getPeers().length, 2, 'and nothing is received')
  client.setLink('live')
  assert.equal(sent.at(-1).t, 'hello', 'a hello on the way back')
  assert.equal(client.getPeers(), peers)
  assert.equal(seen.length, n, 'no change was notified: nobody "joined"')
  client.destroy()
})

test('while paused, silence still ages people out (12 s); "off" after a pause wipes', () => {
  const { c, client, hello } = make()
  client.setLink('live')
  hello(ANN, 'Ann Otter')
  client.setLink('paused')
  c.advance(11_000)
  assert.equal(client.getPeers().length, 1)
  c.advance(2000)
  assert.deepEqual(client.getPeers(), [])
  client.setLink('live')
  hello(BOB, 'Bob Beaver')
  client.setLink('paused')
  client.setLink('off')
  assert.deepEqual(client.getPeers(), [])
  assert.equal(c.timersLeft(), 0)
  client.destroy()
})

test('peers appear from hello, exclude yourself, and expire 12 s after the last message', () => {
  const { c, client, hello } = make()
  client.setLive(true)
  hello(ANN, 'Ann Otter')
  hello(ME, 'Me Myself', 'my-other-tab')
  assert.deepEqual(client.getPeers().map((p) => p.name), ['Ann Otter'])
  c.advance(11_000)
  assert.equal(client.getPeers().length, 1)
  hello(BOB, 'Bob Beaver')
  c.advance(2_000)
  assert.deepEqual(client.getPeers().map((p) => p.name), ['Bob Beaver'], 'ann was silent for more than 12 s')
  c.advance(11_000)
  assert.deepEqual(client.getPeers(), [])
  client.destroy()
})

test('snapshots are referentially stable until what they show changes (useSyncExternalStore needs that)', () => {
  const { client, seen, hello, recv } = make()
  client.setLive(true)
  hello(ANN, 'Ann Otter')
  const peers = client.getPeers()
  const n = seen.length
  hello(ANN, 'Ann Otter') // a heartbeat: same roster
  assert.equal(client.getPeers(), peers)
  assert.equal(seen.length, n, 'no notification for a heartbeat')
  recv({ t: 'cursor', x: 1, y: 2, name: 'Ann Otter', avatar: AV }, ANN, `c-${ANN}`)
  assert.equal(client.getPeers(), peers, 'the roster did not change')
  assert.equal(seen.length, n + 1)
  const cursors = client.getCursors()
  recv({ t: 'cursor', x: 1, y: 2, name: 'Ann Otter', avatar: AV }, ANN, `c-${ANN}`)
  assert.equal(client.getCursors(), cursors)
  recv({ t: 'cursor', x: 5, y: 2, name: 'Ann Otter', avatar: AV }, ANN, `c-${ANN}`)
  assert.notEqual(client.getCursors(), cursors)
  assert.equal(client.getCursors()[0].x, 5)
  client.destroy()
})

test('a burst of messages inside one frame recomputes the display once', () => {
  const { client, seen, frames, flush } = make()
  client.setLive(true)
  const n = seen.length
  const f = frames.length
  for (let i = 0; i < 100; i++) client.receive({ t: 'cursor', x: i, y: i, name: 'Ann Otter', avatar: AV }, ANN, `c-${ANN}`)
  assert.equal(seen.length, n, 'nothing yet: the frame has not come')
  assert.equal(frames.length, f + 1, 'one frame requested for 100 messages')
  flush()
  assert.equal(seen.length, n + 1)
  assert.equal(client.getCursors()[0].x, 99)
  client.destroy()
})

test('at most the 50 most recently active cursors are exposed', () => {
  const { c, client, recv } = make()
  client.setLive(true)
  for (let i = 0; i < 60; i++) {
    c.advance(10)
    recv({ t: 'cursor', x: i, y: i, name: `Person ${String(i).padStart(2, '0')}`, avatar: AV }, `KM-${String(i).padStart(4, '0')}-AAAA-AAAA`, `c${i}`)
  }
  const shown = client.getCursors()
  assert.equal(shown.length, 50)
  assert.ok(shown.every((s) => s.x >= 10), 'the ten oldest are the ones left out')
  assert.equal(client.getPeers().length, 60, 'everyone is still in the roster')
  client.destroy()
})

test('cursors hide after 10 s of no movement and the subscribers hear about it; the person stays', () => {
  const { c, client, seen, hello, recv } = make()
  client.setLive(true)
  hello(ANN, 'Ann Otter')
  recv({ t: 'cursor', x: 1, y: 2, name: 'Ann Otter', avatar: AV }, ANN, `c-${ANN}`)
  assert.equal(client.getCursors().length, 1)
  const n = seen.length
  c.advance(4_000)
  hello(ANN, 'Ann Otter') // alive, but the cursor has not moved
  c.advance(7_000) // the once-a-second check has run since the cursor went 10 s without moving
  assert.deepEqual(client.getCursors(), [])
  assert.ok(seen.length > n)
  assert.equal(client.getPeers().length, 1)
  client.destroy()
})

test('selections of others are exposed and cleared by an empty selection; messages from yourself are ignored', () => {
  const { client, hello, recv } = make()
  client.setLive(true)
  hello(ANN, 'Ann Otter')
  recv({ t: 'sel', ids: ['a', 'b'] }, ANN, `c-${ANN}`)
  assert.deepEqual(client.getSelections().map((s) => [s.name, s.ids]), [['Ann Otter', ['a', 'b']]])
  recv({ t: 'sel', ids: ['z'] }, ME, 'other-tab')
  recv({ t: 'cursor', x: 1, y: 1, name: 'Me Myself', avatar: AV }, ME, 'other-tab')
  assert.equal(client.getSelections().length, 1)
  assert.equal(client.getCursors().length, 0)
  recv({ t: 'sel', ids: [] }, ANN, `c-${ANN}`)
  assert.deepEqual(client.getSelections(), [])
  client.destroy()
})

test('hostile messages are ignored without notifying or throwing', () => {
  const { client, seen, recv } = make()
  client.setLive(true)
  const n = seen.length
  for (const [msg, from, cid] of [[null, ANN], ['x', ANN], [{ t: 'cursor', x: 'a', y: 1, name: 'N' }, ANN, 'c'], [{ t: 'evil' }, ANN], [{ t: 'hello', name: 'N' }, 5], [{ t: 'hello', name: 'N' }, ANN, 'bad cid']]) recv(msg, from, cid)
  assert.equal(seen.length, n)
  assert.deepEqual(client.getPeers(), [])
  client.destroy()
})

test('own cursor is sent only while live, visible and somebody else is here; coordinates are rounded and repeats skipped', () => {
  const { client, sent, hello } = make()
  client.cursor(1, 1)
  client.setLive(true)
  client.cursor(1, 1)
  assert.deepEqual(sent.map((m) => m.t), ['hello'], 'alone: no cursor traffic')
  hello(ANN, 'Ann Otter')
  sent.length = 0
  client.cursor(10.4, 20.6)
  client.cursor(10.3, 20.7) // rounds to the same point
  client.cursor(11, 20)
  assert.deepEqual(sent, [{ t: 'cursor', x: 10, y: 21 }, { t: 'cursor', x: 11, y: 20 }])
  client.setVisible(false)
  client.cursor(50, 50)
  assert.equal(sent.length, 2)
  client.setLink('paused')
  client.setVisible(true)
  client.cursor(60, 60)
  assert.equal(sent.length, 2, 'nor while the stream is down')
  client.destroy()
})

test('cursor traffic stops when the last peer leaves', () => {
  const { c, client, sent, hello } = make()
  client.setLive(true)
  hello(ANN, 'Ann Otter')
  c.advance(13_000)
  assert.equal(client.getPeers().length, 0)
  sent.length = 0
  client.cursor(5, 5)
  assert.deepEqual(sent, [])
  client.destroy()
})

test('selection changes are debounced by 100 ms, sent once per change, truncated to 100 ids, and only when somebody is here', () => {
  const { c, client, sent, hello } = make()
  client.setLive(true)
  client.select(['a'])
  c.advance(200)
  assert.deepEqual(sent.filter((m) => m.t === 'sel'), [], 'alone: nothing sent')
  hello(ANN, 'Ann Otter') // the newcomer is told about the current selection as part of the reply
  c.advance(1000)
  assert.deepEqual(sent.filter((m) => m.t === 'sel'), [{ t: 'sel', ids: ['a'] }])
  sent.length = 0
  client.select(['a', 'b'])
  client.select(['a', 'b', 'c'])
  c.advance(99)
  assert.equal(sent.length, 0)
  c.advance(1)
  assert.deepEqual(sent, [{ t: 'sel', ids: ['a', 'b', 'c'] }])
  client.select(['a', 'b', 'c'])
  c.advance(500)
  assert.equal(sent.length, 1, 'the same selection is not sent twice')
  client.select([])
  c.advance(100)
  assert.deepEqual(sent.at(-1), { t: 'sel', ids: [] })
  client.select(Array.from({ length: 150 }, (_, i) => `i${i}`))
  c.advance(100)
  assert.equal(sent.at(-1).ids.length, 100)
  client.destroy()
})

test('a newcomer\'s first hello is answered once with our own hello (and selection) after a short delay; known people are not', () => {
  const { c, client, sent, hello } = make({ rand: () => 0.5 })
  client.setLive(true)
  client.select(['x', 'y'])
  c.advance(200)
  sent.length = 0
  hello(ANN, 'Ann Otter')
  assert.equal(sent.length, 0, 'not instantly')
  c.advance(349)
  assert.equal(sent.length, 0)
  c.advance(2)
  assert.deepEqual(sent, [{ t: 'hello' }, { t: 'sel', ids: ['x', 'y'] }])
  sent.length = 0
  hello(ANN, 'Ann Otter')
  c.advance(1000)
  assert.equal(sent.length, 0, 'ann is already known')
  hello(BOB, 'Bob Beaver')
  hello('KM-CCCC-CCCC-CCCC', 'Cy Crane')
  c.advance(1000)
  assert.equal(sent.filter((m) => m.t === 'hello').length, 1, 'two newcomers at once share one reply')
  client.destroy()
})

test('hearing somebody else answer the newcomer first cancels our pending reply; a second newcomer does not', () => {
  const { c, client, sent, hello } = make({ rand: () => 0.5 })
  client.setLive(true)
  hello(ANN, 'Ann Otter')
  c.advance(1000) // we answered ann; she is known
  sent.length = 0
  hello(BOB, 'Bob Beaver') // newcomer bob: we schedule a reply
  c.advance(100)
  hello(ANN, 'Ann Otter') // ann (known) said hello within the window: she is answering bob
  c.advance(900)
  assert.equal(sent.filter((m) => m.t === 'hello').length, 0, 'our reply was cancelled')
  hello('KM-CCCC-CCCC-CCCC', 'Cy Crane') // newcomer cy: reply again
  c.advance(100)
  hello('KM-DDDD-DDDD-DDDD', 'Di Dove') // another newcomer is not an answer
  c.advance(700)
  assert.equal(sent.filter((m) => m.t === 'hello').length, 1, 'one reply covers both newcomers')
  client.destroy()
})

// A whole room: `n` clients wired through a bus with 20 ms of latency. A newcomer's hello must not make everybody answer.
function room(n, seed) {
  const c = clock()
  const mulberry = (s) => () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const ids = Array.from({ length: n }, (_, i) => `KM-${String(i).padStart(4, '0')}-AAAA-AAAA`)
  const clients = []
  const stats = { hellos: 0, deliveries: 0 }
  let wired = false
  for (let i = 0; i < n; i++) {
    const send = (msg) => {
      if (!wired || msg.t !== 'hello') return
      stats.hellos++
      for (let j = 0; j < n; j++) {
        if (j === i) continue
        c.timers.setTimeout(() => { stats.deliveries++; clients[j].receive({ t: 'hello', name: `Person ${i}`, avatar: AV }, ids[i], `cid${i}`) }, 20)
      }
    }
    clients.push(createPresenceClient({ selfUid: ids[i], send, timers: c.timers, now: c.now, rand: mulberry(seed * 1000 + i) }))
  }
  return { c, clients, ids, stats, wire: (on) => { wired = on } }
}

test('with 50 people in the room a newcomer\'s hello is answered by a handful, not by everyone', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = room(51, seed)
    const veterans = r.clients.slice(0, 50)
    veterans.forEach((cl) => cl.setLive(true))
    // everybody already knows everybody (their hellos were delivered earlier): feed it directly, bus switched off
    veterans.forEach((cl, i) => veterans.forEach((_, j) => { if (j !== i) cl.receive({ t: 'hello', name: `Person ${j}`, avatar: AV }, r.ids[j], `cid${j}`) }))
    r.c.advance(5000) // their own timers settle (replies to each other are not sent: the bus is off)
    r.wire(true)
    r.stats.hellos = 0
    r.clients[50].setLive(true) // the newcomer: initial hello goes to all 50
    r.c.advance(3000)
    const replies = r.stats.hellos - 1 - 1 // minus the newcomer's initial hello and its 2 s follow-up
    assert.ok(replies >= 1, `seed ${seed}: the newcomer learned about somebody (${replies})`)
    assert.ok(replies <= 8, `seed ${seed}: ${replies} replies out of 50 possible`)
    r.clients.forEach((cl) => cl.destroy())
  }
})

test('no reply is sent while hidden or not live', () => {
  const { c, client, sent, hello } = make()
  hello(ANN, 'Ann Otter')
  c.advance(2000)
  assert.equal(sent.length, 0)
  client.setLive(true)
  c.advance(3000)
  sent.length = 0
  client.setVisible(false)
  hello(BOB, 'Bob Beaver')
  c.advance(2000)
  assert.equal(sent.length, 0)
  client.destroy()
})

test('destroy clears every timer, frame and listener, and later calls do nothing', () => {
  const { c, client, sent, seen, hello } = make()
  client.setLive(true)
  hello(ANN, 'Ann Otter')
  client.select(['a'])
  client.receive({ t: 'cursor', x: 1, y: 1, name: 'Ann Otter', avatar: AV }, ANN, 'x') // leaves a frame pending
  assert.ok(c.timersLeft() > 0)
  client.destroy()
  assert.equal(c.timersLeft(), 0)
  const n = seen.length
  const m = sent.length
  client.setLive(true)
  client.setVisible(true)
  hello(BOB, 'Bob Beaver')
  client.cursor(1, 1)
  client.select(['q'])
  c.advance(60_000)
  assert.deepEqual([seen.length, sent.length, c.timersLeft()], [n, m, 0])
  client.destroy()
})

test('unsubscribe stops notifications; a throwing listener does not break the others', () => {
  const { client, hello } = make()
  const got = []
  const off = client.subscribe(() => got.push('a'))
  client.subscribe(() => { throw new Error('boom') })
  client.subscribe(() => got.push('c'))
  client.setLive(true)
  hello(ANN, 'Ann Otter')
  assert.deepEqual(got, ['a', 'c'])
  off()
  hello(BOB, 'Bob Beaver')
  assert.deepEqual(got, ['a', 'c', 'c'])
  client.destroy()
})

test('nameOf remembers who was seen, also after they expired or the stream dropped (to name a celebration)', () => {
  const { c, client, hello } = make()
  assert.equal(client.nameOf(ANN), null)
  client.setLive(true)
  hello(ANN, 'Ann Otter')
  assert.equal(client.nameOf(ANN), 'Ann Otter')
  hello(ANN, 'Ann Renamed')
  assert.equal(client.nameOf(ANN), 'Ann Renamed')
  c.advance(20_000)
  assert.deepEqual(client.getPeers(), [])
  assert.equal(client.nameOf(ANN), 'Ann Renamed')
  client.setLive(false)
  assert.equal(client.nameOf(ANN), 'Ann Renamed')
  assert.equal(client.nameOf(BOB), null)
  client.destroy()
})

test('linkMode: live is live, a blip (offline / connecting) pauses, polling or leaving the board wipes', () => {
  assert.equal(linkMode('ready', 'live'), 'live')
  assert.equal(linkMode('ready', 'offline'), 'paused')
  assert.equal(linkMode('ready', 'connecting'), 'paused')
  assert.equal(linkMode('ready', 'polling'), 'off')
  for (const phase of ['loading', 'persona', 'revoked', 'passcode', 'missing', 'error']) assert.equal(linkMode(phase, 'live'), 'off', phase)
})
