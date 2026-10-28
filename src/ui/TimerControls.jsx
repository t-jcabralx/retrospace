'use client'
// Start, extend and stop the shared timer. Used in the settings panel and in the small popover next to the timer.
// Starting sets endsAt on the server's clock (ctl.clock), so every screen counts down to the same moment.
import { useId, useState } from 'react'
import { SaveNote } from './settings/controls.jsx'
import { useSetting } from './settings/useSetting.js'
import { useTimerState } from './useTimerState.js'

const PRESETS = [1, 3, 5, 10]
const MIN_MINUTES = 1
const MAX_MINUTES = 240
const MIN = 60_000

export default function TimerControls({ ctl, patchBoard }) {
  const id = useId()
  const setting = useSetting(patchBoard)
  const { timer, phase } = useTimerState(ctl)
  const [minutes, setMinutes] = useState('')
  const [problem, setProblem] = useState('')
  const running = timer && phase !== 'gone'

  const start = (mins) => {
    const ms = mins * MIN
    return setting.save({ timer: { endsAt: Math.round(ctl.clock.now() + ms), durationMs: ms } })
  }
  const custom = async (e) => {
    e.preventDefault()
    const n = Number(minutes)
    if (!Number.isInteger(n) || n < MIN_MINUTES || n > MAX_MINUTES) { setProblem(`Enter whole minutes from ${MIN_MINUTES} to ${MAX_MINUTES}.`); return }
    setProblem('')
    if (await start(n)) setMinutes('')
  }

  return (
    <div className="bd-tc">
      <div role="group" aria-label="Start a timer" className="bd-tc-presets">
        {PRESETS.map((m) => (
          <button key={m} type="button" className="bd-sbtn" disabled={setting.busy} onClick={() => start(m)}>{m} min</button>
        ))}
      </div>
      <form className="bd-tc-custom" onSubmit={custom} noValidate>
        <label htmlFor={`${id}-m`} className="bd-set-label">Custom minutes</label>
        <div className="bd-tc-customrow">
          <input
            id={`${id}-m`}
            className="bd-sinput"
            type="number"
            inputMode="numeric"
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            step="1"
            placeholder="1 to 240"
            value={minutes}
            disabled={setting.busy}
            aria-invalid={problem ? 'true' : undefined}
            aria-describedby={`${id}-e`}
            onChange={(e) => { setMinutes(e.target.value); setProblem('') }}
          />
          <button type="submit" className="bd-sbtn is-primary" disabled={setting.busy || !minutes}>Start</button>
        </div>
        <p id={`${id}-e`} className="bd-set-error" role="alert">{problem}</p>
      </form>
      {running && (
        <div className="bd-set-actions">
          <button type="button" className="bd-sbtn" disabled={setting.busy} onClick={() => setting.save({ timer: { endsAt: timer.endsAt + MIN, durationMs: timer.durationMs + MIN } })}>+1 min</button>
          <button type="button" className="bd-sbtn is-danger" disabled={setting.busy} onClick={() => setting.save({ timer: null })}>Stop timer</button>
        </div>
      )}
      <SaveNote setting={setting} />
    </div>
  )
}
