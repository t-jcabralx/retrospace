'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { LogoMark } from './Logo.jsx'
import { useAuth, signOut } from './useAuth.js'
import './site.css'

// Sticky top bar for the landing, account, join and dashboard pages. The auth-aware buttons wait for /api/auth/me
// behind a placeholder of the same size, so the wrong buttons never flash.
export default function SiteHeader({ landing = false }) {
  const auth = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [busy, setBusy] = useState(false)
  const [signOutError, setSignOutError] = useState('')

  async function handleSignOut() {
    setBusy(true)
    setSignOutError('')
    const r = await signOut()
    setBusy(false)
    if (!r.ok) { setSignOutError(r.error); return } // still signed in: say so instead of pretending
    if (pathname.startsWith('/boards')) router.push('/')
  }

  return (
    <header className="rs-header">
      <a className="rs-skip" href="#main">Skip to main content</a>
      <div className="rs-header-in">
        <Link className="rs-logo" href="/" aria-label="Retrospace home">
          <LogoMark />
          <span className="rs-wordmark">Retrospace</span>
        </Link>
        {landing && (
          <nav className="rs-nav" aria-label="Page sections">
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
          </nav>
        )}
        <div className="rs-actions">
          {auth.status === 'loading' && (
            <>
              <span className="rs-skel rs-skel-a" aria-hidden="true" />
              <span className="rs-skel rs-skel-b" aria-hidden="true" />
            </>
          )}
          {(auth.status === 'out' || auth.status === 'error') && (
            <>
              <Link className="rs-btn rs-btn--ghost" href="/login">Sign in</Link>
              <Link className="rs-btn rs-btn--primary" href="/register">Get started</Link>
            </>
          )}
          {auth.status === 'in' && (
            <>
              <Link className="rs-btn rs-btn--ghost" href="/boards" aria-current={pathname === '/boards' ? 'page' : undefined}>My boards</Link>
              <button type="button" className="rs-btn rs-btn--secondary" onClick={handleSignOut} disabled={busy}>
                {busy ? 'Signing out…' : 'Sign out'}
              </button>
            </>
          )}
        </div>
      </div>
      <p className="rs-header-msg" role="status" aria-live="polite">{signOutError}</p>
    </header>
  )
}
