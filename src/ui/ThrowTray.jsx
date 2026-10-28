'use client'
// Bottom-centre row of emoji to throw. Choosing one ARMS it (aria-pressed); the next click on a note or the canvas throws
// it (see useThrows). Arrow keys move along the row.
import { useRef } from 'react'
import './settings.css'

export default function ThrowTray({ emojis, armed, onArm, notice }) {
  const row = useRef(null)
  const move = (e) => {
    const buttons = [...row.current.querySelectorAll('button')]
    const i = buttons.indexOf(document.activeElement)
    const to = { ArrowRight: (i + 1) % buttons.length, ArrowLeft: (i + buttons.length - 1) % buttons.length, Home: 0, End: buttons.length - 1 }[e.key]
    if (to === undefined || i < 0) return
    e.preventDefault()
    buttons[to].focus()
  }
  return (
    <div className="bd-tray">
      <div ref={row} className="bd-tray-row" role="toolbar" aria-label="Throw an emoji" onKeyDown={move}>
        {emojis.map((e, i) => (
          <button
            key={e}
            type="button"
            className={`bd-tray-btn${armed === e ? ' is-armed' : ''}`}
            aria-label={`Throw ${e}`}
            aria-pressed={armed === e}
            tabIndex={armed ? (armed === e ? 0 : -1) : i === 0 ? 0 : -1}
            onClick={() => onArm(e)}
          >
            <span aria-hidden="true">{e}</span>
          </button>
        ))}
      </div>
      <p className={`bd-tray-hint${armed || notice ? ' is-on' : ''}`} role="status">
        {notice || (armed ? `${armed} ready. Click a note to throw — Esc to cancel` : '')}
      </p>
    </div>
  )
}
