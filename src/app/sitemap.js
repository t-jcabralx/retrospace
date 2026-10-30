import { siteUrl } from '../lib/meta.js'
import { sitemapFor } from '../lib/seo.js'

export default function sitemap() {
  return sitemapFor(siteUrl().origin)
}
