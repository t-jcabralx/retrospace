'use client'
// Live preview, Shuffle and one labelled choice group per avatar part. Each group is a radio group (arrow keys move
// and select, Tab enters and leaves it), so the 44 little previews cost a keyboard user five Tab stops, not forty-four.
import { useId, useRef, useState } from 'react'
import Avatar, { EXTRA_NAMES } from './Avatar.jsx'
import { AVATAR_PARTS, randomAvatar } from '../lib/persona.js'
import { ShuffleIcon } from './icons.jsx'

const PARTS = [
  { key: 'bg', label: 'Background' },
  { key: 'body', label: 'Body' },
  { key: 'eyes', label: 'Eyes' },
  { key: 'mouth', label: 'Mouth' },
  { key: 'extra', label: 'Extra' },
]

function PartChooser({ part, avatar, onPick }) {
  const n = AVATAR_PARTS[part.key]
  const refs = useRef([])
  const labelId = useId()
  const current = avatar[part.key]

  function onKeyDown(e) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    let next = null
    if (step) next = (current + step + n) % n
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    if (next === null) return
    e.preventDefault()
    onPick(next)
    refs.current[next]?.focus()
  }

  return (
    <div className="pa-part">
      <span id={labelId} className="pa-part-label">{part.label}</span>
      <div role="radiogroup" aria-labelledby={labelId} className="pa-part-options" onKeyDown={onKeyDown}>
        {Array.from({ length: n }, (_, i) => (
          <button
            key={i}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={i === current}
            aria-label={part.key === 'extra' ? `Extra: ${EXTRA_NAMES[i]}` : `${part.label} ${i + 1} of ${n}`}
            tabIndex={i === current ? 0 : -1}
            className={`pa-swatch${i === current ? ' is-on' : ''}`}
            onClick={() => onPick(i)}
          >
            <Avatar avatar={{ ...avatar, [part.key]: i }} size={38} decorative />
          </button>
        ))}
      </div>
    </div>
  )
}

// avatar / onChange: the controlled avatar. onShuffle replaces what Shuffle does; showShuffle={false} hides the button
// when the caller has its own (the chooser's re-rolls the name too).
export default function AvatarPicker({ avatar, name = '', onChange, onShuffle, shuffleLabel = 'Shuffle avatar', showPreview = true, showShuffle = true, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()

  return (
    <div className="pa-picker">
      <div className="pa-picker-bar">
        {showPreview && <Avatar avatar={avatar} name={name} size={84} />}
        <div className="pa-picker-actions">
          {showShuffle && (
            <button type="button" className="pa-btn" aria-label={shuffleLabel} onClick={() => (onShuffle ? onShuffle() : onChange(randomAvatar()))}>
              <ShuffleIcon /> Shuffle
            </button>
          )}
          <button type="button" className="pa-btn pa-btn-quiet" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide options' : 'Customize avatar'}
          </button>
        </div>
      </div>
      <div id={panelId} className="pa-parts">
        {open && PARTS.map((part) => <PartChooser key={part.key} part={part} avatar={avatar} onPick={(i) => onChange({ ...avatar, [part.key]: i })} />)}
      </div>
    </div>
  )
}
