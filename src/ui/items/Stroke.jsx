import { strokePath, STROKE_WIDTH } from '../../lib/stroke.js'
import { noteColor } from '../ops.js'

// A highlighter stroke: the path stretched over the item's box. The pen is see-through so the notes under it stay readable, and its
// width is in world pixels whatever the box size (non-scaling stroke, then scaled by the zoom through --bd-inv).
export default function Stroke({ item }) {
  const width = item.data.width ?? STROKE_WIDTH
  return (
    <svg className="bd-stroke" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d={strokePath(item.data.pts)} fill="none" stroke={noteColor(item.data.color)} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" style={{ strokeWidth: `calc(${width}px / var(--bd-inv, 1))` }} />
    </svg>
  )
}
