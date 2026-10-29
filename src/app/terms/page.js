import PageShell from '../../ui/site/PageShell.jsx'
import LegalPage from '../../ui/legal/LegalPage.jsx'
import { TERMS } from '../../ui/legal/legalData.js'

export const metadata = {
  title: 'Terms',
  description: 'The rules for using Retrospace.',
  alternates: { canonical: '/terms' },
}

export default function TermsPage() {
  return (
    <PageShell>
      <LegalPage title="Terms of use" intro="The short version: use it kindly, you own your content, and the people who run an event are responsible for it." sections={TERMS} other={{ href: '/privacy', label: 'Privacy' }} />
    </PageShell>
  )
}
