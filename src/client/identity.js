// Browser-safe: nothing runs at import time and every storage access is guarded, so it also works with blocked
// storage (private windows) by falling back to memory.
//
// The browser no longer has an identity of its own: the guest uid is minted by the server and lives in an HttpOnly
// cookie the page cannot read or set (see src/lib/guest.js); the page learns it from snapshot.viewer.uid. All that is
// kept here is a convenience for the persona chooser: the last custom name typed, to prefill the field next time.
import { cleanName } from '../lib/ids.js'

const KEY = 'km:name'
const NO_STORAGE = {}
const fallbacks = new WeakMap() // per storage object, so values survive a storage that throws

function defaultStorage() {
  try { return globalThis.localStorage } catch { return null }
}

function memory(storage) {
  const key = storage && typeof storage === 'object' ? storage : NO_STORAGE
  if (!fallbacks.has(key)) fallbacks.set(key, new Map())
  return fallbacks.get(key)
}

// '' when nothing was remembered.
export function getNameDraft(storage = defaultStorage()) {
  let v = null
  try { v = storage?.getItem(KEY) } catch { /* fall through to memory */ }
  v ??= memory(storage).get(KEY) ?? null
  return typeof v === 'string' && v ? cleanName(v) : ''
}

export function setNameDraft(name, storage = defaultStorage()) {
  const clean = typeof name === 'string' && name.trim() ? cleanName(name) : ''
  memory(storage).set(KEY, clean)
  try { storage?.setItem(KEY, clean) } catch { /* memory copy is enough */ }
  return clean
}
