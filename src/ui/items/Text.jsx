export default function Text({ item, editing, readOnly }) {
  const text = item.data.text
  return (
    <div className="bd-textbox">
      {!editing && (text ? <p className="bd-body-text">{text}</p> : !readOnly && <p className="bd-placeholder">Text</p>)}
    </div>
  )
}
