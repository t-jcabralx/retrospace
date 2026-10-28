// Client transport: batched writes, SSE with a polling fallback, throttled ephemeral messages.
// Browser globals (EventSource, fetch, timers) are only touched inside functions so this imports cleanly in node.

const POLL_MS = 3000
const BATCH_MS = 50
const MAX_BATCH = 50 // the ops route accepts at most 50 per call
const RETRY_MS = [500, 1500, 4000]
const EPH_GAP_MS = 67 // ~15 per second
const TOK_REFRESH_MS = 20 * 60_000 // the server's membership token lives 30 minutes
const SEND_REJOIN_COOLDOWN_MS = 30_000

// Wrapped so the browser never sees them called detached from window.
const defaultTimers = () => ({
  setTimeout: (...a) => globalThis.setTimeout(...a),
  clearTimeout: (...a) => globalThis.clearTimeout(...a),
  setInterval: (...a) => globalThis.setInterval(...a),
  clearInterval: (...a) => globalThis.clearInterval(...a),
})

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// One id per createSync instance. The uid is shared by every tab of a browser, so echoes are told apart by this.
function randomCid() {
  const bytes = new Uint8Array(12)
  globalThis.crypto.getRandomValues(bytes)
  return 'c' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Should a decoded stream envelope be applied by the client `self = { uid, cid }`?
// Envelopes carry the sender's cid; one without it (older server) falls back to comparing uids.
export function shouldApply(env, self) {
  if (!isObj(env) || typeof env.from !== 'string') return false
  if (typeof env.cid === 'string' ? env.cid === self?.cid : env.from === self?.uid) return false
  if (env.t === 'ops') return Array.isArray(env.ops)
  if (env.t === 'eph') return isObj(env.msg)
  if (env.t === 'board') return isObj(env.board)
  if (env.t === 'deleted') return true // the owner deleted the board
  if (env.t === 'kicked') return typeof env.id === 'string' && env.id.length > 0
  return false
}

const SINCE_OVERLAP_MS = 2000
const maxUpdated = (items, from) => items.reduce((m, i) => Math.max(m, Number(i?.updatedAt) || 0), from)

// `identity` = { uid }: the guest uid the SERVER minted (snapshot.viewer.uid). It names this client's own echoes and goes
// into the /send body and the /stream query; the server only trusts the signed rs_g cookie and the membership token it
// issued for it, so nothing in here can claim another guest's identity.
//
// Callbacks (a host wires them to the state reducer):
//   onRemote(items)  docs from the stream and /since   -> dispatch { type: 'remote', items }
//   onAck(items)     the author's own applied docs     -> dispatch { type: 'ack', items }
//   onRejected(list) ops the server refused            -> roll back / resync
//   onBoard(board)   the owner changed the settings: the guest-safe board from the stream or /since (polling), at most
//                    once per updatedAt -> dispatch { type: 'board', board }
//   onEphemeral(msg, from, cid)  a peer's cursor / hello / ...; `from` is its per-board id, `cid` names the tab
//   onClock(serverNow, sentAt, receivedAt) a /since reply carried the server's clock (`now`): the host keeps its offset current
//   watchOnly        true for a viewer who only watches (the board's ?view=1 link): polling only, /api/rt/join is never called
//   onKicked(id)     the owner removed another participant (their per-board id): hosts drop them from the people list. Removal of
//                    THIS client is reported through onDenied(403, 'You were removed from this board'), like a withdrawn access.
//   onDenied(status, message) /since says 401 (passcode required) or 403 (revoked): access was withdrawn. Sync stops
//                    everything and reports status 'denied'; the host shows the matching panel and closes it.
export function createSync({
  code, identity,
  onKicked = () => {}, onRemote = () => {}, onAck = () => {}, onEphemeral = () => {}, onStatus = () => {}, onRejected = () => {}, onDenied = () => {}, onBoard = () => {}, onClock = () => {},
  lastSeen = 0,
  watchOnly = false, // a read-only viewer without a persona: never joins the room, only polls /since (nothing is sent either)
  boardRev, boardAt = 0, // the rev (settings counter) and updatedAt of the board the host already shows: only a newer one is reported
  cid = randomCid(),
  sinceOverlapMs = SINCE_OVERLAP_MS,
  fetchImpl = globalThis.fetch,
  EventSourceImpl = globalThis.EventSource,
  timers = defaultTimers(),
}) {
  let closed = false
  let tok = null
  let live = false // realtime stream in use (as opposed to polling)
  let linkUp = false // stream open / last poll succeeded
  let sendFailed = false
  let status = 'offline'
  let es = null
  let refreshTimer = null
  let rejoinBudget = 1 // re-joins allowed after the stream is refused without opening; every successful open restores it
  let rejoining = false
  let sendCooling = false
  let pollTimer = null
  let polling = false // a poll is in flight
  let denied = false
  let backoffMs = 0 // set by a 429 from /since: how long to leave the server alone
  let backoffTimer = null
  // While not null, a catch-up /since is owed: its cursor stays here however far the stream moves lastSeen.
  let gapFrom = null
  let catching = false
  let catchAgain = false

  const queue = []
  let flushTimer = null
  let flushing = false
  const sleepers = new Set()

  const setStatus = () => {
    if (denied) return
    const next = !linkUp || sendFailed ? 'offline' : live ? 'live' : 'polling'
    if (next === status) return
    status = next
    onStatus(status)
  }

  const post = (url, body) => fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const sleep = (ms) => new Promise((resolve) => {
    const id = timers.setTimeout(() => { sleepers.delete(id); resolve() }, ms)
    sleepers.add(id)
  })

  // --- pulling changes ---
  const cursor = () => (gapFrom !== null ? Math.min(gapFrom, lastSeen) : lastSeen)

  // Seconds from a Retry-After header, clamped to 1..120 (60 when missing or unreadable).
  const retryAfterMs = (res) => {
    const secs = Number(res.headers?.get?.('retry-after'))
    return (Number.isFinite(secs) && secs > 0 ? Math.min(120, Math.max(1, secs)) : 60) * 1000
  }

  // 401/403: access was withdrawn. Stop all traffic (polling a denied board would only hammer the shared per-IP
  // denial limit) and let the host show the passcode / revoked panel.
  function deny(httpStatus, message) {
    if (denied || closed) return
    denied = true
    stopRefresh()
    if (pollTimer !== null) timers.clearInterval(pollTimer)
    pollTimer = null
    if (backoffTimer !== null) timers.clearTimeout(backoffTimer)
    backoffTimer = null
    es?.close()
    es = null
    live = false
    linkUp = false
    status = 'denied'
    onStatus('denied')
    onDenied(httpStatus, message)
  }

  // The owner removed THIS participant: stop everything like a denial (the next request would be a 403 anyway) and tell the host.
  function kick() {
    if (denied || closed) return
    deny(403, 'You were removed from this board')
  }

  // A settings change, from the stream or /since: handed to the host once, when it is newer than what the host has.
  // Newer means a higher `rev` (the server's settings counter: only PATCHes bump it, so item ops and clock differences
  // between servers cannot hide or fake a change). A board made before revs existed has none until its first change,
  // which counts as 0; an incoming board without a rev (an older server) falls back to updatedAt.
  function deliverBoard(board) {
    const rev = Number(board.rev)
    const at = Number(board.updatedAt)
    if (Number.isFinite(rev)) {
      if (rev <= (Number.isFinite(boardRev) ? boardRev : 0)) return
    } else if (!Number.isFinite(at) || at <= boardAt) {
      return
    }
    if (Number.isFinite(rev)) boardRev = rev
    if (Number.isFinite(at)) boardAt = at
    onBoard(board)
  }

  async function fetchSince(from) {
    try {
      const sentAt = Date.now()
      // Two seconds back: merging is idempotent (last writer by updatedAt), and a write that landed just behind the cursor is not lost.
      const res = await fetchImpl(`/api/boards/${code}/since?t=${Math.max(0, from - sinceOverlapMs)}`)
      if (res.status === 404) { if (!closed) deny(404, 'Board not found'); return false } // terminal: the board was deleted
      if (res.status === 401 || res.status === 403) {
        const body = await res.json().catch(() => ({}))
        if (!closed) deny(res.status, body?.error)
        return false
      }
      if (res.status === 429) { backoffMs = retryAfterMs(res); return false }
      if (!res.ok) return false
      const data = await res.json()
      if (closed) return false
      if (typeof data.now === 'number') onClock(data.now, sentAt, Date.now())
      const items = Array.isArray(data.items) ? data.items : []
      lastSeen = maxUpdated(items, lastSeen)
      if (items.length) onRemote(items)
      if (isObj(data.board)) deliverBoard(data.board)
      return true
    } catch {
      return false
    }
  }

  async function poll() {
    if (polling) return
    polling = true
    let ok
    try { ok = await fetchSince(cursor()) } finally { polling = false }
    if (closed || denied) return
    if (ok) gapFrom = null
    linkUp = ok
    setStatus()
    if (ok) resume()
    else if (backoffMs) pausePolling()
  }

  // A 429: stop the interval, ask again once Retry-After has passed.
  function pausePolling() {
    const ms = backoffMs
    backoffMs = 0
    if (pollTimer !== null) timers.clearInterval(pollTimer)
    pollTimer = null
    if (backoffTimer !== null) return
    backoffTimer = timers.setTimeout(() => {
      backoffTimer = null
      if (closed || denied) return
      startPolling()
      poll()
    }, ms)
  }

  // Fetch what the stream may have missed (before it first opened, or while it was down) until it works.
  // A request made while one is running is not dropped: it queues exactly one more round.
  async function catchUp() {
    if (catching) { catchAgain = true; return }
    catching = true
    try {
      let attempt = 0
      while (!closed && !denied && live && gapFrom !== null) {
        catchAgain = false
        const ok = await fetchSince(cursor())
        if (closed || denied) return
        if (ok) {
          if (!catchAgain) { gapFrom = null; return }
          attempt = 0
        } else {
          const wait = backoffMs || (RETRY_MS[attempt++] ?? POLL_MS)
          backoffMs = 0
          await sleep(wait)
        }
      }
    } finally {
      catching = false
    }
  }

  function startPolling() {
    live = false
    if (pollTimer !== null) return
    pollTimer = timers.setInterval(poll, POLL_MS)
  }

  // --- stream ---
  function openStream(token) {
    const q = `code=${encodeURIComponent(code)}&uid=${encodeURIComponent(identity.uid)}&tok=${encodeURIComponent(token)}`
    es = new EventSourceImpl(`/api/rt/stream?${q}`)
    live = true
    es.addEventListener('open', () => {
      rejoinBudget = 1
      linkUp = true
      setStatus()
      if (gapFrom === null) gapFrom = lastSeen // every open owes a catch-up, the first included
      catchUp()
      resume()
    })
    es.addEventListener('error', () => {
      if (closed) return
      if (es.readyState === 2) { // the browser gave up (e.g. 403 after a revoke, an expired token, 503)
        es.close()
        es = null
        linkUp = false
        setStatus()
        if (rejoinBudget > 0) { rejoinBudget--; rejoin() } // a fresh token (and a fresh access check) once; else poll
        else { stopRefresh(); startPolling() }
        return
      }
      if (gapFrom === null) gapFrom = lastSeen
      linkUp = false
      setStatus()
    })
    es.addEventListener('message', (e) => {
      let env
      try { env = JSON.parse(e.data) } catch { return }
      if (!shouldApply(env, { uid: identity.uid, cid })) return
      if (env.t === 'ops') {
        lastSeen = maxUpdated(env.ops, lastSeen)
        onRemote(env.ops)
      } else if (env.t === 'deleted') {
        deny(404, 'Board not found')
      } else if (env.t === 'board') {
        deliverBoard(env.board)
      } else if (env.t === 'kicked') {
        if (env.id === identity.uid) kick()
        else onKicked(env.id)
      } else {
        onEphemeral(env.msg, env.from, env.cid)
      }
    })
  }

  // POSTs /api/rt/join -> { status, data } (data null unless 200), or null when the request failed.
  async function joinRoom() {
    try {
      const res = await post('/api/rt/join', { code })
      const data = res.ok ? await res.json() : null
      if (res.status === 404 && !closed) deny(404, 'Board not found')
      return { status: res.status, data, retryMs: res.status === 429 ? retryAfterMs(res) : 0 }
    } catch {
      return null
    }
  }

  // The join was rate limited (429): poll in the meantime and ask for the stream again once Retry-After has passed.
  function retryJoinLater(r) {
    if (r?.status !== 429 || closed || denied) return
    timers.setTimeout(() => { if (!closed && !denied && es === null) rejoin() }, r.retryMs)
  }

  const canStream = (r) => !!(r?.data?.tok && r.data.live && typeof EventSourceImpl === 'function')

  function stopRefresh() {
    if (refreshTimer !== null) timers.clearInterval(refreshTimer)
    refreshTimer = null
  }

  function toPolling() {
    if (denied) return
    stopRefresh()
    es?.close()
    es = null
    linkUp = false
    startPolling()
    poll() // the polling route's own access check decides what happens next
  }

  async function start() {
    if (watchOnly) { startPolling(); poll(); return }
    const r = await joinRoom()
    if (closed || denied) return
    if (canStream(r)) {
      tok = r.data.tok
      refreshTimer = timers.setInterval(refreshTok, TOK_REFRESH_MS)
      openStream(tok)
      return
    }
    startPolling()
    poll()
    retryJoinLater(r)
  }

  // The stream was refused: get a new token and reopen it. If the join is refused too (access withdrawn), poll.
  async function rejoin() {
    if (rejoining || closed || denied) return
    rejoining = true
    try {
      const r = await joinRoom()
      if (closed || denied) return
      if (canStream(r)) {
        tok = r.data.tok
        if (refreshTimer === null) refreshTimer = timers.setInterval(refreshTok, TOK_REFRESH_MS)
        openStream(tok)
      } else {
        toPolling()
        retryJoinLater(r)
      }
    } finally {
      rejoining = false
    }
  }

  // New token for /send while the stream stays open (timer, or /send said 401/403). If access was withdrawn
  // (401/403) the stream is closed and polling takes over; a network error or 5xx keeps what is running.
  async function refreshTok() {
    if (rejoining || closed) return
    rejoining = true
    try {
      const r = await joinRoom()
      if (closed || denied) return
      // The stream may have been refused while this join was in flight (rejoin() backs off while we hold the flag):
      // if nothing is running any more, reopen it or poll, so the board never silently stops updating.
      const idle = es === null && pollTimer === null
      if (canStream(r)) {
        tok = r.data.tok
        if (idle) openStream(tok)
      } else if ((r && (r.status === 401 || r.status === 403)) || idle) {
        toPolling()
      }
    } finally {
      rejoining = false
    }
  }

  // --- writing ops ---
  function scheduleFlush() {
    if (flushTimer !== null || flushing || closed) return
    flushTimer = timers.setTimeout(flush, BATCH_MS)
  }

  // Re-send what an outage left queued, once the link works again.
  function resume() {
    if (queue.length) scheduleFlush()
  }

  async function flush() {
    flushTimer = null
    if (flushing || closed || !queue.length) return
    flushing = true
    const batch = queue.splice(0, MAX_BATCH)
    let attempt = 0
    for (;;) {
      let outcome
      try {
        const res = await post(`/api/boards/${code}/ops`, { cid, ops: batch })
        if (res.ok) {
          outcome = { data: await res.json() }
        } else if (res.status >= 500 || res.status === 429 || res.status === 408) {
          outcome = { retry: true }
        } else {
          const body = await res.json().catch(() => ({}))
          outcome = { drop: body?.error || `error ${res.status}` }
        }
      } catch {
        outcome = { retry: true }
      }
      if (closed) break
      if (outcome.data) {
        sendFailed = false
        setStatus()
        const { applied = [], rejected = [] } = outcome.data
        if (applied.length) onAck(applied)
        if (rejected.length) onRejected(rejected)
        break
      }
      if (outcome.drop) {
        sendFailed = false
        setStatus()
        onRejected(batch.map((o) => ({ id: o.id, error: outcome.drop })))
        break
      }
      if (attempt >= RETRY_MS.length) {
        queue.unshift(...batch) // kept for the next successful poll / stream open / send
        sendFailed = true
        setStatus()
        break
      }
      await sleep(RETRY_MS[attempt++])
      if (closed) break
    }
    flushing = false
    if (queue.length && !sendFailed) scheduleFlush()
  }

  // --- ephemeral ---
  const pending = new Map() // msg.t -> { msg, done }: the latest of each type; cursors go last so one-off messages are not starved
  let cooling = false

  function pumpEphemeral() {
    if (cooling || closed || !pending.size) return
    const key = [...pending.keys()].find((k) => k !== 'cursor') ?? 'cursor'
    const { msg, done } = pending.get(key)
    pending.delete(key)
    cooling = true
    const sentTok = tok
    post('/api/rt/send', { code, uid: identity.uid, cid, tok, msg })
      .then(async (res) => {
        if (done) done(res.status, res.ok ? undefined : (await res.json?.().catch(() => ({})))?.error)
        // A refused token (expired, or access withdrawn): get a new one, but not more than once in a while.
        if ((res.status === 401 || res.status === 403) && sentTok === tok && !sendCooling) {
          sendCooling = true
          timers.setTimeout(() => { sendCooling = false }, SEND_REJOIN_COOLDOWN_MS)
          refreshTok()
        }
      })
      .catch(() => {}) // best effort
    timers.setTimeout(() => { cooling = false; pumpEphemeral() }, EPH_GAP_MS)
  }

  start()

  return {
    send(ops) {
      if (closed || !Array.isArray(ops) || !ops.length) return
      queue.push(...ops)
      scheduleFlush()
    },
    // `done(status, error)`, optional: how the server answered this message (never called if a newer one of the same type
    // replaced it, or the request failed). Used where a refusal matters to the person (a throw).
    sendEphemeral(msg, done) {
      if (closed || !live || !tok || !isObj(msg) || typeof msg.t !== 'string') return
      pending.delete(msg.t) // keeps insertion order fresh: the latest message of a type wins
      pending.set(msg.t, { msg, done })
      pumpEphemeral()
    },
    close() {
      closed = true
      es?.close()
      es = null
      if (pollTimer !== null) timers.clearInterval(pollTimer)
      stopRefresh()
      if (backoffTimer !== null) timers.clearTimeout(backoffTimer)
      backoffTimer = null
      if (flushTimer !== null) timers.clearTimeout(flushTimer)
      for (const id of sleepers) timers.clearTimeout(id)
      pollTimer = flushTimer = null
      pending.clear()
    },
    status: () => status,
    cid,
  }
}
