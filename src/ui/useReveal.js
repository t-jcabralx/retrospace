'use client'
// Loads and follows the data of the recipient's reveal page, read-only. It asks /api/boards/[code]/reveal, which answers with
// the board always and with the cards only once the reveal time has passed (or to the owner), so a countdown page never
// holds a card. Updates arrive by polling (every 3 s; sooner around the reveal moment): the page has no guest identity or
// persona, so there is no realtime membership to use, and nothing is ever written. State is the shared board reducer.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { initialState, reducer } from '../client/state.js'
import { createClock } from './timer.js'
import { orderCards } from './slideshow.js'
import { revealPhase } from './revealPhase.js'
import { joinWithPasscode } from './passcodeApi.js'
import { createPoller } from './revealPoller.js'

const POLL_MS = 3000
const NEAR_MS = 6000 // within this of the reveal time, ask again every FAST_MS until the cards come
const FAST_MS = 700
const RETRY_MS = 5000

// -> { missing } | { passcode } | { revoked } | { data, sentAt, receivedAt }; throws on a network or server failure
async function fetchReveal(code, t) {
  const sentAt = Date.now()
  const res = await fetch(`/api/boards/${code}/reveal${t == null ? '' : `?t=${t}`}`, { cache: 'no-store' })
  if (res.status === 404) return { missing: true }
  if (res.status === 401 || res.status === 403) {
    const error = (await res.json().catch(() => ({})))?.error
    if (res.status === 401 && error === 'Passcode required') return { passcode: true }
    if (res.status === 403 && error === 'This link was revoked') return { revoked: true }
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return { data: await res.json(), sentAt, receivedAt: Date.now() }
}

export function useReveal(code) {
  const [phase, setPhase] = useState('loading') // loading | ready | missing | passcode | revoked | error
  const [state, setState] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState(false) // the cards have arrived at least once
  const clock = useRef(null)
  if (!clock.current) clock.current = createClock()
  const live = useRef({ state: null, loaded: false })

  useEffect(() => {
    let dead = false
    const r = live.current
    r.state = null
    r.loaded = false
    setPhase('loading')
    setState(null)
    setLoaded(false)
    const put = (next) => { r.state = next; setState(next) }

    function nextDelay() {
      const board = r.state?.board
      const role = r.state?.viewer?.role
      const left = board?.revealAt ? Date.parse(board.revealAt) - clock.current.now() : NaN
      if (!r.loaded && Number.isFinite(left) && left > 0 && role !== 'owner') {
        return left < POLL_MS ? Math.max(200, left + 150) : POLL_MS // look again just after the reveal moment
      }
      if (!r.loaded && revealPhase(board, Date.now(), role, clock.current.offset()) === 'ready') return FAST_MS // time is up, the cards are on their way
      return POLL_MS
    }

    // One round: the delay before the next one, or null when the page has reached an end state (nothing more to ask).
    async function tick() {
      try {
        const got = await fetchReveal(code, r.loaded ? r.state.lastSeen : null)
        if (dead) return null
        if (got.missing) { setPhase('missing'); return null }
        if (got.passcode) { setPhase('passcode'); return null }
        if (got.revoked) { setPhase('revoked'); return null }
        const { data } = got
        clock.current.sample(data.now, got.sentAt, got.receivedAt)
        if (!r.state) {
          put(initialState({ board: data.board, items: data.items ?? [], viewer: { role: data.role } }))
          setPhase('ready')
        } else {
          let next = reducer(r.state, { type: 'board', board: data.board })
          if (data.items) next = reducer(next, { type: 'remote', items: data.items })
          if (next !== r.state) put(next)
        }
        if (data.items && !r.loaded) { r.loaded = true; setLoaded(true) }
        return nextDelay()
      } catch {
        if (dead) return null
        if (!r.state) { setPhase('error'); return null }
        return RETRY_MS
      }
    }

    // A single chain of rounds, however often the tab flips between hidden and visible.
    const poller = createPoller({ tick, hidden: () => document.visibilityState === 'hidden', hiddenMinMs: POLL_MS })
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || dead || !r.state) return
      poller.nudge() // catch up the moment the tab is looked at again
    }
    document.addEventListener('visibilitychange', onVisible)
    poller.start()
    return () => { dead = true; poller.stop(); document.removeEventListener('visibilitychange', onVisible) }
  }, [code, attempt])

  const submitPasscode = useCallback(async (passcode) => {
    const message = await joinWithPasscode(code, passcode)
    if (!message) setAttempt((n) => n + 1)
    return message
  }, [code])

  const board = state?.board ?? null
  const role = state?.viewer?.role ?? 'guest'
  const cards = useMemo(() => (state && loaded ? orderCards([...state.items.values()]) : []), [state, loaded])
  return { phase, board, role, cards, loaded, clock: clock.current, retry: () => setAttempt((n) => n + 1), submitPasscode }
}
