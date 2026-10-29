'use client'
// The Event board: a two-ring prize wheel with the draw, the setup and the history beside it. `api` comes from hooks.js.
import { useEffect, useState } from 'react'
import { ringPeople, ringPrizes } from '../../lib/wheel.js'
import { view } from './timeline.js'
import { useReducedMotion, useSpinClock } from './hooks.js'
import WheelSvg from './WheelSvg.jsx'
import Setup from './Setup.jsx'
import { Draw, History } from './Panels.jsx'
import { copyText } from '../boards/CopyButton.jsx'
import './event.css'

// A small button that copies the board code and says so.
function CopyCode({ code }) {
  const [done, setDone] = useState(null)
  useEffect(() => { if (done === null) return undefined; const t = setTimeout(() => setDone(null), 2000); return () => clearTimeout(t) }, [done])
  return (
    <>
      <button type="button" className="ev-btn ev-btn--quiet ev-copy" onClick={async () => setDone(await copyText(code))} aria-label="Copy the board code">{done === true ? 'Copied' : done === false ? 'Copy failed' : 'Copy'}</button>
      <span className="ev-vh" role="status">{done === true ? 'Board code copied' : ''}</span>
    </>
  )
}

export default function EventScreen({ api }) {
  const { wheel } = api
  const reduced = useReducedMotion()
  const now = useSpinClock(wheel, api.now)
  const v = view(wheel, now, reduced)
  const people = ringPeople(wheel)
  const prizes = ringPrizes(wheel)
  const empty = wheel.participants.length === 0 && wheel.prizes.length === 0
  const [tab, setTab] = useState(() => (api.owner && empty ? 'setup' : 'draw'))
  const [present, setPresent] = useState(false)
  const shown = present ? 'draw' : tab

  useEffect(() => {
    if (!present) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setPresent(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [present])

  const hub = v.winnerShown ? { text: '🎉', big: true } : v.prizeShown ? { text: v.prize?.emoji || '🎁', big: true } : { text: '🎡', big: true }
  const tabs = [['draw', 'Draw'], ...(api.owner ? [['setup', 'Setup']] : []), ['history', `History${wheel.history.length ? ` (${wheel.history.length})` : ''}`]]

  return (
    <div className={`ev${present ? ' is-present' : ''}`}>
      <div className="ev-stage">
        <WheelSvg people={people} prizes={prizes} v={v} hub={hub} />
        <p className="ev-legend" aria-hidden="true"><span><i className="ev-dot ev-dot--people" />Outer ring: people</span><span><i className="ev-dot ev-dot--prizes" />Inner ring: prizes</span></p>
      </div>
      <aside className="ev-side">
        <div className="ev-bar">
          <div role="tablist" aria-label="Wheel panels" className="ev-tabs">
            {tabs.map(([key, text]) => (
              <button key={key} type="button" role="tab" id={`ev-tab-${key}`} aria-selected={shown === key} aria-controls={`ev-pan-${key}`} className={shown === key ? 'is-on' : ''} onClick={() => setTab(key)}>{text}</button>
            ))}
          </div>
          <button type="button" className="ev-btn ev-btn--quiet ev-present" aria-pressed={present} onClick={() => setPresent((p) => !p)}>{present ? 'Exit' : 'Present'}</button>
        </div>
        {api.owner && api.code && !present && (
          <p className="ev-share">Guests join with the code <strong>{api.code}</strong> <CopyCode code={api.code} /></p>
        )}
        <div role="tabpanel" id={`ev-pan-${shown}`} aria-labelledby={`ev-tab-${shown}`} className="ev-panel">
          {shown === 'draw' && <Draw api={api} v={v} now={now} />}
          {shown === 'setup' && <Setup api={api} />}
          {shown === 'history' && <History api={api} />}
        </div>
      </aside>
    </div>
  )
}
