# Stream G: anonymous notes

Per-note `anon: true` on note|text|shape|image|card items, plus the board setting `anonymousNotes` (`optional` | `always` | `never`; retro boards default to `optional`, every other type is always `never`).

## Invariant
An item with `anon: true` never reveals `authorUid`, `authorName` or `authorAvatar` to anyone, the owner included. The store keeps the real `authorUid` for permission checks (the author may edit or delete; the owner may delete). Every transport serializes items through `src/lib/anon.js`:

- `viewerItem(s)(items, { viewerId, role })`: replaces the author fields with `authorUid: 'anon'`, `authorName: 'Anonymous'`, `authorAvatar: null`, and adds `mine: true` only when `viewerId` is the real author.
- `opsEnvelopes(env)`: for the published `t:'ops'` stream. Anonymous items are sent in their own envelope with `from: 'anon'`, no `cid`, no `mine`.

Routed through it: snapshot GET, `/since`, reveal, the ops response (per viewer), the published ops envelope, votes reset (envelope), participant removal (envelope and response), CSV export (Author column = `Anonymous`, even with `authors=1`), the print model (author toggle never reveals an anonymous author). AI summary and theme inputs carry no author data (tests assert it).

Removing a participant with `items=1` leaves their anonymous notes in place: deleting exactly one person's notes would name the author.

## Rules (server, `plan.js`/`validate.js`)
- `always` forces `anon` for non-owner adds; the owner's own notes follow the owner's choice. `never` refuses `anon: true`.
- `anon` is immutable after creation (an update patch carrying `anon` is rejected). Edits keep it; duplicate and undo of a delete re-add with it.
- `validateItem` rejects `anon` on frame, connector, shoutout, action, theme.

## UI
`AnonToggle.jsx` (composer area, mounted in `Board.jsx`), the `Anonymous` badge in `ItemView.jsx`, and `Settings > Anonymous notes` (`AnonymitySection.jsx`, retro only). The client keeps `mine` across stream updates (`client/state.js`) and uses it for edit permission.

## Known limits
- A card's free-text `signer` is shown as typed; it is the author's own choice.
- `updatedAt` timing remains visible, as before.
