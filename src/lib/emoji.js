// What counts as "one emoji": exactly one grapheme cluster (Intl.Segmenter) that is a well-formed emoji. Used to validate
// the throwable emoji list on the server and to give instant feedback in the settings panel. There is no data table: the
// rules below approximate the RGI emoji set with Unicode properties, and are deliberately a little strict.
export const MAX_EMOJI_UNITS = 16 // UTF-16 units; the longest everyday sequences (family, couple with skin tones) fit
export const DEFAULT_THROW_EMOJIS = Object.freeze(['🍌', '🗑️', '🐵', '🍅', '🌹', '❤️', '👏', '🎉'])

const MAX_ZWJ_PARTS = 4 // a family is four people
const ZWJ = '‍'
const VS16 = '️'
const KEYCAP = /^[0-9#*]️?⃣$/u
const FLAG = /^\p{Regional_Indicator}{2}$/u
const TAG_FLAG = /^\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F}$/u // England, Scotland, Wales: tags are only valid after the black flag
const PICTO = /^\p{Extended_Pictographic}$/u
const MODIFIER = /^\p{Emoji_Modifier}$/u
const MODIFIER_BASE = /^\p{Emoji_Modifier_Base}$/u
const EMOJI_PRESENTATION = /^\p{Emoji_Presentation}$/u
const REGIONAL = /^\p{Regional_Indicator}$/u
const byDefault = (c) => EMOJI_PRESENTATION.test(c) && !MODIFIER.test(c) && !REGIONAL.test(c) // shown as an emoji without VS16, so a bare one counts
// What may START a ZWJ sequence besides a person: the flags, a few animals and faces, the heart and the eye, the lemon
// (🏳️‍🌈 🏴‍☠️ 🐻‍❄️ 🐕‍🦺 🐈‍⬛ 🐦‍⬛ 😮‍💨 😵‍💫 ❤️‍🔥 👁️‍🗨️ 🍋‍🟩). A chain of unrelated pictographs (🍌‍🍌) does not start with one of these.
const ZWJ_LEAD = /^[\u{1F3F3}\u{1F3F4}\u{1F43B}\u{1F415}\u{1F408}\u{1F426}\u{1F62E}\u{1F635}❤\u{1F441}\u{1F34B}]$/u

const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

// One element of a sequence: a pictograph that is an emoji on its own (🍌) or is made one by VS16 (❤️) or by a skin tone
// (✌🏽), with at most one VS16 and at most one skin tone, and a skin tone only on a base that takes one.
function validPart(cps) {
  const [base, ...rest] = cps
  if (!PICTO.test(base ?? '')) return false
  let i = 0
  const vs = rest[i] === VS16
  if (vs) i++
  const mod = i < rest.length && MODIFIER.test(rest[i])
  if (mod) {
    if (!MODIFIER_BASE.test(base)) return false
    i++
  }
  return i === rest.length && (byDefault(base) || vs || mod)
}

export function isSingleEmoji(s) {
  if (typeof s !== 'string' || s.length === 0 || s.length > MAX_EMOJI_UNITS) return false
  if (/\p{Cn}/u.test(s)) return false // unassigned code points
  if (segmenter) {
    const it = segmenter.segment(s)[Symbol.iterator]()
    it.next()
    if (!it.next().done) return false // more than one grapheme
  }
  if (KEYCAP.test(s) || FLAG.test(s) || TAG_FLAG.test(s)) return true
  const parts = s.split(ZWJ).map((p) => [...p])
  if (parts.length > MAX_ZWJ_PARTS || !parts.every(validPart)) return false
  return parts.length === 1 || MODIFIER_BASE.test(parts[0][0]) || ZWJ_LEAD.test(parts[0][0])
}
