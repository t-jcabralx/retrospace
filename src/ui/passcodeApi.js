// Exchanges a board passcode for the access cookie. -> an error message to show, or null on success.
export async function joinWithPasscode(code, passcode) {
  try {
    const res = await fetch(`/api/boards/${code}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode }) })
    if (res.ok) return null
    return (await res.json().catch(() => ({})))?.error || `Something went wrong (${res.status})`
  } catch {
    return 'Could not reach the server. Check your connection and try again.'
  }
}
