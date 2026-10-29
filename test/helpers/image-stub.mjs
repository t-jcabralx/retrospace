// A stand-in for next/image in server-rendered component tests: a plain <img> without the layout props.
import { createElement } from 'react'
export default function Image({ fill, priority, sizes, quality, ...rest }) { // eslint-disable-line no-unused-vars
  return createElement('img', rest)
}
