// The address of a board's print / Save-as-PDF page. The code is encoded; nothing else goes in the URL.
export const printHref = (code) => `/b/${encodeURIComponent(code)}/print`
