# Stream F: staged Retro workflow

Owner-driven, server-enforced stages for `retro` boards. Boards without `board.retro` (older ones) behave exactly as before.

- State machine and rules: `src/lib/retro.js` (`defaultRetro`, `validateRetroConfig`, `applyRetroAction`, `timerState`, `retroEffects`, `retroAllows`, `rankTopics`, `topicOf`).
- Only the owner changes it: `PATCH /api/boards/:code` with `{ patch: { retro: { type: 'next' } } }`. Actions: start, next, prev, goto, pause, resume, extend, setEditing, config, topic. Strict whitelist in `boardPatch.js`; each change bumps `rev` and is broadcast in the guest-safe board envelope (`retro` holds nothing secret).
- Stage effects: entering Vote opens `board.vote` with `votesPerPerson`, leaving closes it; the shared `board.timer` follows the stage timer.
- `planOps` rejects, for non-owners: content kinds outside Collect-with-editing ("This stage is closed for notes"), votes outside Vote ("Voting is not open"), `action` items outside Actions ("Actions are not open yet") or past `maxActions` ("Action limit reached"), theme/topic items ("Only the facilitator can change this"). The owner is exempt; reactions are always allowed.
- `action` items: `validate.js` (`checkAction`), `items/ActionCard.jsx`, `ActionComposer.jsx`.
- UI: `RetroStage.jsx` (mounted by BoardScreen only when `board.type==='retro' && board.retro`) -> `StageHeader`, `FacilitatorBar` (owner), `StagePanel` -> `DiscussPanel` / `ActionComposer`; `settings/StagesSection.jsx` in the settings drawer; styles in `retro.css`.
- Sim: `node scripts/sim-retro.mjs [baseUrl]` against a fresh server (not run in this stream: no servers allowed).
