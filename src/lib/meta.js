// Page metadata for the pages that are not the landing page: the Open Graph and Twitter titles match the <title>
// ("Sign in · Retrospace"), and the page is kept out of search results. Pure.
const SITE = 'Retrospace'

export function utilityPage(title, description) {
  const full = `${title} · ${SITE}`
  return {
    title,
    description,
    robots: { index: false },
    openGraph: { title: full, description, siteName: SITE, type: 'website', locale: 'en_US' },
    twitter: { card: 'summary', title: full, description },
  }
}

// Board URLs carry the access code, so they are never indexed or followed.
export const BOARD_ROBOTS = { index: false, follow: false }

// NEXT_PUBLIC_SITE_URL when it is a valid URL, else the local dev address (only used to resolve metadata URLs).
export function siteUrl(env = process.env.NEXT_PUBLIC_SITE_URL) {
  try { return new URL(env || 'http://localhost:3000') } catch { return new URL('http://localhost:3000') }
}
