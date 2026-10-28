# Stream C: owner tools and exports (Task 17)

Participant removal with bans, PNG export, owner-only CSV export. Everything below is also summarised in
`.superpowers/sdd/2026-10-28-kudo-mural/stream-C-report.md`.

## Remove a participant

- `DELETE /api/boards/[code]/participants/[id]?items=1|0` (owner only, same-origin; `[id]` is the per-board PUBLIC id).
  The row is deleted (the persona name is free again), the id joins `board.bans` (owner-only, never in any view, capped at
  500 -> 409), and with `items=1` the person's live items are tombstoned exactly like a normal delete (data, votes and
  reactions stripped, `updatedAt` strictly increasing above `board.lastTs`). The owner cannot remove themselves (400) or an
  account row (400). Unknown id: 404 unless it is already banned (then the call is an idempotent retry).
- `authorize()` throws `403 You were removed from this board` for a guest whose public id is banned, on every route that
  authorizes (snapshot, ops, persona, since, reveal, rt/join, rt/stream); the owner is exempt. `/api/rt/send` checks the ban too.
- Two envelopes go out on the board channel: an `ops` envelope with the tombstones (only with `items=1`) and
  `{ t:'kicked', from:<owner public id>, id:<removed public id> }`. Clients whose own id equals `id` stop syncing and show the
  "removed" panel; the others drop the person from the people list.
- `GET /api/boards/[code]/participants` (owner only) is the live people list used by the settings drawer's People section.
- Limit: a banned BROWSER can return with a new browser identity (clearing cookies). Combine removal with a passcode change or
  a revoke. An already open stream of a modified client is not cut server-side until its stream deadline (5 minutes) and
  re-authorization; a stock client leaves at once.

## CSV export

`GET /api/boards/[code]/export?format=csv[&authors=1]`: owner only, `no-store`, attachment, 10 per minute per owner. UTF-8 with
BOM, CRLF, RFC 4180 quoting, a cell starting with `= + - @ TAB CR` gets a leading `'`, control/zero-width/bidi characters
are stripped. Columns `Board,Type,Category,Item,Kind,Votes,Color,Created,Author` (Author only with `authors=1`: persona names
only, never ids). Categories come from `categorizeRaw` (`src/lib/ai/input.js`); a shared summary is a trailing `Summary` row, a
draft is never exported. Items carry no creation stamp, so `Created` is the item's last write (`updatedAt`).

## PNG export

`src/ui/exportPng.js` renders a CLONE of the world layer (cursors, peer selections, handles, drafts and editors cut) in an
off-screen host inside the board screen, at 2x capped to 4096 px on the long side, with a neutral placeholder for pictures that
cannot be read. `ExportMenu` (top bar) offers PNG for everyone, CSV (+ "Include author names", off by default) for the owner,
and renders "Print / Save as PDF" only when a `printHref` prop is passed (Task 18; currently not passed).
