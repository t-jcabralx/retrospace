# Stream E: AI theme grouping and print / Save as PDF

## Theme grouping (retro boards, owner only)
- `POST /api/boards/[code]/themes` asks the provider (`suggestThemes`, next to `summarize`) to group the notes; `GET` reads the stored suggestions; `PATCH { edit: 'rename' | 'combine' | 'split' | 'dismiss', ... }` edits them. All owner-only.
- Prompt: only short ids (`n1...n200`, mapping kept server-side) plus note text and column name, inside `<board_content>` as data. No item ids, authors or signers.
- The reply is validated by `src/lib/ai/themes.js`: at most 12 themes, titles 1-60 control-stripped characters, unknown ids dropped, a note in at most one theme, leftovers stay ungrouped. Unusable JSON gets one retry inside the same slot, then a friendly error.
- Limits (decision): their own counters (`aithm:b:<code>` 5 per hour, `aithm:u:<owner>` 40 per day), NOT shared with summaries. Refund policy as for summaries: a slot is returned only when nothing was billed.
- No `temperature` is ever sent. `AI_FAKE=1` returns one deterministic theme per column (never in production).
- `board.themeSuggestions` / `themesState` / `themesStartedAt` are owner-only: removed by `stripBoard`, `guestAiView` INTERNAL and absent from `/since`, the broadcast and reveal (asserted by serialized bytes in tests).
- Accepting a suggestion adds a normal `theme` item (`{ title <= 60, noteIds <= 50 }`) through the ops path; themes are allowed on retro boards and votable (only frames and connectors are not votable). `Theme.jsx` lists linked notes by id and skips deleted ones.
- No new AI settings key: the feature needs `ai.enabled` and the acknowledgement, like summaries (so `boardPatch.js` is unchanged).

## Print / Save as PDF
- No PDF library. `/b/[code]/print` draws the board as a document from the board API's one snapshot (client-rendered after the snapshot; the content is NOT server-rendered, so it needs JavaScript) and the button calls `window.print()`. `src/ui/print.css` has the `@media print` rules (A4/Letter, page breaks, no chrome).
- Same visibility rules as the board (revoked, passcode, removed, no drafts for guests). Authors are excluded by default; the owner can toggle "Include author names".
- `buildPrintModel(board, items, participants, options)` in `src/lib/printModel.js` is pure and tested; `printHref(code)` in `src/ui/printLink.js`, `PrintLink.jsx`, and `ExportMenu` shows the item when given a `printHref` prop.
