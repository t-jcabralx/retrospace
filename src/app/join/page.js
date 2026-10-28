import Link from 'next/link'
import PageShell from '../../ui/site/PageShell.jsx'
import { utilityPage } from '../../lib/meta.js'
import JoinBox from '../../ui/landing/JoinBox.jsx'

export const metadata = utilityPage('Join a board', 'Enter the access code you were given to join a Retrospace board.')

export default async function JoinPage({ searchParams }) {
  const { code } = await searchParams
  return (
    <PageShell centered>
      <div className="rs-card rs-auth">
        <h1>Join a board</h1>
        <p className="rs-auth-lede">Enter the access code you were given. You don&apos;t need an account.</p>
        <JoinBox variant="page" initialCode={typeof code === 'string' ? code : ''} />
        <p className="rs-auth-back"><Link href="/">Back to home</Link></p>
      </div>
    </PageShell>
  )
}
