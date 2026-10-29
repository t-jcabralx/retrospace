'use client'
// The Draw and History panels beside the wheel.
import { useEffect, useRef } from 'react'
import { ringPeople, ringPrizes, historyRows } from '../../lib/wheel.js'
import { toCsv } from '../../lib/csv.js'

const label = (z) => (z ? `${z.emoji ? `${z.emoji} ` : ''}${z.name}` : '')

// 1 Pick the prize, 2 Pick the winner. A step is done once its ring has stopped.
function StepBar({ stage }) {
  const steps = ['Pick the prize', 'Pick the winner']
  return (
    <ol className="ev-steps" aria-label="Steps of a draw">
      {steps.map((s, i) => {
        const state = stage > i ? 'done' : stage === i ? 'now' : 'next'
        return <li key={s} className={`is-${state}`} aria-current={state === 'now' ? 'step' : undefined}><span className="ev-stepno">{state === 'done' ? '✓' : i + 1}</span>{s}</li>
      })}
    </ol>
  )
}

export function Draw({ api, v, now, main, run, busy, error }) {
  const { wheel, runner } = api
  const { round, history } = wheel
  const people = ringPeople(wheel).length
  const prizes = ringPrizes(wheel).length
  const animating = Boolean(round.spin && now < round.spin.startAt + round.spin.durationMs)
  const stage = round.state === 'idle' ? 0 : round.state === 'prizeChosen' ? (v.prizeShown ? 1 : 0) : v.winnerShown ? 3 : 1
  const disabled = busy || animating || main?.off

  // Space does the main thing, unless the person is typing or pressing a button already.
  const ref = useRef(null)
  ref.current = { run, main, disabled, runner }
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space' || e.repeat || e.target.closest?.('input, textarea, select, button, a, [contenteditable], [role="button"]')) return
      const c = ref.current
      if (c.runner && c.main && !c.disabled) { e.preventDefault(); c.run(c.main.action) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  let message
  if (round.state === 'idle') message = history.length ? 'Ready for the next draw.' : !people || !prizes ? 'Add people and prizes to start.' : 'Ready. Spin to pick the first prize.'
  else if (round.state === 'prizeChosen') message = v.prizeShown ? `The prize is ${label(v.prize)}. Now pick who wins it.` : 'Spinning for the prize…'
  else message = v.winnerShown ? `${v.winner?.name ?? 'Someone'} wins ${label(v.prize)}` : 'Spinning for the winner…'

  return (
    <section className="ev-draw" aria-label="The draw">
      <StepBar stage={stage} />
      <div className={`ev-result${v.winnerShown ? ' is-win' : ''}`}>
        <p className="ev-message" role="status" aria-live="polite">{v.winnerShown ? <><span className="ev-cheer">🎉</span>{message}</> : message}</p>
        {v.prizeShown && !v.winnerShown && <p className="ev-chip" aria-hidden="true">{label(v.prize)}</p>}
      </div>

      {runner ? (
        <div className="ev-actions">
          {main && (
            <button type="button" className="ev-btn ev-btn--primary" disabled={disabled} onClick={() => run(main.action)} aria-describedby={main.why ? 'ev-why' : undefined}>
              {busy ? 'One moment…' : main.text}<kbd aria-hidden="true">Space</kbd>
            </button>
          )}
          {!main && animating && <button type="button" className="ev-btn ev-btn--primary" disabled>Spinning…</button>}
          {main?.why && <p id="ev-why" className="ev-hint">{main.why}</p>}
          {round.state === 'winnerChosen' && v.winnerShown && (
            <div className="ev-row">
              <button type="button" className="ev-btn" disabled={disabled} onClick={() => run('skip')}>Not here, skip</button>
              <button type="button" className="ev-btn" disabled={disabled} onClick={() => run('back')}>Spin the winner again</button>
            </div>
          )}
          {round.state === 'prizeChosen' && v.prizeShown && <div className="ev-row"><button type="button" className="ev-btn" disabled={disabled} onClick={() => run('back')}>Pick a different prize</button></div>}
          {round.state === 'idle' && history.length > 0 && <div className="ev-row"><button type="button" className="ev-btn ev-btn--quiet" disabled={disabled} onClick={() => run('undo')}>Undo the last draw</button></div>}
        </div>
      ) : (
        <p className="ev-wait">{round.state === 'idle' ? 'The host will start the draw. Watch the wheel.' : 'Watch the wheel. The host runs the draw.'}</p>
      )}
      {error && <p className="ev-error" role="alert">{error}</p>}
    </section>
  )
}

const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function History({ api }) {
  const { history } = api.wheel
  function download() {
    const blob = new Blob([toCsv(historyRows(api.wheel))], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(api.title || 'raffle').replace(/[^\w-]+/g, '-').slice(0, 40)}-draws.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  if (!history.length) return <p className="ev-empty">No draws yet. Each result you accept is listed here, newest first.</p>
  return (
    <section aria-label="Draw history">
      <ol className="ev-history" reversed>
        {[...history].reverse().map((h) => (
          <li key={h.n}><span className="ev-hn">#{h.n}</span><span className="ev-hw">{h.winner.name}</span><span className="ev-hp">{label(h.prize)}</span><time dateTime={new Date(h.at).toISOString()}>{time(h.at)}</time></li>
        ))}
      </ol>
      <button type="button" className="ev-btn" onClick={download}>Download as CSV</button>
    </section>
  )
}
