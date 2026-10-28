// Shared by the server rules (plan.js) and the board UI: votes each person gets when the owner has not chosen, and
// which kinds of item can be voted for (a frame only groups notes, a connector is a line and an action is a follow-up, not an idea; themes stay votable).
export const DEFAULT_PER_PERSON = 3
export const NOT_VOTABLE = ['frame', 'connector', 'action']
export const isVotable = (item) => Boolean(item) && !NOT_VOTABLE.includes(item.kind)
