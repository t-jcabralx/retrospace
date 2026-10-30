import test from 'node:test'
import assert from 'node:assert/strict'
import { INDEXABLE, DISALLOW, robotsFor, sitemapFor, structuredData, jsonLd, verificationFrom } from '../src/lib/seo.js'
import { BOARD_ROBOTS, utilityPage } from '../src/lib/meta.js'

const ORIGIN = 'https://retrospace.example'

test('robots.txt lets every crawler in, keeps them out of the API and the dashboard, and points at the sitemap', () => {
  const r = robotsFor(ORIGIN)
  assert.deepEqual(r.rules, [{ userAgent: '*', allow: '/', disallow: ['/api/', '/boards'] }])
  assert.equal(r.sitemap, `${ORIGIN}/sitemap.xml`)
  assert.equal(r.host, ORIGIN)
  assert.ok(DISALLOW.every((p) => p.startsWith('/')))
})

test('the sitemap lists only the pages worth finding, with absolute addresses and no boards, accounts or API', () => {
  const when = new Date('2026-10-30T00:00:00Z')
  const map = sitemapFor(ORIGIN, when)
  assert.deepEqual(map.map((m) => m.url), [ORIGIN, `${ORIGIN}/guide`, `${ORIGIN}/privacy`, `${ORIGIN}/terms`])
  assert.ok(map.every((m) => m.lastModified === when && m.priority > 0 && m.priority <= 1 && m.changeFrequency))
  assert.equal(map[0].priority, 1)
  for (const m of map) assert.doesNotMatch(m.url, /\/b\/|\/boards|\/api|\/login|\/register|\/join/)
  assert.equal(INDEXABLE.length, map.length)
})

test('every page that is kept out of search by a noindex tag is also absent from the sitemap, and boards are noindex, nofollow', () => {
  const noindex = ['/login', '/register', '/join', '/boards']
  const listed = sitemapFor(ORIGIN).map((m) => new URL(m.url).pathname)
  for (const p of noindex) assert.ok(!listed.includes(p), p)
  assert.equal(utilityPage('Sign in', 'x').robots.index, false)
  assert.deepEqual(BOARD_ROBOTS, { index: false, follow: false })
})

test('structured data describes the site and the web app, and can never close its own script tag', () => {
  const data = structuredData(ORIGIN, { name: 'Retrospace', description: 'Live boards </script><script>alert(1)</script>' })
  assert.deepEqual(data.map((d) => d['@type']), ['WebSite', 'WebApplication'])
  assert.ok(data.every((d) => d['@context'] === 'https://schema.org' && d.url === ORIGIN))
  assert.equal(data[1].applicationCategory, 'BusinessApplication')
  assert.ok(data[1].featureList.length >= 4)
  const text = jsonLd(data)
  assert.ok(!text.includes('</script>') && !text.includes('<'), 'every "<" is escaped')
  assert.deepEqual(JSON.parse(text)[1].description, 'Live boards </script><script>alert(1)</script>', 'and it still reads back exactly')
})

test('search-console ownership tags come from the environment, with stray quotes removed, and are absent when not set', () => {
  assert.deepEqual(verificationFrom({}), {})
  assert.deepEqual(verificationFrom({ NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: ' "abc123" ' }), { google: 'abc123' })
  assert.deepEqual(verificationFrom({ NEXT_PUBLIC_BING_SITE_VERIFICATION: 'bing456' }), { other: { 'msvalidate.01': 'bing456' } })
  assert.deepEqual(verificationFrom({ NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: 'g', NEXT_PUBLIC_BING_SITE_VERIFICATION: 'b' }), { google: 'g', other: { 'msvalidate.01': 'b' } })
})
