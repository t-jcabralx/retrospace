import PageShell from '../ui/site/PageShell.jsx'
import NotFoundCard from '../ui/site/NotFoundCard.jsx'

export const metadata = { title: 'Page not found', robots: { index: false } }

export default function NotFound() {
  return (
    <PageShell>
      <NotFoundCard title="We can't find that page">
        <p>The address may have a typo, or the page may have moved. If you were trying to join a board, enter its code instead.</p>
      </NotFoundCard>
    </PageShell>
  )
}
