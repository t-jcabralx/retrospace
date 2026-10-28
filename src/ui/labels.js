// Accessible names for canvas items. Pure so they can be tested.
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

// The author is named from the stored persona (the server stamps it), so a screen reader hears who wrote a note.
export function itemLabel(item) {
  const base = itemBaseLabel(item)
  const by = clip(item.authorName, 24)
  return by ? `${base}, by ${by}` : base
}

function itemBaseLabel(item) {
  const d = item.data ?? {}
  const text = (name) => (clip(d.text, 60) ? `${name}: ${clip(d.text, 60)}` : `${name} (empty)`)
  switch (item.kind) {
    case 'note': return text('Sticky note')
    case 'text': return text('Text')
    case 'shape': return text(`Shape (${d.shape ?? 'rect'})`)
    case 'frame': return clip(d.title, 60) ? `Frame: ${clip(d.title, 60)}` : 'Frame (untitled)'
    case 'image': return 'Image'
    case 'card': return `Card from ${clip(d.signer, 24) || 'someone'}: ${clip(d.message, 60) || '(empty)'}`
    case 'action': return `Action: ${clip(d.action, 60) || '(empty)'}${d.owner ? `, owner ${clip(d.owner, 24)}` : ', needs an owner'}${d.due ? `, due ${d.due}` : ', needs a due date'}`
    case 'theme': return clip(d.title, 60) ? `Theme: ${clip(d.title, 60)}` : 'Theme'
    case 'shoutout': return `Shout-out to ${clip(d.toName, 24) || 'someone'}${d.badge ? ` (${d.badge})` : ''}: ${clip(d.message, 60) || '(empty)'}`
    default: return item.kind
  }
}

const NAMES = { note: 'sticky note', text: 'text', shape: 'shape', frame: 'frame', image: 'image', card: 'card', action: 'action' }
const short = (i) => clip(i.kind === 'frame' ? i.data?.title : i.data?.text ?? i.data?.message ?? i.data?.action, 24) || NAMES[i.kind] || i.kind

export const connectorLabel = (from, to) => `Connector from ${short(from)} to ${short(to)}`
