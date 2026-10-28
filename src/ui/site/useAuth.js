'use client'
// React side of authStore.js. status: loading | in | out | error.
import { useEffect, useSyncExternalStore } from 'react'
import { subscribe, getAuth, getServerAuth, hasInflight, refreshAuth } from './authStore.js'

export { refreshAuth, setSignedIn, setSignedOut, signOut } from './authStore.js'

export function useAuth() {
  const auth = useSyncExternalStore(subscribe, getAuth, getServerAuth)
  useEffect(() => { if (!hasInflight()) refreshAuth() }, [])
  return auth
}
