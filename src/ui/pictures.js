// Browser-only: loads a picture once to learn its size and to prove the link really is one. -> { w, h } or null.
export function loadPicture(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const img = new Image()
    img.referrerPolicy = 'no-referrer'
    const done = (v) => { clearTimeout(timer); img.onload = img.onerror = null; resolve(v) }
    const timer = setTimeout(() => done(null), timeoutMs)
    img.onload = () => done(img.naturalWidth >= 1 && img.naturalHeight >= 1 ? { w: Math.min(4000, img.naturalWidth), h: Math.min(4000, img.naturalHeight) } : null)
    img.onerror = () => done(null)
    img.src = url
  })
}
