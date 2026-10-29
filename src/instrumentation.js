// Next.js calls this for every error thrown while serving a request. With ERROR_WEBHOOK_URL set, it posts a short message
// (see lib/alert.js); without it, nothing happens beyond Next's own logging.
let alerter
export async function onRequestError(err, request) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const url = (process.env.ERROR_WEBHOOK_URL ?? '').trim().replace(/^["']|["']$/g, '')
  if (!url) return
  alerter ??= (await import('./lib/alert.js')).createAlerter({ url })
  await alerter(err, request)
}
