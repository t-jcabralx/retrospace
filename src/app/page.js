import PageShell from '../ui/site/PageShell.jsx'
import Hero from '../ui/landing/Hero.jsx'
import BoardTypes from '../ui/landing/BoardTypes.jsx'
import WheelShowcase from '../ui/landing/WheelShowcase.jsx'
import Features from '../ui/landing/Features.jsx'
import HowItWorks from '../ui/landing/HowItWorks.jsx'
import ClosingCta from '../ui/landing/ClosingCta.jsx'
import '../ui/landing/landing.css'

export const metadata = { alternates: { canonical: '/' } }

// Static: the only per-visitor pieces (auth-aware buttons) are filled in by the client after load.
export default function Home() {
  return (
    <PageShell landing>
      <Hero />
      <BoardTypes />
      <WheelShowcase />
      <Features />
      <HowItWorks />
      <ClosingCta />
    </PageShell>
  )
}
