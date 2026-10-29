// Notices when something other than this viewer puts back an item they just moved or resized, and says what did it.
// `recent`: id -> { at, x, y, w, h }, what the viewer left each item at. -> [{ id, cause }] for the items whose position or size
// went from that to something else because of `action`. Used to tell, in plain words on the screen and in the log, why a change "went back".
export const WATCH_MS = 30_000
const FRAME = ['x', 'y', 'w', 'h']
const CAUSES = {
  remote: 'a refresh from the server',
  ack: 'the server\'s answer to a save',
  load: 'a reload of the board',
  'peer-drag': 'another screen moving it',
  'peer-drag-end': 'another screen letting go of it',
  'peer-drag-expire': 'a temporary position timing out',
}
export const causeOf = (type) => CAUSES[type] ?? null
export const frameOf = (item) => Object.fromEntries(FRAME.filter((k) => Number.isFinite(item?.[k])).map((k) => [k, item[k]]))

export function revertedBy(type, before, after, recent, now = Date.now()) {
  const cause = causeOf(type)
  if (!cause) return []
  const out = []
  for (const [id, mine] of recent) {
    if (now - mine.at > WATCH_MS) { recent.delete(id); continue }
    const was = before.get(id)
    const is = after.get(id)
    if (!was || !is || was === is) continue
    const stayed = FRAME.every((k) => !Number.isFinite(mine[k]) || was[k] === mine[k]) // it was where the viewer left it
    const moved = FRAME.some((k) => Number.isFinite(mine[k]) && is[k] !== mine[k]) //     and now it is not
    if (stayed && moved) out.push({ id, cause, type })
  }
  return out
}
