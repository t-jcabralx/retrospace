# Encrypted data in the database, with a per-record flag

Amendment G to `2026-10-28-kudo-mural-design.md`. Status: **proposed, awaiting approval**.

## Goal

Nothing a person typed into Retrospace is readable in the database (Atlas viewer, a dump, a backup, a support engineer). Records that already exist keep working, so every record carries a flag saying whether it is encrypted yet.

## What "only the frontend can see it" can mean

| | A. Field encryption on our server (recommended) | B. End-to-end encryption in the browsers |
|---|---|---|
| The database holds | Ciphertext only | Ciphertext only |
| Who holds the key | The app (an environment secret, `DATA_ENCRYPTION_KEY`) | Only the board's members (a key in the share link after `#`) |
| Can our server read the data | Yes, while serving a request (it decrypts, then sends plain data to the page) | No, never |
| A database leak, an Atlas login, a stolen backup | Reveals nothing | Reveals nothing |
| A leak of the server's key plus the database | Reveals everything | Reveals nothing |
| Keeps working | Everything: AI summary, exports, anonymity rules, wall milestones, CSV, search of names, server-side limits | Loses AI summary, server-side exports and checks on content, and any "forgot the link, lost the board" recovery |
| Effort | Medium | Very large (a second rewrite of every feature) |

Recommendation: **A now**, and keep B as a later, per-board option for the few clients who need "not even Retrospace can read it".

## How A works

- **Envelope keys.** One master key from the environment never touches the database. Each board gets its own random data key, stored in the board record wrapped (encrypted) by the master key. A leaked database therefore holds only wrapped keys and ciphertext. A board's data can be re-keyed or deleted by destroying its key.
- **Cipher.** AES-256-GCM (Node `crypto`), a fresh 96-bit nonce for every value, and the collection, document id and field name bound in as authenticated data, so a ciphertext copied into another record or field fails to open.
- **What is encrypted** (everything a person wrote), and what stays plain (what the app must query or order by):

| Collection | Encrypted | Plain (queries, ordering, limits) |
|---|---|---|
| boards | title, recipient, summary text, themes suggestions, wheel (people, prizes, history), retro column labels | code, type, template, owner id, status and lock flags, timestamps, counters, hashes |
| items | `data` (text, GIF and image links, shout-outs), author name and avatar | board code, id, kind, position and size, deleted flag, timestamps, author uid, votes |
| participants and people | display name, avatar, birthday, notes | board code, uid, kind, timestamps |
| users | name, email | id, password hash, timestamps |
| templates | name, columns | owner id, id |

- **Blind indexes** keep the unique rules working without exposing the values: the account email and each board's participant names are indexed by a keyed hash (`HMAC-SHA-256` of the normalised value with a separate key derived from the master), so "this email already exists" and "that name is taken on this board" still work, and the database holds no readable email or name.
- **One place in the code.** The change lives in the store layer (`src/lib/store.js` and a new `src/lib/seal.js`): every write seals, every read opens. Routes, rules and screens do not change.

## The flag

Every sealed document carries `enc: { v: 1, kid: 'k1' }` (format version and master key id). Reads:

- `enc` present: open the encrypted fields, return a normal document.
- `enc` absent: a legacy plaintext record, returned as it is.

Writes always seal and set `enc`, so a legacy record becomes encrypted the next time anyone changes it. A backfill script finishes the job for the rest:

```
node scripts/encrypt-backfill.mjs            # dry run: counts per collection, nothing written
node scripts/encrypt-backfill.mjs --apply    # seals in small batches, resumable, verifies each record by opening it again
```

The dry run prints "encrypted 1,204, not yet 311" per collection. `/api/health` reports only whether encryption is configured, never counts. Nothing touches your live data until you run the script with `--apply`, and the script refuses to run without a backup confirmation flag.

## Keys: the part that can hurt

- The master key is 32 random bytes in `DATA_ENCRYPTION_KEY` on Vercel (and a copy in a password manager). **If it is lost, the encrypted data cannot be recovered by anyone.**
- Rotation: new `kid`, keep the old key listed for reading (`DATA_ENCRYPTION_KEYS_OLD`), re-wrap board keys with the new master; ciphertext itself is untouched, so rotation is cheap.
- With no key configured the app keeps working as today and writes plaintext (so a deployment missing the variable does not lose data), and says so in `/api/health`.

## Rollout

1. Ship the code with the key unset: nothing changes.
2. Add the key on Vercel and redeploy: new and changed records are encrypted, old ones still read.
3. Take a database backup, run the dry run, then `--apply`.
4. Check the counts, then remove the plaintext fallback only if you want a hard guarantee (a setting that refuses to read an unflagged record).

## Testing

Unit tests for seal and open (tamper, wrong key, moved ciphertext, nonce uniqueness, rotation); the full existing suite run once with encryption on against the memory store and once against a throwaway Mongo database (guarded, ask first); blind-index uniqueness tests; a backfill test on a mixed collection (legacy and sealed side by side, resumable after an interruption).

## Decisions needed

1. A (server-side field encryption, recommended) or B (end-to-end)?
2. Is the list of encrypted fields right, in particular names and emails?
3. Do you want the backfill to run only from a command you start (recommended), or automatically over time as records are read?
