// The board types the dashboard can create, and helpers over the shared template list. Adding a type means adding an
// entry here and its templates in templates.js. Pure and browser-safe.
import { BOARD_TEMPLATES, getTemplate } from './templates.js'
import { validateTitle, validateRecipient, MAX_TITLE, MAX_RECIPIENT } from './validate.js'

export const BOARD_TYPES = [
  { key: 'workshop', label: 'Workshop canvas', short: 'Workshop', blurb: 'A free canvas for retros, brainstorms and planning sessions.' },
  { key: 'celebration', label: 'Celebration board', short: 'Celebration', blurb: 'Gather cards, messages and GIFs for someone’s big moment.', needsRecipient: true },
  { key: 'retro', label: 'Retro board', short: 'Retro', blurb: 'Column templates for a team retrospective, with voting and an optional AI-written summary.' },
  { key: 'event', label: 'Event raffle', short: 'Event', blurb: 'A two-ring prize wheel for raffles and give-aways: people on the outer ring, prizes on the inner ring.' },
  { key: 'wall', label: 'Team wall', short: 'Team wall', blurb: 'A long-lived feed of shout-outs with badges and reactions, plus birthdays and work anniversaries.' },
]

const EXTRA = { wall: 'Team wall' }

export function typeInfo(key) {
  const known = BOARD_TYPES.find((t) => t.key === key)
  if (known) return known
  const short = EXTRA[key] ?? (typeof key === 'string' && key ? key[0].toUpperCase() + key.slice(1) : 'Board')
  return { key, label: short, short, blurb: '' }
}

export const templateList = (type) =>
  Object.hasOwn(BOARD_TEMPLATES, type) ? Object.values(BOARD_TEMPLATES[type]).map(({ key, label, emoji }) => ({ key, label, emoji })) : []

export const templateLabel = (type, key) => getTemplate(type, key)?.label ?? key

export const defaultTitle = (type, key, recipientName = '') => getTemplate(type, key)?.title(recipientName) ?? ''

// -> { title?, recipient? } with friendly messages; empty when the details are fine. Rules come from validate.js.
export function checkBoardDetails(type, { title, recipient }) {
  const errors = {}
  const t = validateTitle(title)
  if (!t.ok) errors.title = t.error === 'title required' ? 'Give the board a title' : `Titles can be up to ${MAX_TITLE} characters`
  if (typeInfo(type).needsRecipient) {
    const r = validateRecipient({ name: recipient })
    if (!r.ok) errors.recipient = String(recipient ?? '').trim() ? `Names can be up to ${MAX_RECIPIENT} characters` : 'Who is this for? Enter their name'
  }
  return errors
}
