// Module hooks for tests that render UI components: .jsx files are compiled with the SWC binding that ships with Next,
// (so is app/error.js, which Next compiles as JSX too), CSS imports become empty modules, and `next/link` (not importable as plain ESM) is replaced by a stub anchor.
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
let bindings

export async function resolve(specifier, context, next) {
  if (specifier === 'next/link') return { url: pathToFileURL(fileURLToPath(new URL('./link-stub.mjs', import.meta.url))).href, shortCircuit: true }
  return next(specifier, context)
}

export async function load(url, context, next) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export default {}', shortCircuit: true }
  if (!url.endsWith('.jsx') && !url.endsWith('/src/app/error.js')) return next(url, context) // Next also treats a .js page file as JSX
  bindings ??= await require('next/dist/build/swc').loadBindings()
  const source = await readFile(fileURLToPath(url), 'utf8')
  const out = await bindings.transform(source, {
    filename: fileURLToPath(url),
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2022' },
    module: { type: 'es6' },
  })
  return { format: 'module', source: out.code, shortCircuit: true }
}
