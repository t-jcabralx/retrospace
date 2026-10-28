'use client'
import { useEffect, useRef, useState } from 'react'
import { CopyIcon, CheckIcon } from '../site/icons.jsx'

// Clipboard API first; a hidden textarea and execCommand where it is unavailable or refused (older browsers, http).
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch { /* fall through */ }
  try {
    const before = document.activeElement
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    if (before instanceof HTMLElement) before.focus() // select() moved focus to the textarea
    return ok
  } catch {
    return false
  }
}

// `label` is the visible text, `ariaLabel` adds what is being copied. The result is announced through a polite
// live region and the button shows "Copied" for two seconds.
export default function CopyButton({ text, label, ariaLabel, Icon = CopyIcon }) {
  const [state, setState] = useState('idle') // idle | copied | failed
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    const ok = await copyText(text)
    setState(ok ? 'copied' : 'failed')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2200)
  }

  return (
    <>
      <button type="button" className="rs-btn rs-btn--secondary rs-btn--sm" onClick={copy} aria-label={ariaLabel}>
        {state === 'copied' ? <CheckIcon /> : <Icon />}
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
      </button>
      <span className="rs-vh" role="status">{state === 'copied' ? `${label.replace(/^Copy /, '')} copied to the clipboard` : state === 'failed' ? 'Copying failed. Select the text and copy it manually.' : ''}</span>
    </>
  )
}
