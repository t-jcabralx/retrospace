'use client'
// "Create a board": sign up when signed out, straight to the dashboard when signed in.
import Link from 'next/link'
import { useAuth } from '../site/useAuth.js'

export default function CreateBoardLink({ className, children }) {
  const auth = useAuth()
  return <Link className={className} href={auth.status === 'in' ? '/boards' : '/register'}>{children}</Link>
}
