// A stand-in presence store for when there is none (no realtime): the components can always call their hooks.
const EMPTY = []
export const NO_PRESENCE = { subscribe: () => () => {}, getPeers: () => EMPTY, getCursors: () => EMPTY, getSelections: () => EMPTY, hasPeers: () => false }
