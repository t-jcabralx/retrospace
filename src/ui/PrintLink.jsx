import { printHref } from './printLink.js'

// A plain link to the print view that opens in a new tab. Stands alone so it can be placed anywhere.
export default function PrintLink({ code, className = 'bd-sbtn', children = 'Print / Save as PDF' }) {
  return <a className={className} href={printHref(code)} target="_blank" rel="noopener">{children}</a>
}
