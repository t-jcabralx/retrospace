// The signed-in account as the browser sees it: one store shared by every component on the page (see useAuth.js).
// status: loading | in | out | error (the server could not be reached). No React in here, so it is unit tested.
import { getJson, postJson } from './api.js'

export const SIGN_OUT_ERROR = "Couldn't sign you out. Try again."

const LOADING = { status: 'loading', user: null }
let state = LOADING
let inflight = null
let seq = 0 // bumped by every sign-in, sign-out and refresh, so an older answer can never overwrite a newer one
const listeners = new Set()

function set(next) {
  state = next
  for (const l of listeners) l()
}

export const getAuth = () => state
export const getServerAuth = () => LOADING
export const hasInflight = () => inflight !== null

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function refreshAuth() {
  const mine = ++seq
  const p = getJson('/api/auth/me?soft=1').then((r) => {
    if (inflight === p && !r.ok) inflight = null // a failed check is retried by the next mount
    if (mine !== seq) return
    if (r.ok && r.data?.user) set({ status: 'in', user: r.data.user })
    else set({ status: r.ok ? 'out' : 'error', user: null })
  })
  inflight = p
  return p
}

export function setSignedIn(user) {
  seq++
  set({ status: 'in', user })
}

export function setSignedOut() {
  seq++
  set({ status: 'out', user: null })
}

// Only a 2xx answer signs the browser out of the app state; anything else keeps the account and says so.
// -> { ok: true } | { ok: false, error }
export async function signOut() {
  const r = await postJson('/api/auth/logout')
  if (!r.ok) return { ok: false, error: SIGN_OUT_ERROR }
  setSignedOut()
  return { ok: true }
}

export function resetAuthForTests() {
  state = LOADING
  inflight = null
  seq = 0
  listeners.clear()
}
