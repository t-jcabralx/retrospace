'use client'
// The wheel's data source. EventScreen only sees the shape below.
//   api = { wheel, runner, owner, joined, now(), act(action), saveSetup(setup), code, title }
//   act / saveSetup -> Promise<{ ok: true } | { ok: false, error }>
import { useCallback, useEffect, useMemo, useState } from 'react'
import { isRunner } from '../../lib/wheel.js'
import { useOwnerActions } from '../useOwnerActions.js'

const post = async (code, body) => {
  try {
    const res = await fetch(`/api/boards/${code}/wheel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    return res.ok ? { ok: true, data } : { ok: false, error: data.error || 'Could not reach the server. Try again.' }
  } catch {
    return { ok: false, error: 'Could not reach the server. Try again.' }
  }
}

// A board stored on our server: reads the wheel from the shared board state, writes through the routes.
export function useServerWheel(ctl) {
  const { patchBoard } = useOwnerActions(ctl)
  const wheel = ctl.board.wheel
  const act = useCallback(async (action) => {
    const r = await post(ctl.code, { action, cid: ctl.syncCid() })
    if (r.ok && r.data?.board) ctl.applyBoard(r.data.board)
    return r.ok ? { ok: true } : r
  }, [ctl])
  const saveSetup = useCallback(async (setup) => {
    const r = await patchBoard({ wheel: setup })
    return r.ok ? { ok: true } : { ok: false, error: r.error || 'Could not save' }
  }, [patchBoard])
  const joined = useMemo(() => (ctl.state?.participants ?? []).filter((p) => p.uid && p.name).map((p) => ({ uid: p.uid, name: p.name, mine: p.uid === ctl.uid })), [ctl.state?.participants, ctl.uid])
  return {
    wheel, code: ctl.code, title: ctl.board.title,
    runner: isRunner(wheel, ctl.uid, ctl.isOwner), owner: ctl.isOwner, joined,
    now: () => ctl.clock.now(), act, saveSetup,
  }
}

// prefers-reduced-motion, live.
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const q = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!q) return undefined
    const sync = () => setReduced(q.matches)
    sync()
    q.addEventListener?.('change', sync)
    return () => q.removeEventListener?.('change', sync)
  }, [])
  return reduced
}

// The time to draw the wheel at. It runs every frame while a spin is under way and settles to one value otherwise.
export function useSpinClock(wheel, getNow) {
  const [now, setNow] = useState(() => getNow())
  const spin = wheel.round.spin
  const spinId = spin?.id ?? 0
  const end = spin ? spin.startAt + spin.durationMs : 0
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const t = getNow()
      setNow(t)
      if (t < end + 60) raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [spinId, end, getNow])
  return now
}
