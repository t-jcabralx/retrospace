'use client'
// The canvas listens for 'retro:jump' (detail = item id) so panels outside it can centre an item and focus it.
import { useEffect, useRef } from 'react'

export function useRetroJump(jump) {
  const latest = useRef(jump)
  latest.current = jump
  useEffect(() => {
    const on = (e) => latest.current(e.detail)
    window.addEventListener('retro:jump', on)
    return () => window.removeEventListener('retro:jump', on)
  }, [])
}
export const jumpTo = (id) => window.dispatchEvent(new CustomEvent('retro:jump', { detail: id }))
