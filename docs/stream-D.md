# Stream D: Team wall

A `wall` board (template `team`) is a long-lived recognition space.

- **Feed view (default)**: shout-outs newest first, 30 at a time ("Load more"), each with a reaction bar (the six `REACTIONS`, counts, `aria-pressed` for your own). **Canvas view**: the ordinary canvas with the same shout-outs as cards. The choice is remembered per board in `localStorage` (`km:wallview:<code>`).
- **Shout-out** item `{ toName 1-60, message 1-500, badge in BADGES, to? person id, gif? https, at? post time }`. Allowed kinds on a wall: `shoutout`, `note`, `text` (`plan.js` `ALLOWED_KINDS`). The composer offers @mention autocomplete (accent/case-insensitive, max 8), a badge picker, an optional GIF (the card composer's `GifPicker`), a live preview and a double-submit guard.
- **Rate limit**: 10 shout-out adds a minute per participant, server-side in the ops route (`src/lib/wallLimit.js`, key `shout:<code>:<public id>`, in-process fallback). The 11th is rejected with `Slow down`. Nothing is refunded.
- **Moderation**: the owner deletes any shout-out, a guest only their own (the normal item rules).
- **People are owner-only**: the snapshot sends `people` (names, birthdays, start dates) to the owner only. Guests get `GET /api/boards/[code]/people-names` -> `[{ id, name }]`, and `GET /api/boards/[code]/milestones?today=YYYY-MM-DD` -> `[{ personId, name, kind, years? }]` for the viewer's day. `today` must be a real date within one day of the server's UTC date, so a guest cannot step through the year to read birthdays. Both are read-access guarded, `no-store`, rate limited.
- **Milestone banner**: shown at the top of the wall once per day per board per browser (`km:ms:<code>:<YYYY-MM-DD>`), dismissible, announced politely; balloons for birthdays, fireworks for anniversaries through `useEffects().fire` (reduced motion is handled by the effects layer).
- **People editor** (`PeopleEditor.jsx`) in the owner's settings drawer: add/edit/remove (max 200), birthday `MM-DD` or empty, start date or empty; saves through `POST /api/boards/[code]/people`.

Files: `src/lib/wall.js` (pure rules), `src/lib/wallLimit.js`, `src/ui/{WallBody,WallFeed,ShoutoutComposer,PeopleEditor,MilestoneBanner}.jsx`, `src/ui/items/Shoutout.jsx`, `src/ui/shoutoutOps.js`, `src/ui/wall.css`, the two routes above. Tests: `test/wall-*.test.mjs`. Simulation: `node scripts/sim-wall.mjs [baseUrl]` against a fresh server.
