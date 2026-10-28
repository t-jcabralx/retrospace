'use client'
import { Section } from './controls.jsx'
import TimerControls from '../TimerControls.jsx'
import { useTimerState } from '../useTimerState.js'
import { formatClock } from '../timer.js'

export default function TimerSection({ ctl, patchBoard }) {
  const { phase, ms } = useTimerState(ctl)
  const status = phase === 'running' || phase === 'urgent' ? `Running: ${formatClock(ms)} left` : phase === 'over' ? 'Time is up' : 'No timer is running'
  return (
    <Section title="Timer" hint="Everyone on the board sees the same countdown, even if their clock is wrong.">
      <p className="bd-set-desc" role="status">{status}</p>
      <TimerControls ctl={ctl} patchBoard={patchBoard} />
    </Section>
  )
}
