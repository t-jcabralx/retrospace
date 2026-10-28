import PageShell from '../../ui/site/PageShell.jsx'
import { utilityPage } from '../../lib/meta.js'
import AuthForm from '../../ui/auth/AuthForm.jsx'

export const metadata = utilityPage('Sign in', 'Sign in to create and manage your Retrospace boards.')

export default async function LoginPage({ searchParams }) {
  const { next } = await searchParams
  return (
    <PageShell centered>
      <AuthForm mode="login" next={next} />
    </PageShell>
  )
}
