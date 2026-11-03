import PageShell from '../../ui/site/PageShell.jsx'
import { utilityPage } from '../../lib/meta.js'
import IssueForm from '../../ui/site/IssueForm.jsx'
import './issue.css'

export const metadata = utilityPage('Report an issue', 'Tell us about a problem with Retrospace.')

export default function IssuePage() {
  return (
    <PageShell>
      <div className="rs-wrap is-wrap"><IssueForm /></div>
    </PageShell>
  )
}
