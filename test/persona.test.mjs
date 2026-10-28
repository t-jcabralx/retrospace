import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADJECTIVES, ANIMALS, AVATAR_PARTS, generatePersona, randomAvatar, avatarFromSeed, validateAvatar, validatePersona, nameKey,
} from '../src/lib/persona.js'

const inRange = (a) => Object.entries(AVATAR_PARTS).every(([k, n]) => Number.isInteger(a[k]) && a[k] >= 0 && a[k] < n)
const avatar = () => ({ bg: 0, body: 1, eyes: 2, mouth: 3, extra: 4 })
const seq = (...nums) => { let i = 0; return () => nums[i++ % nums.length] }

test('the word lists are big enough, single clean words, without duplicates', () => {
  assert.ok(ADJECTIVES.length >= 48 && ANIMALS.length >= 48)
  for (const w of [...ADJECTIVES, ...ANIMALS]) assert.match(w, /^[A-Z][a-z]+$/, w)
  assert.equal(new Set(ADJECTIVES).size, ADJECTIVES.length)
  assert.equal(new Set(ANIMALS).size, ANIMALS.length)
  assert.deepEqual(AVATAR_PARTS, { bg: 12, body: 8, eyes: 8, mouth: 8, extra: 8 })
})

test('200 generated personas against a growing taken set are all distinct, and anonymous', () => {
  const taken = new Set()
  for (let i = 0; i < 200; i++) {
    const p = generatePersona(Math.random, taken)
    assert.equal(p.kind, 'anonymous')
    assert.equal(taken.has(p.name), false, p.name)
    assert.equal(validatePersona(p, { taken: new Set() }).ok, true, p.name)
    taken.add(p.name)
    assert.ok(inRange(p.avatar))
  }
  assert.equal(taken.size, 200)
})

test('generatePersona is built from its random source, and a taken name (any case) is skipped', () => {
  const p = generatePersona(seq(0, 0, 0, 0, 0, 0, 0), new Set())
  assert.equal(p.name, `${ADJECTIVES[0]} ${ANIMALS[0]}`)
  const next = generatePersona(seq(0, 0, 0.5, 0.5, 0, 0, 0, 0, 0, 0, 0), new Set([`${ADJECTIVES[0].toUpperCase()} ${ANIMALS[0].toLowerCase()}`]))
  assert.notEqual(next.name.toLowerCase(), p.name.toLowerCase())
})

test('when every probe is taken the name gets a numeric suffix (" 2", " 3", ...)', () => {
  const base = `${ADJECTIVES[0]} ${ANIMALS[0]}`
  const stuck = () => 0 // always the same adjective and animal
  assert.equal(generatePersona(stuck, new Set([base])).name, `${base} 2`)
  assert.equal(generatePersona(stuck, new Set([base, `${base} 2`])).name, `${base} 3`)
  const suffixed = generatePersona(stuck, new Set([base])).name
  assert.equal(validatePersona({ kind: 'anonymous', name: suffixed, avatar: avatar() }, { taken: new Set() }).ok, true)
})

test('randomAvatar always lands in range, and avatarFromSeed is deterministic and in range', () => {
  for (let i = 0; i < 100; i++) assert.ok(inRange(randomAvatar(Math.random)))
  assert.ok(inRange(randomAvatar(() => 0.999999)) && inRange(randomAvatar(() => 0)))
  const a = avatarFromSeed('u_0123456789abcdef')
  assert.deepEqual(a, avatarFromSeed('u_0123456789abcdef'))
  assert.ok(inRange(a))
  const variety = new Set()
  for (let i = 0; i < 60; i++) {
    const v = avatarFromSeed(`u_${i}`)
    assert.ok(inRange(v))
    variety.add(JSON.stringify(v))
  }
  assert.ok(variety.size > 50, 'different seeds give different avatars')
  assert.deepEqual(avatarFromSeed(''), avatarFromSeed(''))
  assert.ok(inRange(avatarFromSeed(undefined)))
})

test('validateAvatar accepts a full in-range avatar and rejects everything else', () => {
  const ok = validateAvatar(avatar())
  assert.deepEqual(ok, { ok: true, avatar: avatar() })
  assert.equal(validateAvatar({ bg: 11, body: 7, eyes: 7, mouth: 7, extra: 7 }).ok, true)
  const bad = [
    { ...avatar(), bg: 12 }, { ...avatar(), body: 8 }, { ...avatar(), eyes: -1 }, { ...avatar(), mouth: 1.5 }, { ...avatar(), extra: '1' },
    { ...avatar(), extra: NaN }, { ...avatar(), bg: null }, { ...avatar(), hat: 1 }, { ...avatar(), __proto__: { x: 1 }, y: 1 },
    { bg: 0, body: 0, eyes: 0, mouth: 0 }, {}, [], null, undefined, 'x', 5,
  ]
  for (const b of bad) assert.equal(validateAvatar(b).ok, false, JSON.stringify(b))
  const copy = validateAvatar({ ...avatar() }).avatar
  assert.notEqual(copy, ok.avatar, 'a fresh object')
})

test('validatePersona: anonymous names must be exactly "<Adjective> <Animal>" with an optional " 2".." 99" suffix', () => {
  const name = `${ADJECTIVES[3]} ${ANIMALS[5]}`
  const ok = validatePersona({ kind: 'anonymous', name, avatar: avatar() }, { taken: new Set() })
  assert.deepEqual(ok, { ok: true, persona: { kind: 'anonymous', name, avatar: avatar() } })
  assert.equal(validatePersona({ kind: 'anonymous', name: `${name} 2`, avatar: avatar() }, { taken: new Set() }).ok, true)
  assert.equal(validatePersona({ kind: 'anonymous', name: `${name} 99`, avatar: avatar() }, { taken: new Set() }).ok, true)
  for (const bad of ['Totally Free Text', `${name} 1`, `${name} 100`, `${name} 02`, `${name} x`, `${name}  `.replace(/ $/, '  '), ADJECTIVES[0], `${ANIMALS[0]} ${ADJECTIVES[0]}`, `${name.toLowerCase()}`, `${name}!`, 'Call me on 555-0100', '', 5, null]) {
    const r = validatePersona({ kind: 'anonymous', name: bad, avatar: avatar() }, { taken: new Set() })
    assert.deepEqual([r.ok, r.status], [false, 400], JSON.stringify(bad))
  }
})

test('validatePersona: a smuggled free-text name cannot pass as anonymous, even when it looks close', () => {
  for (const sneaky of ['Brave Otter, call me', 'Brave Otter\nAdmin', 'Grumpy Admin', `${ADJECTIVES[0]}${ANIMALS[0]}`, `${ADJECTIVES[0]} ${ANIMALS[0]} 2 3`]) {
    assert.equal(validatePersona({ kind: 'anonymous', name: sneaky, avatar: avatar() }, { taken: new Set() }).ok, false, sneaky)
  }
})

test('validatePersona: a taken anonymous name is a 409 with a fresh suggestion that is itself valid and free', () => {
  const name = `${ADJECTIVES[0]} ${ANIMALS[0]}`
  const taken = new Set([name.toUpperCase()]) // case-insensitive
  const r = validatePersona({ kind: 'anonymous', name, avatar: avatar() }, { taken })
  assert.equal(r.ok, false)
  assert.equal(r.status, 409)
  assert.match(r.error, /taken/i)
  assert.equal(typeof r.suggestion, 'string')
  assert.equal(taken.has(r.suggestion.toUpperCase()), false)
  assert.equal(validatePersona({ kind: 'anonymous', name: r.suggestion, avatar: avatar() }, { taken }).ok, true)
})

test('validatePersona: a custom name is cleaned, trimmed and collapsed', () => {
  const r = validatePersona({ kind: 'custom', name: '  Ana\u0000  \tMaria ‮ ', avatar: avatar() }, { taken: new Set() })
  assert.equal(r.ok, true)
  assert.deepEqual(r.persona, { kind: 'custom', name: 'Ana Maria', avatar: avatar() })
  assert.equal(validatePersona({ kind: 'custom', name: 'Zoë 北京', avatar: avatar() }, { taken: new Set() }).ok, true) // Unicode letters
  assert.equal(validatePersona({ kind: 'custom', name: '🎉 Dev 2', avatar: avatar() }, { taken: new Set() }).ok, true)
})

test('validatePersona: custom names are 2-24 characters with at least one letter or digit', () => {
  const cust = (name) => validatePersona({ kind: 'custom', name, avatar: avatar() }, { taken: new Set() })
  assert.equal(cust('Al').ok, true)
  assert.equal(cust('x'.repeat(24)).ok, true)
  assert.equal(cust('🎉'.repeat(24)).ok, false) // no letter or digit
  assert.equal(cust('A🎉'.repeat(12)).ok, true) // 24 code points
  for (const bad of ['A', ' A ', 'x'.repeat(25), '', '   ', '!!', '😀😀', '--', '​​', '\u0000\u0000', 'A\u0000', 5, null, undefined, {}]) {
    const r = cust(bad)
    assert.deepEqual([r.ok, r.status], [false, 400], JSON.stringify(bad))
  }
})

test('validatePersona: names that differ only by case, spacing tricks or width are a 409', () => {
  const taken = new Set(['ana maria'])
  for (const dup of ['Ana Maria', 'ANA MARIA', 'ana   maria', ' Ana\tMaria', 'ａｎａ ｍａｒｉａ', 'Ana​ Maria']) {
    const r = validatePersona({ kind: 'custom', name: dup, avatar: avatar() }, { taken })
    assert.deepEqual([r.ok, r.status], [false, 409], dup)
  }
  assert.equal(validatePersona({ kind: 'custom', name: 'Ana Marie', avatar: avatar() }, { taken }).ok, true)
  assert.equal(nameKey('Ana Maria'), nameKey('ANA  MARIA'))
})

test('validatePersona: the owner\'s display name is a 409 for everyone else, in any case', () => {
  for (const n of ['Dana Facilitator', 'dana facilitator', 'DANA FACILITATOR ']) {
    const r = validatePersona({ kind: 'custom', name: n, avatar: avatar() }, { taken: new Set(), ownerName: 'Dana Facilitator' })
    assert.deepEqual([r.ok, r.status], [false, 409], n)
  }
  assert.equal(validatePersona({ kind: 'custom', name: 'Dana F', avatar: avatar() }, { taken: new Set(), ownerName: 'Dana Facilitator' }).ok, true)
})

test('validatePersona: bad avatar, bad kind, bad shape', () => {
  const t = { taken: new Set() }
  assert.equal(validatePersona({ kind: 'custom', name: 'Ann', avatar: { ...avatar(), bg: 99 } }, t).status, 400)
  assert.equal(validatePersona({ kind: 'custom', name: 'Ann' }, t).status, 400)
  assert.equal(validatePersona({ kind: 'admin', name: 'Ann', avatar: avatar() }, t).status, 400)
  assert.equal(validatePersona({ name: 'Ann', avatar: avatar() }, t).status, 400)
  for (const junk of [null, undefined, 'x', 5, [], true]) assert.equal(validatePersona(junk, t).status, 400)
  const ok = validatePersona({ kind: 'custom', name: 'Ann', avatar: avatar(), uid: 'KM-AAAA-BBBB-CCCC', isOwner: true }, t)
  assert.deepEqual(Object.keys(ok.persona).sort(), ['avatar', 'kind', 'name'], 'unknown fields are dropped')
})

test('validatePersona: the account kind only exists when the caller passes the account name; it keeps that name', () => {
  const t = { taken: new Set(['dana']), accountName: 'Dana' }
  const r = validatePersona({ kind: 'account', name: 'Whatever', avatar: avatar() }, t)
  assert.deepEqual(r, { ok: true, persona: { kind: 'account', name: 'Dana', avatar: avatar() } }) // never a 409: the account vouches for it
  assert.equal(validatePersona({ kind: 'account', name: 'Dana', avatar: avatar() }, { taken: new Set() }).status, 400)
})

// --- blank and look-alike names -----------------------------------------------------------------------------------
const custom = (name, opts = {}) => validatePersona({ kind: 'custom', name, avatar: avatar() }, { taken: new Set(), ...opts })

test('names made of invisible or filler characters are rejected: Hangul fillers, Braille blank, a single letter among blanks', () => {
  for (const blank of ['ㅤㅤ', 'ᅠᅠ', 'ﾠﾠ', '⠀⠀a', '⠀⠀', '​‍⁠', '͏͏', '️️', 'aㅤ', '  ㅤ b']) {
    const r = custom(blank)
    assert.deepEqual([r.ok, r.status], [false, 400], JSON.stringify(blank))
  }
  assert.equal(custom('ㅤAㅤB').ok, true, 'two real letters survive the fillers')
  assert.equal(custom('ㅤAㅤB').persona.name, 'AB')
})

test('invisible marks and look-alikes collide with the plain name (nameKey)', () => {
  const taken = new Set(['Jason'])
  const dupes = [
    'Jason͏', 'Jason️', 'Ja​son', 'Jаson' /* Cyrillic a */, 'Jаsоn', 'JASON', 'ｊａｓｏｎ', 'Jаѕon' /* Cyrillic a, s */,
    'Jasoń́́', // marks stacked on the n
    '⠀Jason',
  ]
  for (const d of dupes) {
    const r = custom(d, { taken })
    assert.deepEqual([r.ok, r.status], [false, 409], JSON.stringify(d))
  }
  assert.equal(custom('Jasoı', { taken: new Set(['Jasoi']) }).status, 409, 'dotless i folds to i')
  assert.equal(custom('İvan', { taken: new Set(['ivan']) }).status, 409, 'capital dotted I folds to i')
  assert.equal(custom('ıvan', { taken: new Set(['Ivan']) }).status, 409)
  assert.equal(custom('Jasoı', { taken }).ok, true, 'a different name is still a different name')
  assert.equal(nameKey('Jаson'), nameKey('Jason'))
  assert.equal(nameKey('Jason͏'), nameKey('Jason'))
  assert.equal(nameKey('Νaο'), nameKey('Nao'.replace('N', 'ν')), 'Greek nu and omicron fold')
})

test('owner-name check uses the same key: look-alikes of the owner\'s name are taken, in both kinds', () => {
  const opts = { ownerName: 'Dana Facilitator' }
  assert.equal(custom('Dаna Facilitator', opts).status, 409)
  assert.equal(custom('Dana͏ Facilitator', opts).status, 409)
  const fox = { ownerName: `${ADJECTIVES[1]} ${ANIMALS[2]}` }
  const anonName = `${ADJECTIVES[1]} ${ANIMALS[2]}`
  const r = validatePersona({ kind: 'anonymous', name: anonName, avatar: avatar() }, { taken: new Set(), ...fox })
  assert.deepEqual([r.ok, r.status], [false, 409], 'an anonymous name equal to the owner\'s name is refused')
  assert.equal(typeof r.suggestion, 'string')
  assert.notEqual(nameKey(r.suggestion), nameKey(anonName))
  assert.equal(validatePersona({ kind: 'anonymous', name: r.suggestion, avatar: avatar() }, { taken: new Set(), ...fox }).ok, true)
})

test('legitimate accents survive in the display name; Zalgo stacks and stray marks do not', () => {
  for (const ok of ['José', 'Zoë', 'Łukasz', 'Åsa', 'Renée', 'Søren', 'Nguyễn']) {
    const r = custom(ok)
    assert.equal(r.ok, true, ok)
    assert.equal(r.persona.name, ok.normalize('NFC'))
  }
  assert.equal(custom('José').persona.name, 'José', 'a decomposed accent composes')
  assert.equal(nameKey('José'), nameKey('Jose'), 'the key ignores accents, so José cannot pose as Jose')
  assert.notEqual(nameKey('Łukasz'), nameKey('Lukasz'), 'letters with no decomposition keep their identity')
  const zalgo = 'Z' + '̀́̂̃̄̅̆̇̈̉̊̋'.repeat(3) + 'oe'
  const z = custom(zalgo)
  assert.equal(z.ok, true)
  const marks = Array.from(z.persona.name).filter((c) => /\p{Mn}/u.test(c)).length
  assert.ok(marks <= 4, `kept ${marks} marks`)
  assert.equal(nameKey(zalgo), 'zoe')
  assert.equal(custom('́́ A B').persona.name, 'A B', 'marks with no base letter are dropped')
  assert.equal(custom('🎉́ Ann').persona.name, '🎉 Ann', 'and so are marks on a non-letter')
  assert.equal(custom('A⃝ B').persona.name, 'A B', 'enclosing marks go')
  assert.equal(custom('Z' + '́'.repeat(40)).ok, false, 'one visible letter is not a name')
})

test('a name needs two visible letters or digits, not one plus decoration', () => {
  assert.equal(custom('A!').ok, false)
  assert.equal(custom('🎉 A').ok, false)
  assert.equal(custom('A1').ok, true)
  assert.equal(custom('北京').ok, true)
})

// --- names in other scripts survive untouched -----------------------------------------------------------------------
const NAMES = [
  'कांत', 'हिंदी', 'ਸਿੰਘ', 'কাঁথা', 'विक्रांत', 'मांडवी', 'கார்த்திக்', 'สมชาย ใจดี', 'สวัสดี', 'محمد', 'مُحَمَّد', 'שָׁלוֹם', 'Nguyễn Văn',
  'José', 'Zoë', 'Łukasz', 'ゲン', 'ケン', 'ゲンキ', '김민준', '田中太郎', 'Ольга', 'Йован', 'Ελένη', 'Åsa', 'Ça va', 'Ana Maria',
  'می‌خواهم', 'ക്‍ഷ ശ', 'क्‍ष त्र',
]

test('names in Indic, Thai, Arabic, Hebrew, Vietnamese, Japanese, Korean and other scripts are accepted and come back UNCHANGED', () => {
  for (const name of NAMES) {
    const r = custom(name)
    assert.equal(r.ok, true, name)
    assert.equal(r.persona.name, name.normalize('NFC'), `${name} was altered`)
  }
})

test('the same names also survive as decomposed input (NFD): they come back composed, never mangled', () => {
  for (const name of ['José', 'Zoë', 'Nguyễn Văn', 'Åsa', 'ゲン', 'ケン', '김민준', 'कांत']) {
    assert.equal(custom(name.normalize('NFD')).persona.name, name.normalize('NFC'), name)
  }
})

test('spacing vowel signs (Mc) never end a cluster: the nasal mark after one stays', () => {
  assert.equal(custom('कांत').persona.name, 'कांत') // का + ं
  assert.equal(custom('मांडवी').persona.name, 'मांडवी')
  assert.equal(custom('বাঁধা').persona.name, 'বাঁধা')
  assert.equal(Array.from(custom('हिंदी').persona.name).length, Array.from('हिंदी').length)
})

test('ZWNJ/ZWJ are kept only between two letters of a joiner script, dropped everywhere else', () => {
  assert.equal(custom('می‌خواهم').persona.name, 'می‌خواهم', 'Persian ZWNJ between letters stays')
  assert.equal(custom('Jo‌hn').persona.name, 'John', 'in Latin text it goes')
  assert.equal(custom('Jo‍hn').persona.name, 'John')
  assert.equal(custom('می‌ ‌خ').persona.name, 'می خ', 'next to a space it goes')
  assert.equal(custom('می‌‌‌خ').persona.name, 'می‌خ', 'doubled joiners collapse to one at most')
  assert.equal(custom('‌می').persona.name, 'می', 'a leading one goes')
  assert.equal(custom('می‌').persona.name, 'می', 'a trailing one goes')
  assert.equal(custom('م‌ا‌').persona.name, 'م‌ا')
})

test('marks cluster by cluster: at most four per base, none without a base', () => {
  const four = 'a' + '́̂̃̄̅'
  assert.equal(Array.from(custom(four + 'b').persona.name).length, 1 + 4 + 1)
  assert.equal(custom('ःः Ab').persona.name, 'Ab')
  assert.equal(custom('Ab ा').persona.name, 'Ab')
})

test('nameKey keeps marks on non-Latin/Greek/Cyrillic bases: ケン vs ゲン and कांत vs कात are different names; Latin accents still fold', () => {
  assert.notEqual(nameKey('ケン'), nameKey('ゲン'))
  assert.notEqual(nameKey('कांत'), nameKey('कात'))
  assert.notEqual(nameKey('हिंदी'), nameKey('हिदी'))
  assert.notEqual(nameKey('ਸਿੰਘ'), nameKey('ਸਿਘ'))
  assert.notEqual(nameKey('김민준'), nameKey('김민주'))
  assert.equal(custom('ゲン', { taken: new Set(['ケン']) }).ok, true)
  assert.equal(custom('कांत', { taken: new Set(['कात']) }).ok, true)
  assert.equal(custom('कांत', { taken: new Set(['कांत']) }).status, 409)
  assert.equal(nameKey('Jose'), nameKey('José'))
  assert.equal(nameKey('Ana'), nameKey('Anà'))
  assert.equal(nameKey('Işık'), nameKey('İşik'))
  assert.equal(nameKey('Jason͏'), nameKey('Jason'))
  assert.equal(nameKey('Nguyen'), nameKey('Nguyễn'), 'Vietnamese tones on Latin letters fold (accepted)')
  assert.equal(custom('Jason͏', { taken: new Set(['Jason']) }).status, 409)
})

test('modifier letters and the tatweel are not visible letters: a name needs two real ones', () => {
  for (const bad of ['ـ' + 'ـ', 'ˆˆ', 'ˆˆˆˆ', 'ـــــ', 'ʰʰ', 'Aـ', 'Aˆ', '🎉ˆˆ']) {
    const r = custom(bad)
    assert.deepEqual([r.ok, r.status], [false, 400], JSON.stringify(bad))
  }
  assert.equal(custom('محـمد').ok, true, 'a tatweel inside a real name is fine')
  assert.equal(nameKey('محـمد'), nameKey('محمد'), 'and it does not make a different name')
  assert.equal(custom('Aˆ B').ok, true)
  assert.equal(custom('ケーキ').ok, true)
})

// --- bounded work, and modifier letters of real scripts ---------------------------------------------------------------
test('an oversized or non-string name is refused with 400 before any cleaning (no CPU amplifier)', () => {
  const huge = 'á'.repeat(512 * 1024) // 1 MB of letters with marks: the expensive case
  for (const kind of ['custom', 'anonymous']) {
    // Best of five: a busy machine slows a single run, but cannot make every one of five slow.
    let ms = Infinity
    for (let run = 0; run < 5; run++) {
      const t = process.hrtime.bigint()
      const r = validatePersona({ kind, name: huge, avatar: avatar() }, { taken: new Set(), ownerName: 'Dana' })
      ms = Math.min(ms, Number(process.hrtime.bigint() - t) / 1e6)
      assert.deepEqual([r.ok, r.status], [false, 400], kind)
    }
    assert.ok(ms < 50, `${kind}: took ${ms} ms`)
  }
  for (const bad of [5, null, undefined, {}, ['Ann'], true]) assert.equal(validatePersona({ kind: 'custom', name: bad, avatar: avatar() }).status, 400)
  assert.equal(validatePersona({ kind: 'custom', name: 'x'.repeat(257), avatar: avatar() }).status, 400)
})

test('a 256-character name is still cleaned, then judged by the 2-24 rule; 24 characters pass', () => {
  const blanks = '​'.repeat(240)
  assert.equal(custom(`Ann${blanks}Lee`.slice(0, 256)).persona.name, 'AnnLee', 'a long run of invisible characters is cleaned away and the name accepted')
  assert.equal(custom('x'.repeat(256)).status, 400, 'too long after cleaning')
  assert.equal(custom('x'.repeat(24)).ok, true)
  assert.equal(custom('x'.repeat(25)).status, 400)
})

test('modifier letters of real scripts count as visible; Latin/IPA modifiers and the tatweel still do not', () => {
  for (const ok of ['リー', 'ケーキ', 'ーア', 'ๆๆก', 'กๆ', 'ゝあ']) assert.equal(custom(ok).ok, true, ok)
  for (const bad of ['ــ', 'ˆˆ', 'ʰʰ', 'Aـ', 'Aˆ', 'ᴬᴮ', 'ꜛꜛ', 'ⁱⁱ']) assert.equal(custom(bad).status, 400, bad)
  assert.equal(custom('Aˆ B').ok, true)
})
