import PageShell from '../../ui/site/PageShell.jsx'
import { utilityPage } from '../../lib/meta.js'
import AuthForm from '../../ui/auth/AuthForm.jsx'
import AuthSplit from '../../ui/auth/AuthSplit.jsx'

export const metadata = utilityPage('Create an account', 'Create a Retrospace account to run retrospectives, workshops and celebrations.')

export default async function RegisterPage({ searchParams }) {
  const { next } = await searchParams
  return (
    <PageShell>
      <AuthSplit mode="register">
        <AuthForm mode="register" next={next} />
      </AuthSplit>
    </PageShell>
  )
}
