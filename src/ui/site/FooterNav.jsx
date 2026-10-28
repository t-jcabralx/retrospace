'use client'
import Link from 'next/link'
import { useAuth } from './useAuth.js'

// Footer links: "Sign in" for visitors, "My boards" once signed in (same width, so nothing jumps).
export default function FooterNav() {
  const auth = useAuth()
  return (
    <nav className="rs-footer-nav" aria-label="Footer">
      <Link href="/join">Join a board</Link>
      {auth.status === 'in' ? <Link href="/boards">My boards</Link> : <Link href="/login">Sign in</Link>}
    </nav>
  )
}
