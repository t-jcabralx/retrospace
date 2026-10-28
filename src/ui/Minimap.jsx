'use client'
import { useRef } from 'react'
import { boundsOf, screenToWorld } from './geometry.js'
import { noteColor } from './ops.js'

const W = 168
const H = 112
const PAD = 60

// World bounds of everything plus the viewport, grown to the minimap's aspect ratio so the mapping is a plain
// scale (no letterboxing to account for when converting a click back to world coordinates).
function frameOf(items, vp) {
  const b = boundsOf([...items, { x: vp.x, y: vp.y, w: vp.w, h: vp.h }])
  let { x, y, w, h } = { x: b.x - PAD, y: b.y - PAD, w: b.w + PAD * 2, h: b.h + PAD * 2 }
  const ratio = W / H
  if (w / h < ratio) { const nw = h * ratio; x -= (nw - w) / 2; w = nw } else { const nh = w / ratio; y -= (nh - h) / 2; h = nh }
  return { x, y, w, h }
}

export default function Minimap({ items, view, size, onMove }) {
  const boxRef = useRef(null)
  if (!size.w) return null
  const boxes = items.filter((i) => i.kind !== 'connector')
  const tl = screenToWorld({ x: 0, y: 0 }, view)
  const vp = { x: tl.x, y: tl.y, w: size.w / view.scale, h: size.h / view.scale }
  const f = frameOf(boxes, vp)

  const move = (e) => {
    const r = boxRef.current.getBoundingClientRect()
    onMove({ x: f.x + ((e.clientX - r.left) / r.width) * f.w, y: f.y + ((e.clientY - r.top) / r.height) * f.h })
  }

  return (
    <div
      ref={boxRef}
      className="bd-minimap"
      role="presentation"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e) }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e) }}
    >
      <svg viewBox={`${f.x} ${f.y} ${f.w} ${f.h}`} width={W} height={H} role="img" aria-label="Minimap of the board; click or drag to move the view">
        {boxes.map((i) => (
          <rect
            key={i.id}
            x={i.x} y={i.y} width={i.w} height={i.h}
            className={`bd-mm-item bd-mm-${i.kind}`}
            style={i.kind === 'note' || i.kind === 'card' ? { fill: noteColor(i.data.color) } : undefined}
          />
        ))}
        <rect className="bd-mm-view" x={vp.x} y={vp.y} width={vp.w} height={vp.h} />
      </svg>
    </div>
  )
}
