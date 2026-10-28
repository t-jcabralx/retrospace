// Pure helpers for the share section of the settings panel.
export const boardLink = (origin, code) => `${String(origin).replace(/\/+$/, '')}/b/${code}`
// The recipient's page of a celebration board: a countdown until the reveal time, then the slideshow.
export const revealLink = (origin, code) => `${boardLink(origin, code)}/reveal`

// A mail client opens with the subject and body filled in. The title goes through encodeURIComponent (and loses any line
// break first, so it cannot add a header), and so does the body.
export function mailtoHref(title, code, link) {
  const clean = String(title ?? '').replace(/\s+/g, ' ').trim()
  const subject = encodeURIComponent(`Join "${clean}" on Retrospace`)
  const body = encodeURIComponent(`Join with code ${code} or open ${link}`)
  return `mailto:?subject=${subject}&body=${body}`
}
