import { NOTE_COLORS } from '../ops.js'

// 100x100 viewBox stretched to the item box; non-scaling strokes keep the outline a constant width.
const SHAPES = {
  rect: <rect x="1" y="1" width="98" height="98" rx="6" />,
  ellipse: <ellipse cx="50" cy="50" rx="49" ry="49" />,
  diamond: <polygon points="50,1 99,50 50,99 1,50" />,
}

export default function Shape({ item, editing }) {
  const { shape, text, color } = item.data
  const fill = NOTE_COLORS.includes(color) ? `var(--note-${color})` : 'var(--panel)'
  return (
    <div className="bd-shape">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" style={{ fill }}>
        {SHAPES[shape] ?? SHAPES.rect}
      </svg>
      {!editing && text && <p className="bd-body-text bd-shape-text">{text}</p>}
    </div>
  )
}
