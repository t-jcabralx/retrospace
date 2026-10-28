// Server-only (node:crypto). Never import from client code.
import { createHash } from 'node:crypto'

export const hashKey = (key) => createHash('sha256').update(String(key)).digest('hex')
