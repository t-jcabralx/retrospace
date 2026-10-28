'use client'
// The shared countdown in the top bar, for everyone, and (owner only) a small button beside it that opens quick controls.
// The ticking digits are hidden from assistive tech; a separate role="timer" region is updated only at 1:00, 0:30,
// 0:10 and 0:00 so a screen reader is not read a number every second. The last ten seconds change colour AND icon, and
// "Time's up" stays for 30 seconds after zero, then the timer disappears. All of it counts to the server's clock.
import { useEffect, useId, useRef, useState } from 'react'
import { TimerIcon, AlarmIcon } from './icons.jsx'
import TimerControls from './TimerControls.jsx'
import { useOwnerActions } from './useOwnerActions.js'
import { useTimerState } from './useTimerState.js'
import { formatClock, announceBucket, announcementText } from './timer.js'
import './settings.css'

// The polite sentence, set when the timer first shows, when it is changed, and at each threshold.
function useSpoken(timer, ms, phase) {
  const [said, setSaid] = useState('')
  const last = useRef({ end: null, bucket: undefined })
  const bucket = timer && phase !== 'gone' ? announceBucket(ms) : undefined
  const end = timer?.endsAt ?? null
  useEffect(() => {
    const l = last.current
    if (bucket === undefined) { l.end = null; l.bucket = undefined; setSaid(''); return }
    if (l.end !== end) {
      const changed = l.end !== null
      l.end = end
      l.bucket = bucket
      setSaid(bucket !== null ? announcementText(bucket) : `${changed ? 'Timer changed' : 'Timer started'}: ${formatClock(ms)} left`)
    } else if (bucket !== l.bucket) {
      l.bucket = bucket
      if (bucket !== null) setSaid(announcementText(bucket))
    }
  }, [bucket, end]) // eslint-disable-line react-hooks/exhaustive-deps -- ms is only read when the timer first shows
  return said
}

function QuickControls({ ctl }) {
  const { patchBoard } = useOwnerActions(ctl)
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  const button = useRef(null)
  const panelId = useId()
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!root.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])
  return (
    <div
      ref={root}
      className="bd-timer-quick"
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setOpen(false); button.current?.focus() } }}
    >
      <button
        ref={button}
        type="button"
        className="bd-iconbtn"
        aria-label="Timer controls"
        title="Timer"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <TimerIcon />
      </button>
      {open && <div id={panelId} className="bd-timer-pop" role="group" aria-label="Timer controls"><TimerControls ctl={ctl} patchBoard={patchBoard} /></div>}
    </div>
  )
}

export default function Timer({ ctl }) {
  const { timer, ms, phase } = useTimerState(ctl)
  const said = useSpoken(timer, ms, phase)
  const shown = timer && phase !== 'gone'
  if (!shown && !ctl.isOwner) return null
  const Icon = phase === 'urgent' || phase === 'over' ? AlarmIcon : TimerIcon
  return (
    <div className="bd-timer-wrap">
      {shown && (
        <span className={`bd-timer is-${phase}`}>
          <Icon width={16} height={16} aria-hidden="true" />
          <span className="bd-timer-text" aria-hidden="true">{phase === 'over' ? 'Time’s up' : formatClock(ms)}</span>
        </span>
      )}
      <span role="timer" aria-label="Timer" aria-live="polite" aria-atomic="true" className="bd-vh">{said}</span>
      {ctl.isOwner && <QuickControls ctl={ctl} />}
    </div>
  )
}
