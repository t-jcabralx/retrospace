// One branded layout for every email Retrospace sends. Pure: data in, { html, text } out. Email clients are stuck in 2008, so it is
// a table layout with inline styles (the only thing every client honours), plus a <style> block for what the better clients add:
// dark mode and small screens. Images are optional decoration (the wordmark is text), and every piece of text a person typed
// goes through escapeHtml.
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const ACCENT = '#5b5bf0'
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

// A paragraph given as a string is plain; { quote: 'text' } is a boxed quotation that keeps its line breaks.
const para = (p) => (typeof p === 'string'
  ? `<p class="p" style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#3a3d4d">${escapeHtml(p)}</p>`
  : `<div class="quote" style="margin:0 0 20px;padding:14px 16px;border-left:4px solid ${ACCENT};background:#f4f5fb;border-radius:0 10px 10px 0;font-size:16px;line-height:1.6;color:#20222e;white-space:pre-wrap;word-break:break-word">${escapeHtml(p.quote)}</div>`)

const paraText = (p) => (typeof p === 'string' ? p : p.quote.split('\n').map((l) => `> ${l}`).join('\n'))

// options:
//   origin      the site's address (for the logo and the footer links), or null
//   preheader   the grey line some inboxes show after the subject
//   title       the headline
//   paragraphs  [string | { quote }] in order
//   button      { label, url } or null
//   note        a small boxed reminder under the button, or null
//   fallback    true: print the button's link in full underneath (for clients that block buttons)
//   after       [string] more paragraphs after the button
//   footer      the one sentence that says why this email arrived
export function renderEmail({ origin = null, preheader = '', title, paragraphs = [], button = null, note = null, fallback = false, after = [], footer = '' }) {
  const logo = origin ? `<img src="${escapeHtml(origin)}/apple-icon" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px">` : ''
  const links = origin
    ? `<a href="${escapeHtml(origin)}" style="color:${ACCENT};text-decoration:none">Retrospace</a> &nbsp;·&nbsp; <a href="${escapeHtml(origin)}/issue" style="color:${ACCENT};text-decoration:none">Report an issue</a>`
    : 'Retrospace'
  const btn = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px"><tr><td align="center" bgcolor="${ACCENT}" style="border-radius:10px"><a class="btn" href="${escapeHtml(button.url)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:700;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:10px;background:${ACCENT}">${escapeHtml(button.label)}</a></td></tr></table>`
    : ''
  const noteBox = note ? `<div class="note" style="margin:0 0 20px;padding:12px 14px;background:#f4f5fb;border-radius:10px;font-size:14px;line-height:1.5;color:#4a4d5e">${escapeHtml(note)}</div>` : ''
  const fb = button && fallback
    ? `<p class="muted" style="margin:0 0 20px;font-size:13px;line-height:1.5;color:#6b6e80">Button not working? Copy this link into your browser:<br><a href="${escapeHtml(button.url)}" style="color:${ACCENT};word-break:break-all">${escapeHtml(button.url)}</a></p>`
    : ''

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(title)}</title>
<style>
  @media (max-width: 520px) { .pad { padding: 24px 20px !important } .btn { display: block !important; text-align: center !important } .h1 { font-size: 22px !important } }
  @media (prefers-color-scheme: dark) {
    .bg { background: #0f111a !important }
    .card { background: #171a26 !important; border-color: #262a3b !important }
    .head { background: #171a26 !important }
    .rule { border-color: #262a3b !important }
    .word, .h1 { color: #f3f4fb !important }
    .p { color: #c4c7d8 !important }
    .quote, .note { background: #1f2333 !important; color: #dfe1ee !important }
    .muted, .foot { color: #8f93a8 !important }
  }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:#f4f5fb;font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(preheader)}${'&zwnj;&nbsp;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" style="background:#f4f5fb"><tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="card" style="max-width:560px;background:#ffffff;border:1px solid #e6e8f2;border-radius:16px;overflow:hidden">
    <tr><td class="head" bgcolor="#ffffff" style="background:#ffffff;border-top:6px solid ${ACCENT};padding:20px 28px 4px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        ${logo ? `<td style="padding-right:12px;vertical-align:middle">${logo}</td>` : ''}
        <td style="vertical-align:middle;font-family:${FONT};font-size:20px;font-weight:700;letter-spacing:-0.01em;color:#14161f" class="word">Retrospace</td>
      </tr></table>
    </td></tr>
    <tr><td class="pad" style="padding:32px 28px 12px;font-family:${FONT}">
      <h1 class="h1" style="margin:0 0 18px;font-size:26px;line-height:1.2;letter-spacing:-0.02em;color:#14161f">${escapeHtml(title)}</h1>
      ${paragraphs.map(para).join('\n      ')}
      ${btn}
      ${noteBox}
      ${fb}
      ${after.map(para).join('\n      ')}
    </td></tr>
    <tr><td class="pad" style="padding:8px 28px 28px;font-family:${FONT}">
      <div class="rule" style="border-top:1px solid #e6e8f2;padding-top:18px"></div>
      ${footer ? `<p class="foot" style="margin:0 0 8px;font-size:12.5px;line-height:1.5;color:#7a7d90">${escapeHtml(footer)}</p>` : ''}
      <p class="foot" style="margin:0;font-size:12.5px;line-height:1.5;color:#7a7d90">${links}</p>
    </td></tr>
  </table>
</td></tr></table>
</body>
</html>`

  const text = [
    title,
    '',
    ...paragraphs.map(paraText),
    ...(button ? ['', `${button.label}: ${button.url}`] : []),
    ...(note ? ['', note] : []),
    ...(after.length ? ['', ...after.map(paraText)] : []),
    '',
    '--',
    ...(footer ? [footer] : []),
    origin ? `Retrospace: ${origin}  |  Report an issue: ${origin}/issue` : 'Retrospace',
    '',
  ].join('\n')

  return { html, text }
}
