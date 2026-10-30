// What search engines are told about the site. Pure, so it can be tested without a build.
// Only pages worth finding are listed: the landing page, the guide and the two legal pages. Sign-in, sign-up, join, the dashboard and every
// board are kept out of search by their own noindex tag (see lib/meta.js), so they are not listed here.
export const INDEXABLE = [
  { path: '/', priority: 1, changeFrequency: 'weekly' },
  { path: '/guide', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/terms', priority: 0.3, changeFrequency: 'yearly' },
]

// Crawlers have no business in the API or the signed-in dashboard. Board pages are not blocked here on purpose: a blocked page can
// never show its noindex tag, so it could still be listed by address alone. They carry noindex, nofollow themselves.
export const DISALLOW = ['/api/', '/boards']

export function robotsFor(origin) {
  return { rules: [{ userAgent: '*', allow: '/', disallow: DISALLOW }], sitemap: `${origin}/sitemap.xml`, host: origin }
}

export function sitemapFor(origin, lastModified = new Date()) {
  return INDEXABLE.map((p) => ({ url: p.path === '/' ? origin : `${origin}${p.path}`, lastModified, changeFrequency: p.changeFrequency, priority: p.priority }))
}

// What the product is, for search engines that show rich results (schema.org). Owner credit as in the footer and the terms.
export function structuredData(origin, { name, description }) {
  return [
    { '@context': 'https://schema.org', '@type': 'WebSite', name, url: origin, inLanguage: 'en' },
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name,
      url: origin,
      description,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Any (in a web browser)',
      browserRequirements: 'Requires JavaScript',
      inLanguage: 'en',
      featureList: [
        'Live team retrospectives with stages, voting and a shared timer',
        'Workshop boards with sticky notes, frames and connectors',
        'Celebration boards with cards, GIFs and shout-outs',
        'Event raffle prize wheel with a two-step draw',
        'Join with a six-character code, no account needed for guests',
      ],
      creator: { '@type': 'Person', name: 'Jason Cabral' },
    },
  ]
}

// JSON placed inside a <script> tag: "<" is written as < so the content can never close the tag.
export const jsonLd = (data) => JSON.stringify(data).replace(/</g, '\\u003c')

// Google Search Console / Bing Webmaster ownership checks, from the environment (the value of the meta tag's content).
export function verificationFrom(env = process.env) {
  const g = (env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ?? '').trim().replace(/^["']|["']$/g, '')
  const b = (env.NEXT_PUBLIC_BING_SITE_VERIFICATION ?? '').trim().replace(/^["']|["']$/g, '')
  return { ...(g && { google: g }), ...(b && { other: { 'msvalidate.01': b } }) }
}
