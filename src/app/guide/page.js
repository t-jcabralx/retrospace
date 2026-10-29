import PageShell from '../../ui/site/PageShell.jsx'
import Guide from '../../ui/guide/Guide.jsx'

export const metadata = {
  title: 'User guide',
  description: 'How to create a Retrospace board, join with a code, run the Retro stages step by step, and share an AI summary.',
  alternates: { canonical: '/guide' },
}

export default function GuidePage() {
  return (
    <PageShell>
      <Guide />
    </PageShell>
  )
}
