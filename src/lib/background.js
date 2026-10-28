// Runs work after the response has gone out (Next's after()), so a slow call never holds up the request that caused it.
// next/server is loaded on demand: plain Node (the tests) cannot resolve it, and they install their own runner instead.
let runner = null

export function setBackgroundRunner(fn) {
  runner = fn
}

export async function runAfter(task) {
  if (runner) return runner(task)
  const { after } = await import('next/server')
  after(task)
}
