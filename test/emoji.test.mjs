import test from 'node:test'
import assert from 'node:assert/strict'
import { isSingleEmoji, DEFAULT_THROW_EMOJIS, MAX_EMOJI_UNITS } from '../src/lib/emoji.js'

test('accepts a single emoji grapheme in every common shape', () => {
  const good = [
    '🍌', '🗑️', '🐵', '🍅', '🌹', '❤️', '👏', '🎉', // the defaults
    '👩‍💻', '👨‍👩‍👧‍👦', // ZWJ sequences
    '🏳️‍🌈', // flag + VS16 + ZWJ
    '🇵🇭', '🇺🇸', // regional indicator pair
    '👍🏽', '🧑🏿‍🎤', // skin tones
    '1️⃣', '#️⃣', '*️⃣', // keycaps
    '🏴󠁧󠁢󠁥󠁮󠁧󠁿', // tag sequence flag
    '☺️', '✌️', '🙂', '✌🏽', '❤️‍🔥', '🐻‍❄️', '🏴‍☠️', '🧑‍🤝‍🧑',
  ]
  for (const s of good) assert.equal(isSingleEmoji(s), true, s)
})

test('rejects text, digits, whitespace, markup, several emoji and empty input', () => {
  const bad = ['a', 'A', '12', '1', '#', '*', '🍌🍌', '🍌 🍌', '<b>', '<img>', '🍌x', 'x🍌', ' ', '', '\n', '🍌\n', ' 🍌', '🍌 ', '🍌́', '🍌‍', '‍', '️', '⃣', '🇵', '🇵🇭🇵', '🏽', 'é', '漢', '&#127820;', '${x}',
    // text symbols that only look like emoji when VS16 follows, and bare hearts
    '™', '©', '®', '✔', '‼', '▶', '☺', '↔', '➡', '❤', '🗑', '✌',
    // arbitrary chains, stray joiners, tags outside a flag, double VS16, unassigned code points
    '🍌\u200D🍌', '🍌\u200D🍌\u200D🍌\u200D🍌\u200D🍌', '🍌\u200D🍌\u200D🍌\u200D🍌', '👩\u200D', '🍌\u{E0067}\u{E007F}', '😀\u{E007F}', '\u{E0001}', '🗑\uFE0F\uFE0F', '\u0378', '\u{1FFFE}']
  for (const s of bad) assert.equal(isSingleEmoji(s), false, JSON.stringify(s))
})

test('rejects anything that is not a string and anything over 16 UTF-16 units', () => {
  for (const v of [null, undefined, 5, true, {}, [], ['🍌'], 0]) assert.equal(isSingleEmoji(v), false, String(v))
  assert.equal(MAX_EMOJI_UNITS, 16)
  const family = '👨‍👩‍👧‍👦' // 11 units
  assert.equal(family.length, 11)
  assert.equal(isSingleEmoji(family), true)
  const long = '👨🏽‍👩🏽‍👧🏽‍👦🏽' // a single ZWJ cluster, 19 units
  assert.ok(long.length > 16)
  assert.equal(isSingleEmoji(long), false, 'the unit cap wins')
})

test('DEFAULT_THROW_EMOJIS is the documented list, all valid and unique', () => {
  assert.deepEqual(DEFAULT_THROW_EMOJIS, ['🍌', '🗑️', '🐵', '🍅', '🌹', '❤️', '👏', '🎉'])
  assert.equal(new Set(DEFAULT_THROW_EMOJIS).size, DEFAULT_THROW_EMOJIS.length)
  for (const e of DEFAULT_THROW_EMOJIS) assert.equal(isSingleEmoji(e), true, e)
  assert.ok(Object.isFrozen(DEFAULT_THROW_EMOJIS))
})
