'use client'
import { useEffect, useState } from 'react'

// True when the person asked their system for less motion; follows a change while the page is open.
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const q = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!q) return undefined
    setReduced(q.matches)
    const on = (e) => setReduced(e.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return reduced
}
