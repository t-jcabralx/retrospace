// Server-only: what an `ops` envelope carries. The channel (Upstash) refuses large messages, and a drag sends dozens of
// updates a second, so an item that only MOVED (or was voted on, reacted to, resized) goes out without its heavy data
// fields (a picture's data URL, a card's photo). Marked `slim`, it is merged by id into the item the client holds
// (see client/state.js); a client that does not hold the item ignores it and gets it whole from the next poll.
const HEAVY = ['src', 'gif', 'image']

// `valid`: the ops that were applied; `applied`: the item docs they produced. -> the docs to publish.
export function slimApplied(applied, valid) {
  const whole = new Set() // ids the clients need in full: new items, and items whose heavy data was just replaced
  for (const o of valid) {
    if (o.op === 'add') whole.add(o.id)
    else if (o.op === 'update' && o.patch?.data && HEAVY.some((k) => k in o.patch.data)) whole.add(o.id)
  }
  return applied.map((item) => {
    if (whole.has(item.id) || item.deleted || !item.data || !HEAVY.some((k) => k in item.data)) return item
    const data = Object.fromEntries(Object.entries(item.data).filter(([k]) => !HEAVY.includes(k)))
    return { ...item, data, slim: true }
  })
}
