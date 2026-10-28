// Participant personas: a name plus a small generated creature. Pure and browser-safe (no node imports): the same
// rules run in the chooser (live validation) and on the server (the only place they are enforced).
import { stripControl } from './ids.js'

export const ADJECTIVES = [
  'Happy', 'Brave', 'Calm', 'Clever', 'Cozy', 'Curious', 'Cheerful', 'Daring', 'Dapper', 'Eager', 'Fuzzy', 'Gentle',
  'Giddy', 'Glad', 'Golden', 'Jolly', 'Kind', 'Lively', 'Lucky', 'Merry', 'Mighty', 'Mellow', 'Nimble', 'Noble',
  'Peppy', 'Plucky', 'Polite', 'Plush', 'Quick', 'Quiet', 'Radiant', 'Rosy', 'Sleepy', 'Snappy', 'Sparkly', 'Speedy',
  'Sunny', 'Swift', 'Tidy', 'Twinkly', 'Upbeat', 'Vivid', 'Warm', 'Whimsical', 'Wise', 'Witty', 'Zesty', 'Zippy',
  'Bouncy', 'Breezy', 'Chipper', 'Dreamy', 'Friendly', 'Humble', 'Jazzy', 'Sprightly',
]

export const ANIMALS = [
  'Otter', 'Panda', 'Fox', 'Koala', 'Owl', 'Penguin', 'Rabbit', 'Hedgehog', 'Dolphin', 'Turtle', 'Falcon', 'Badger',
  'Beaver', 'Bison', 'Camel', 'Cheetah', 'Crane', 'Deer', 'Eagle', 'Ferret', 'Finch', 'Gecko', 'Giraffe', 'Heron',
  'Ibis', 'Gazelle', 'Kiwi', 'Lemur', 'Llama', 'Lynx', 'Magpie', 'Manatee', 'Marmot', 'Moose', 'Narwhal', 'Newt',
  'Ocelot', 'Osprey', 'Pelican', 'Puffin', 'Quokka', 'Starling', 'Wren', 'Seal', 'Sloth', 'Sparrow', 'Squirrel', 'Swan',
  'Tapir', 'Toucan', 'Walrus', 'Wombat', 'Yak', 'Zebra', 'Alpaca', 'Bunny',
]

// How many choices each part of the avatar has. The Avatar component draws exactly these.
export const AVATAR_PARTS = { bg: 12, body: 8, eyes: 8, mouth: 8, extra: 8 }
const PART_KEYS = Object.keys(AVATAR_PARTS)

export const NAME_MIN = 2
export const NAME_MAX = 24
const MAX_SUFFIX = 99
const PROBES = 50

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const pick = (list, rand) => list[Math.min(list.length - 1, Math.floor(rand() * list.length))]
const fail = (error, status = 400, extra = {}) => ({ ok: false, error, status, ...extra })

// --- what a name is ---------------------------------------------------------------------------------------------
// Characters that render as nothing (or nearly): control characters, everything Unicode marks Default_Ignorable
// (zero-width and bidi characters, soft hyphen, variation selectors, the combining grapheme joiner U+034F, Hangul
// fillers U+115F/U+1160/U+3164/U+FFA0, ...), the Braille blank U+2800, and enclosing marks. Combining marks (Mn, Mc)
// are handled separately because legitimate names carry them.
const BLANK_SRC = '\\p{Cc}\\p{Zl}\\p{Zp}\\p{Default_Ignorable_Code_Point}\\p{Me}\\u2800\\u3164\\u115F\\u1160\\uFFA0'
const BLANK = new RegExp(`[${BLANK_SRC}]`, 'u')
const BLANKS = new RegExp(`[${BLANK_SRC}]`, 'gu')
const MARK = /[\p{Mn}\p{Mc}]/u
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u
const MAX_MARKS = 4 // combining marks kept per base letter in a DISPLAY name; Zalgo stacks beyond this are cut

// ZWNJ and ZWJ are Default_Ignorable, but Persian, Indic and Khmer/Myanmar text needs them between two letters of the
// same script. They are kept only there; everywhere else (Latin, between a letter and a space, doubled, ...) they go.
const JOINER_SCRIPTS = ['Arabic', 'Devanagari', 'Bengali', 'Gurmukhi', 'Gujarati', 'Oriya', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Sinhala', 'Khmer', 'Myanmar']
  .map((name) => [name, new RegExp(`\\p{Script=${name}}`, 'u')])
const joinerScript = (ch) => JOINER_SCRIPTS.find(([, re]) => re.test(ch))?.[0] ?? null

// Best-effort confusable folding for the uniqueness key: Cyrillic and Greek letters (and the dotless i) that look like
// a Latin one. This is NOT a full UTS #39 skeleton; it only stops the common look-alike impersonations.
const CONFUSABLES = {
  'а': 'a', 'ɑ': 'a', 'е': 'e', 'о': 'o', 'ο': 'o', 'р': 'p', 'ρ': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ι': 'i',
  'ı': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ɡ': 'g', 'ν': 'v', 'ѵ': 'v', 'к': 'k', 'м': 'm', 'т': 't', 'ӏ': 'l', 'υ': 'u',
}
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join('')}]`, 'gu')
const MARK_FOLDED_SCRIPTS = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u

// The key two names are compared by: NFKD (width and compatibility forms, accented letters split into base + mark),
// lowercase (English rules, so İ is i plus a dot mark), invisible characters and the Arabic tatweel removed, and
// combining marks removed ONLY when their base letter is Latin, Greek or Cyrillic (so José, Jose and a Zalgo-stacked
// Jose are one name, as are Işık and İşik; Vietnamese tone-only differences on Latin letters collide too, which is
// accepted). Marks on every other script are part of the name: ケン and ゲン, कांत and कात stay different. Then
// look-alikes folded and spaces collapsed.
export function nameKey(name) {
  const text = String(name).normalize('NFKD').toLocaleLowerCase('en').replace(BLANKS, '').replace(/ـ/g, '')
  let out = ''
  let fold = false // the last base letter is Latin, Greek or Cyrillic
  for (const ch of text) {
    if (MARK.test(ch)) { if (!fold) out += ch; continue }
    fold = MARK_FOLDED_SCRIPTS.test(ch)
    out += ch
  }
  return out.replace(CONFUSABLE_RE, (c) => CONFUSABLES[c]).replace(/\s+/g, ' ').trim()
}

// The display form of a custom name, cleaned cluster by cluster. Control characters become spaces, then NFC (decomposed
// accents compose); invisible characters go; a cluster is a base letter or digit plus the combining marks after it
// (Mn and Mc: a spacing vowel sign such as the Devanagari aa never ends the cluster, so a nasal mark after it stays),
// at most MAX_MARKS per cluster; marks with no base are dropped; ZWNJ/ZWJ survive only between two letters of one
// joiner script (see above). Names in any script (कांत, ਸਿੰਘ, கார்த்திக், Nguyễn, José, ゲン, 김민준) come out unchanged;
// a stack of 30 marks does not.
function cleanCustom(raw) {
  const cps = Array.from(stripControl(raw).normalize('NFC'))
  let out = ''
  let marks = 0
  let base = false
  let script = null // joiner script of the last base letter
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i]
    if (ch === '‌' || ch === '‍') {
      if (base && script && joinerScript(cps[i + 1] ?? '') === script) out += ch
      continue
    }
    if (BLANK.test(ch)) continue
    if (MARK.test(ch)) {
      if (base && marks < MAX_MARKS) { out += ch; marks++ }
      continue
    }
    marks = 0
    base = LETTER_OR_DIGIT.test(ch)
    script = base ? joinerScript(ch) : null
    out += ch
  }
  return out.replace(/\s+/g, ' ').trim()
}
// Visible letters and digits. Decorative modifier letters do not count, so a name cannot be made of them alone: the
// tatweel U+0640, the spacing modifier letters U+02B0-U+02FF, phonetic extensions U+1D2C-U+1DBF, super/subscripts
// U+2071-U+209C and modifier tone letters U+A700-U+A7FF. Modifier letters of real scripts (the kana prolonged sound
// mark ー, Thai ๆ, Hangul, Ethiopic, ...) count like any letter.
const DECORATIVE = /[\u0640\u02B0-\u02FF\u1D2C-\u1DBF\u2071-\u209C\uA700-\uA7FF]/u
const visibleCount = (s) => Array.from(s).filter((c) => LETTER_OR_DIGIT.test(c) && !DECORATIVE.test(c)).length

const keysOf = (taken) => new Set([...(taken ?? [])].map(nameKey))

export function randomAvatar(rand = Math.random) {
  const avatar = {}
  for (const k of PART_KEYS) avatar[k] = Math.min(AVATAR_PARTS[k] - 1, Math.floor(rand() * AVATAR_PARTS[k]))
  return avatar
}

// Deterministic avatar from any string (FNV-1a into a small PRNG): the owner's account avatar comes from the user id.
export function avatarFromSeed(seed) {
  let h = 2166136261
  for (const ch of String(seed ?? '')) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0
  const rand = () => { // mulberry32
    h = (h + 0x6d2b79f5) >>> 0
    let t = h
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return randomAvatar(rand)
}

export function validateAvatar(a) {
  if (!isObj(a)) return { ok: false, error: 'Invalid avatar' }
  const keys = Object.keys(a)
  if (keys.length !== PART_KEYS.length || !keys.every((k) => Object.hasOwn(AVATAR_PARTS, k))) return { ok: false, error: 'Invalid avatar' }
  const out = {}
  for (const k of PART_KEYS) {
    if (!Number.isInteger(a[k]) || a[k] < 0 || a[k] >= AVATAR_PARTS[k]) return { ok: false, error: 'Invalid avatar' }
    out[k] = a[k]
  }
  return { ok: true, avatar: out }
}

// A free "<Adjective> <Animal>" (probes up to 50 random pairs, then numbers the last one " 2", " 3", ...).
// `taken` holds names already in use on the board (any case).
export function generatePersona(rand = Math.random, taken = new Set()) {
  const used = keysOf(taken)
  let name = ''
  for (let i = 0; i < PROBES; i++) {
    name = `${pick(ADJECTIVES, rand)} ${pick(ANIMALS, rand)}`
    if (!used.has(nameKey(name))) return { kind: 'anonymous', name, avatar: randomAvatar(rand) }
  }
  for (let n = 2; ; n++) {
    const numbered = `${name} ${n}`
    if (!used.has(nameKey(numbered)) || n > MAX_SUFFIX) return { kind: 'anonymous', name: numbered, avatar: randomAvatar(rand) }
  }
}

const ADJ_SET = new Set(ADJECTIVES)
const ANIMAL_SET = new Set(ANIMALS)

// Exactly "<Adjective> <Animal>" with an optional " 2".." 99"; nothing else passes for an anonymous name.
function isGeneratedName(name) {
  if (typeof name !== 'string') return false
  const parts = name.split(' ')
  if (parts.length !== 2 && parts.length !== 3) return false
  if (!ADJ_SET.has(parts[0]) || !ANIMAL_SET.has(parts[1])) return false
  if (parts.length === 2) return true
  const n = Number(parts[2])
  return /^\d{1,2}$/.test(parts[2]) && String(n) === parts[2] && n >= 2 && n <= MAX_SUFFIX
}

// input: { kind, name, avatar }. options:
//   taken        names already used by other participants of the board, the owner's account persona included
//   ownerName    the board owner's display name; nobody else may use it (anonymous names included)
//   accountName  set only when the caller is the signed-in owner: lets kind 'account', which always carries that name
//   rand         random source for the suggestion
// -> { ok: true, persona: { kind, name, avatar } } | { ok: false, error, status, suggestion? }
const MAX_RAW_NAME = 256 // anything longer is refused before any cleaning (which costs CPU per character)

export function validatePersona(input, { taken = new Set(), ownerName, accountName, rand = Math.random } = {}) {
  if (!isObj(input)) return fail('Invalid persona')
  if ((input.kind === 'anonymous' || input.kind === 'custom') && (typeof input.name !== 'string' || input.name.length > MAX_RAW_NAME)) return fail(`Names are ${NAME_MIN}-${NAME_MAX} characters`)
  const av = validateAvatar(input.avatar)
  if (!av.ok) return fail(av.error)
  const used = keysOf(taken)
  if (typeof ownerName === 'string' && ownerName) used.add(nameKey(ownerName)) // nobody else may use the facilitator's name, in either kind
  const TAKEN = 'That name is already taken on this board'

  switch (input.kind) {
    case 'anonymous': {
      if (!isGeneratedName(input.name)) return fail('Pick a generated name, or use your own')
      if (used.has(nameKey(input.name))) return fail(TAKEN, 409, { suggestion: generatePersona(rand, used).name })
      return { ok: true, persona: { kind: 'anonymous', name: input.name, avatar: av.avatar } }
    }
    case 'custom': {
      const name = typeof input.name === 'string' ? cleanCustom(input.name) : ''
      const length = Array.from(name).length
      if (length < NAME_MIN || length > NAME_MAX) return fail(`Names are ${NAME_MIN}-${NAME_MAX} characters`)
      if (visibleCount(name) < 2) return fail('Include at least two letters or numbers')
      if (used.has(nameKey(name))) return fail(TAKEN, 409)
      return { ok: true, persona: { kind: 'custom', name, avatar: av.avatar } }
    }
    case 'account':
      if (typeof accountName !== 'string' || !accountName) return fail('Invalid persona')
      return { ok: true, persona: { kind: 'account', name: accountName, avatar: av.avatar } }
    default:
      return fail('Invalid persona')
  }
}
