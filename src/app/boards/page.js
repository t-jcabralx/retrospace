import PageShell from '../../ui/site/PageShell.jsx'
import { utilityPage } from '../../lib/meta.js'
import Dashboard from '../../ui/boards/Dashboard.jsx'

export const metadata = utilityPage('Your boards', 'Your Retrospace boards and their access codes.')

export default function BoardsPage() {
  return (
    <PageShell>
      <Dashboard />
    </PageShell>
  )
}
