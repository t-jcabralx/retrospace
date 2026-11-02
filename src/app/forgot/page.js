import PageShell from '../../ui/site/PageShell.jsx'
import { utilityPage } from '../../lib/meta.js'
import AuthSplit from '../../ui/auth/AuthSplit.jsx'
import { ForgotForm } from '../../ui/auth/RecoverForm.jsx'

export const metadata = utilityPage('Forgot password', 'Get a link by email to choose a new Retrospace password.')

export default function ForgotPage() {
  return (
    <PageShell>
      <AuthSplit mode="login">
        <ForgotForm />
      </AuthSplit>
    </PageShell>
  )
}
