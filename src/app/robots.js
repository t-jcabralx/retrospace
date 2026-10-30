import { siteUrl } from '../lib/meta.js'
import { robotsFor } from '../lib/seo.js'

export default function robots() {
  return robotsFor(siteUrl().origin)
}
