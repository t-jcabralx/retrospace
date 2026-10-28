// Pure: the op that posts a card. The slot comes from the shortest column of the masonry grid and the height from an
// estimate of the text and picture (layout.js); the data is exactly what the server's card rule takes.
import { addOp, nextZ } from './ops.js'
import { nextCardSlot, estimateCardHeight, CARD_W } from '../lib/layout.js'

// media: null | { type: 'gif' | 'photo', src, w?, h? }  (src is an https URL for a GIF, a data URL for a photo)
export function buildCardOp(items, { message, signer, color, media = null }, id) {
  const data = { message: message.trim(), signer: signer.trim(), color }
  const ratio = media?.w >= 1 && media?.h >= 1 ? media.w / media.h : undefined
  if (media) {
    data[media.type === 'photo' ? 'image' : 'gif'] = media.src
    if (ratio) { data.mediaW = Math.round(media.w); data.mediaH = Math.round(media.h) }
  }
  const slot = nextCardSlot(items)
  const h = estimateCardHeight({ message: data.message, hasMedia: Boolean(media), mediaRatio: ratio, width: CARD_W })
  return addOp('card', { x: slot.x, y: slot.y, w: CARD_W, h }, data, nextZ(items, 'card'), id)
}
