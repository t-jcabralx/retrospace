// A WebSocket that looks like the EventSource the sync module already uses (addEventListener 'open' / 'error' / 'message',
// readyState, close), plus send() for the live messages. Once it has worked, a dropped connection is retried a few times with the same ticket;
// when the server says the ticket is used up (close code 4001, or any code from 4000 up), or it keeps failing, or it never opened at all, it
// reports CLOSED (readyState 2) so the sync module asks the website for a new ticket (or falls back to the plain stream).
const CONNECTING = 0
const OPEN = 1
const CLOSED = 2
export const MAX_QUICK_RETRIES = 3

export function createWsStream({ WebSocketImpl = globalThis.WebSocket, timers = { setTimeout: (...a) => globalThis.setTimeout(...a), clearTimeout: (...a) => globalThis.clearTimeout(...a) } } = {}) {
  return class WsStream {
    constructor(url) {
      this.url = url
      this.readyState = CONNECTING
      this.everOpened = false
      this.isWebSocket = true
      this.listeners = { open: [], error: [], message: [] }
      this.attempt = 0
      this.timer = null
      this.ws = null
      this.connect()
    }

    addEventListener(type, fn) { this.listeners[type]?.push(fn) }
    emit(type, event = {}) { for (const fn of [...this.listeners[type]]) fn(event) }

    connect() {
      let ws
      try { ws = new WebSocketImpl(this.url) } catch { return this.giveUp() }
      this.ws = ws
      ws.onopen = () => {
        if (this.ws !== ws) return
        this.attempt = 0
        this.everOpened = true
        this.readyState = OPEN
        this.emit('open')
      }
      ws.onmessage = (e) => { if (this.ws === ws && typeof e.data === 'string') this.emit('message', { data: e.data }) }
      ws.onerror = () => {} // a close always follows
      ws.onclose = (e) => {
        if (this.ws !== ws || this.readyState === CLOSED) return
        // A connection that never opened is not a blip: nothing is listening (or this address cannot do WebSockets). Give up at once so the page
        // switches to the plain stream straight away. Retrying is only for a connection that worked and was dropped.
        if (!this.everOpened || (e?.code ?? 0) >= 4000 || this.attempt >= MAX_QUICK_RETRIES) return this.giveUp()
        this.readyState = CONNECTING
        this.emit('error')
        this.timer = timers.setTimeout(() => { this.timer = null; this.attempt++; this.connect() }, Math.min(4000, 400 * 2 ** this.attempt))
      }
    }

    giveUp() {
      if (this.readyState === CLOSED) return
      this.readyState = CLOSED
      this.emit('error')
    }

    // -> true when the text was handed to an open connection.
    send(text) {
      if (this.readyState !== OPEN || !this.ws) return false
      try { this.ws.send(text); return true } catch { return false }
    }

    close() {
      this.readyState = CLOSED
      if (this.timer !== null) timers.clearTimeout(this.timer)
      this.timer = null
      const ws = this.ws
      this.ws = null
      try { ws?.close(1000) } catch { /* already closed */ }
    }
  }
}
