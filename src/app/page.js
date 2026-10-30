import PageShell from '../ui/site/PageShell.jsx'
import Hero from '../ui/landing/Hero.jsx'
import BoardTypes from '../ui/landing/BoardTypes.jsx'
import WheelShowcase from '../ui/landing/WheelShowcase.jsx'
import Features from '../ui/landing/Features.jsx'
import HowItWorks from '../ui/landing/HowItWorks.jsx'
import ClosingCta from '../ui/landing/ClosingCta.jsx'
import '../ui/landing/landing.css'
import { siteUrl } from '../lib/meta.js'
import { structuredData, jsonLd } from '../lib/seo.js'
import { SITE_NAME, SITE_DESCRIPTION } from '../lib/siteText.js'

export const metadata = { alternates: { canonical: '/' } }

// Static: the only per-visitor pieces (auth-aware buttons) are filled in by the client after load.
export default function Home() {
  return (
    <PageShell landing>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structuredData(siteUrl().origin, { name: SITE_NAME, description: SITE_DESCRIPTION })) }} />
      <Hero />
      <BoardTypes />
      <WheelShowcase />
      <Features />
      <HowItWorks />
      <ClosingCta />
    </PageShell>
  )
}
