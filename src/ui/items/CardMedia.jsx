// The GIF or photo of a card. Shared by the canvas card, the composer preview and the reveal slideshow. The link or data
// URL comes from a validated card; referrerPolicy keeps the board address out of the GIF host's logs, and the stored size
// (or a 4:3 guess) reserves the room before it loads, so nothing jumps.
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export function cardMedia(data) {
  const src = data?.gif || data?.image
  if (!src) return null
  const w = Number(data.mediaW)
  const h = Number(data.mediaH)
  return { src, kind: data.gif ? 'GIF' : 'Photo', w: w >= 1 ? w : 4, h: h >= 1 ? h : 3 }
}

export default function CardMedia({ data, className = 'bd-card-media', eager = false }) {
  const m = cardMedia(data)
  if (!m) return null
  return (
    <img
      className={className}
      src={m.src}
      alt={clip(data.message, 80) || m.kind}
      width={m.w}
      height={m.h}
      style={{ aspectRatio: `${m.w} / ${m.h}` }}
      referrerPolicy="no-referrer"
      loading={eager ? 'eager' : 'lazy'}
      draggable={false}
    />
  )
}
