'use client'
// The handle that moves a floating panel (see useDragPanel): drag it, or use the arrow keys when it has focus; Home or a double tap
// puts the panel back.
export default function DragGrip({ grip, dragging, label = 'Move this panel' }) {
  return (
    <button type="button" className={`bd-vote-grip${dragging ? ' is-dragging' : ''}`} aria-label={`${label}. Use the arrow keys, or Home to put it back`} title="Drag to move" {...grip}>
      <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true" focusable="false">
        {[2, 8, 14].flatMap((y) => [2, 8].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" fill="currentColor" />))}
      </svg>
    </button>
  )
}
