// What the board UI offers, derived from the same rules the server enforces (plan.js kinds, retro.js stages), so
// guests are not handed tools that every use of would be refused. The server stays the authority.
import { allowedKinds } from './plan.js'
import { retroAllows } from './retro.js'

export const NOTES_CLOSED = 'Notes are closed in this stage'
const TOOL_KIND = { note: 'note', text: 'text', shape: 'shape', connector: 'connector', frame: 'frame', image: 'image' } // toolbar tool -> item kind

// Is this toolbar tool meaningful on this board type? (Select always is.)
export const toolAllowed = (type, toolId) => toolId === 'select' || allowedKinds(type).includes(TOOL_KIND[toolId])

const as = (isOwner) => ({ isOwner: Boolean(isOwner) })
// May this viewer add notes (and the other canvas content) right now? Only a retro stage can say no.
export const notesOpen = (board, isOwner) => retroAllows(board, { op: 'add' }, { kind: 'note' }, as(isOwner)).ok
// May this viewer change (move, edit, delete) this item right now, as far as the stage goes?
export const stageAllowsEdit = (board, item, isOwner) => retroAllows(board, { op: 'update' }, item, as(isOwner)).ok
// Are vote buttons meaningful for this viewer? Outside the Vote stage a guest's vote is refused.
export const voteStageOpen = (board, isOwner) => retroAllows(board, { op: 'vote' }, undefined, as(isOwner)).ok
