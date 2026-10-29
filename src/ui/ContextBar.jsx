'use client'
import { NOTE_COLORS, SHAPE_KINDS } from './ops.js'

const SHAPE_ICONS = {
  rect: <rect x="4" y="6" width="16" height="12" rx="2" />,
  ellipse: <ellipse cx="12" cy="12" rx="8" ry="6" />,
  diamond: <path d="M12 3l9 9-9 9-9-9z" />,
}

// Colour and shape pickers. They change the selection and also set what the next note/shape is created with.
export default function ContextBar({ colors, shapes, color, shape, onColor, onShape, onDelete, deleteCount = 0 }) {
  if (!colors && !shapes && !onDelete) return null
  return (
    <div className="bd-context" role="toolbar" aria-label="Item style">
      {shapes && SHAPE_KINDS.map((s) => (
        <button key={s} type="button" className={`bd-chip${shape === s ? ' is-active' : ''}`} aria-label={s} title={s} aria-pressed={shape === s} onClick={() => onShape(s)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">{SHAPE_ICONS[s]}</svg>
        </button>
      ))}
      {shapes && colors && <span className="bd-context-sep" />}
      {colors && (shapes ? [...NOTE_COLORS, 'none'] : NOTE_COLORS).map((c) => (
        <button
          key={c}
          type="button"
          className={`bd-swatch${color === c ? ' is-active' : ''}`}
          aria-label={c === 'none' ? 'No colour' : `Colour ${c}`}
          title={c === 'none' ? 'No colour' : c}
          aria-pressed={color === c}
          onClick={() => onColor(c)}
        >
          <span className="bd-swatch-dot" style={{ background: c === 'none' ? 'var(--panel)' : `var(--note-${c})` }} />
        </button>
      ))}
      {onDelete && (
        <>
          {(colors || shapes) && <span className="bd-context-sep" />}
          <button type="button" className="bd-chip bd-chip--danger" aria-label={deleteCount > 1 ? `Delete ${deleteCount} items` : 'Delete'} title="Delete" onClick={onDelete}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" /></svg>
            <span className="bd-chip-text">Delete</span>
          </button>
        </>
      )}
    </div>
  )
}
