import PageShell from '../../ui/site/PageShell.jsx'
import LegalPage from '../../ui/legal/LegalPage.jsx'
import { PRIVACY } from '../../ui/legal/legalData.js'

export const metadata = {
  title: 'Privacy',
  description: 'What Retrospace keeps, who else handles it, how long it stays and how to delete it.',
  alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
  return (
    <PageShell>
      <LegalPage title="Privacy" intro="In plain words: what we keep when you use Retrospace, who helps us run it, and what you can do about it." sections={PRIVACY} other={{ href: '/terms', label: 'Terms' }} />
    </PageShell>
  )
}
