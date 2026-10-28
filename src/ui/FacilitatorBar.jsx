'use client'
// The owner's controls for the workflow: back, next (start), pause, +1 minute, lock notes, jump to any stage, settings.
export default function FacilitatorBar({ rt, onOpenSettings }) {
  const { retro, run, busy, error, list, step, stage, started } = rt
  const paused = retro.pausedAt != null
  const last = step >= list.length - 1
  const timed = stage.durationMs != null
  return (
    <div className="rt-fac" role="group" aria-label="Facilitator controls">
      <button type="button" className="bd-sbtn" disabled={busy || step === 0} onClick={() => run({ type: 'prev' })}>Back</button>
      {started
        ? <button type="button" className="bd-sbtn is-primary" disabled={busy || last} onClick={() => run({ type: 'next' })}>Next stage</button>
        : <button type="button" className="bd-sbtn is-primary" disabled={busy} onClick={() => run({ type: 'start' })}>Start</button>}
      {started && timed && (paused
        ? <button type="button" className="bd-sbtn" disabled={busy} onClick={() => run({ type: 'resume' })}>Resume</button>
        : <button type="button" className="bd-sbtn" disabled={busy} onClick={() => run({ type: 'pause' })}>Pause</button>)}
      {started && timed && <button type="button" className="bd-sbtn" disabled={busy} onClick={() => run({ type: 'extend', ms: 60_000 })}>+1 min</button>}
      <button type="button" className="bd-sbtn" aria-pressed={retro.editing} disabled={busy} onClick={() => run({ type: 'setEditing', value: !retro.editing })}>{retro.editing ? 'Lock notes' : 'Reopen notes'}</button>
      <label className="rt-jump">
        <span className="bd-vh">Jump to a stage</span>
        <select className="bd-sinput" value={step} disabled={busy} onChange={(e) => run({ type: 'goto', index: Number(e.target.value) })}>
          {list.map((s, i) => <option key={s.key} value={i}>{i + 1}. {s.label}</option>)}
        </select>
      </label>
      <button type="button" className="bd-sbtn" onClick={onOpenSettings}>Stages</button>
      <span className="bd-set-error" role="alert">{error}</span>
    </div>
  )
}
