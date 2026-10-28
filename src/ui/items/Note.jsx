import { noteColor } from '../ops.js'

export default function Note({ item, editing, readOnly }) {
  const text = item.data.text
  return (
    <div className="bd-note" style={{ background: noteColor(item.data.color) }}>
      {!editing && (text ? <p className="bd-body-text">{text}</p> : !readOnly && <p className="bd-placeholder">Double-click to write</p>)}
    </div>
  )
}
