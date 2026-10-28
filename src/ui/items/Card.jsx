import { noteColor } from '../ops.js'
import CardMedia from './CardMedia.jsx'

// A celebration card: the message, '— signer' and an optional GIF or photo below. Everything is React text, so nothing in a
// card is ever treated as markup. While the author edits the message, the editor (ItemView) covers the card.
export default function Card({ item, editing }) {
  const { message, signer, color } = item.data
  return (
    <div className="bd-card" style={{ background: noteColor(color) }}>
      {!editing && <p className="bd-card-msg">{message}</p>}
      <p className="bd-card-sig"><span aria-hidden="true">— </span>{signer}</p>
      <CardMedia data={item.data} />
    </div>
  )
}
