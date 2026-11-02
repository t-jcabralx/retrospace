import PageShell from '../../ui/site/PageShell.jsx'
import { utilityPage } from '../../lib/meta.js'
import AuthSplit from '../../ui/auth/AuthSplit.jsx'
import { ResetForm } from '../../ui/auth/RecoverForm.jsx'

// The link carries a one-time token in its address, so the page never passes it on as a referrer.
export const metadata = { ...utilityPage('Choose a new password', 'Choose a new password for your Retrospace account.'), referrer: 'no-referrer' }

export default async function ResetPage({ searchParams }) {
  const { token } = await searchParams
  return (
    <PageShell>
      <AuthSplit mode="login">
        <ResetForm token={typeof token === 'string' ? token : ''} />
      </AuthSplit>
    </PageShell>
  )
}
