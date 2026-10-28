// Browser-only: turns an image File into a data URL small enough for an image item.
const MAX_SIDE = 1200
const MAX_CHARS = 250 * 1024 // the server caps an image src at 400 KB; aim well below it (the board's media budget is 3 MB)
const QUALITIES = [0.85, 0.7, 0.55, 0.4]

export class ImageTooLarge extends Error {}

// webp where the browser can encode it, otherwise jpeg (alpha flattened onto white), otherwise png.
function pickType(canvas) {
  if (canvas.toDataURL('image/webp').startsWith('data:image/webp')) return 'image/webp'
  if (canvas.toDataURL('image/jpeg').startsWith('data:image/jpeg')) return 'image/jpeg'
  return 'image/png'
}

function render(bitmap, scale, type) {
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h) }
  ctx.drawImage(bitmap, 0, 0, w, h)
  return { canvas, w, h }
}

// -> { src, w, h } (w/h are the encoded pixel size). Shrinks quality, then size, until it fits. `maxSide`: the longest side to start from; `maxChars`: the longest data URL accepted.
export async function fileToImage(file, { maxSide = MAX_SIDE, maxChars = MAX_CHARS } = {}) {
  const bitmap = await createImageBitmap(file)
  try {
    let scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const type = pickType(document.createElement('canvas'))
    for (let round = 0; round < 8; round++) {
      const { canvas, w, h } = render(bitmap, scale, type)
      for (const q of type === 'image/png' ? [undefined] : QUALITIES) {
        const src = canvas.toDataURL(type, q)
        if (src.length <= maxChars) return { src, w, h }
      }
      scale *= 0.75
    }
    throw new ImageTooLarge('Image too large')
  } finally {
    bitmap.close?.()
  }
}
