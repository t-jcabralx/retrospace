import PageShell from '../../ui/site/PageShell.jsx'
import { utilityPage } from '../../lib/meta.js'
import AuthSplit from '../../ui/auth/AuthSplit.jsx'
import IssueForm from '../../ui/site/IssueForm.jsx'
import './issue.css'

export const metadata = utilityPage('Report an issue', 'Tell us about a problem with Retrospace.')

export default function IssuePage() {
  return (
    <PageShell>
      <AuthSplit mode="issue">
        <IssueForm />
      </AuthSplit>
    </PageShell>
  )
}
