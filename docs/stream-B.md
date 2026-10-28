# Stream B: configurable columns and saved templates (Task 17B)

The Retro (and Workshop) columns are no longer limited to the built-in layouts. README wording is below; the README
itself is untouched by this stream, so the merger can paste it.

## Behaviour

| Area | Rule |
|---|---|
| Column model | `src/lib/columns.js`: 1 to 8 columns, each `{ title, emoji? }`. Title 1 to 40 characters (counted as characters, not code units), control / bidi / zero-width characters replaced by a space and whitespace collapsed. Emoji: empty or exactly one emoji (`isSingleEmoji`). Duplicate titles are allowed. Only `title` and `emoji` are kept. |
| On the board | A column is a frame item with `data: { title, col: true }`; the emoji is written in front of the title text (`"🚀 Start"`), so the canvas needs no special drawing and old boards need no migration. `layoutColumns` produces `starter-col-<n>` frames (default 360 x 640, gap 24, top 140). |
| Create board | `POST /api/boards` accepts `columns` (retro and the workshop templates that have frames: retro, brainstorm, swot), `header` (retro starter text, default "Add notes to each column, then vote.", up to 120 characters, an ordinary text item) and `votes` (retro, 1 to 20, default 3). For other templates they are ignored, not stored. Invalid values are a 400 and nothing is created. Without them the built-in layout is created exactly as before (except that retro frames now carry `col: true` and the id prefix `starter-col-`). |
| New-board dialog | A "Set up the columns" step appears after the template step for templates with columns: editable list (rename, emoji with quick picks, move up/down buttons, drag handle with Arrow keys or mouse drag, remove, add up to 8), "Reset to template", "Blank (3 empty columns)", live mini preview, "My templates" and "Save these columns as a template". The details step offers "Votes per person" for retro. |
| Settings → Columns | Owner only, retro and workshop boards. Rename and emoji (saved on blur / Enter / pick), move left / right (the notes fully inside a column travel with it; one undo step), remove (confirm: "Notes inside stay on the board"), add (appended right of the last column, same size, behind everything). All of it is ordinary `update` / `add` / `delete` ops through `ctl.local`, so undo, live sync, presence and permissions behave as for any edit. Frames drawn with the frame tool are not columns until "Use as column" (and can go back to free frames). Note: data patches merge key by key, so "free frame" sets `col: false`. |
| Saved templates | `GET /api/templates`, `POST /api/templates`, `DELETE /api/templates/<id>`. Session required (401), JSON + same-origin on writes (415 / 403), 30 calls a minute per account (429), at most 30 templates per account (409), unique name per account ignoring case (409), `type` retro or workshop, columns validated with `validateColumns`. Public shape `{ id, name, type, columns, createdAt }` (never `ownerId`). Someone else's or an unknown id on DELETE is the same 404. |
| Stores | Memory and Mongo have `createTemplate`, `listTemplates(ownerId)`, `deleteTemplate(ownerId, id)`. Mongo collection `templates` with indexes `{ownerId, createdAt: -1}`, unique `{ownerId, nameLower}` and unique `{id}`, created lazily once per client (separate from `ensureIndexes`, to leave that shared function alone). |

## README wording

> **Configurable columns.** When you create a Retro board (or a Workshop board from a template with columns) a "Set up the
> columns" step lets you rename the columns, give each an emoji, reorder them, remove them and add up to eight, with a live
> preview. Owners can change the columns later in Settings → Columns, and save a set of columns as a personal template
> ("My templates", up to 30) to start the next board from it.

## Not done / decisions

- No "Kanban" workshop template was added: `test/templates.test.mjs` pins the workshop keys, and Stream A may touch the same list. Brainstorm, Retrospective and SWOT already take custom columns, and "Blank (3 empty columns)" is a button in the editor.
- The built-in workshop template frames are not flagged `col: true` (existing boards are not migrated either); use "Use as column" in Settings → Columns.
- Titles are cleaned of zero-width characters, so a ZWJ emoji typed into a title (rather than the emoji field) falls apart into separate emoji with spaces. Use the emoji field.
- The 30-templates cap is a count-then-insert, not atomic; two simultaneous saves by one account could pass 30 by one.
