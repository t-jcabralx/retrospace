'use client'
// Under the top bar: the stage name, "Step n of m", progress dots and the big countdown. Stage changes are announced politely.
import { useEffect, useRef, useState } from 'react'
import { useTimerState } from './useTimerState.js'
import { formatClock } from './timer.js'
import { timerState } from '../lib/retro.js'

export default function StageHeader({ ctl, rt, children }) {
  const { retro, stage, step, list, started } = rt
  const { timer, ms, phase } = useTimerState(ctl)
  const [said, setSaid] = useState('')
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    setSaid(`Step ${step + 1} of ${list.length}: ${stage.label}`)
  }, [step, stage?.key]) // eslint-disable-line react-hooks/exhaustive-deps -- only a change of stage is announced
  const paused = retro.pausedAt != null
  const t = timerState(retro, Date.now())
  let clock = null
  if (stage.durationMs != null && started) clock = paused ? formatClock(t.remainingMs ?? 0) : timer && phase !== 'gone' ? (phase === 'over' ? 'Time’s up' : formatClock(ms)) : null
  return (
    <div className="rt-head">
      <div className="rt-title">
        <span className="rt-step">Step {step + 1} of {list.length}</span>
        <h2 className="rt-stage">{stage.label}</h2>
        <ol className="rt-dots" aria-hidden="true">{list.map((s, i) => <li key={s.key} className={i < step ? 'is-done' : i === step ? 'is-now' : ''} />)}</ol>
      </div>
      {!started && <span className="rt-chip">Not started</span>}
      {clock && <span className={`rt-clock${paused ? ' is-paused' : ''}${!paused && (phase === 'urgent' || phase === 'over') ? ' is-urgent' : ''}`} aria-hidden="true">{clock}{paused ? ' (paused)' : ''}</span>}
      {children}
      <span className="bd-vh" role="status" aria-live="polite">{said}</span>
    </div>
  )
}
