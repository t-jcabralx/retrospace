// The body of a frame is click-through (see board.css) so items inside stay easy to marquee; the title bar is its grip.
export default function Frame({ item, editing }) {
  return (
    <div className="bd-frame-box">
      <div className="bd-frame-title">{!editing && (item.data.title || <span className="bd-placeholder">Untitled</span>)}</div>
    </div>
  )
}
