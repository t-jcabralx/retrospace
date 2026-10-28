// Sign-in and sign-up form rules. They run in the browser for instant feedback and mirror validate.js, which is the
// only place they are enforced. Pure and browser-safe.
import { stripControl } from './ids.js'
import { waitText } from './code.js'
import { checkEmail, MAX_NAME, MIN_PASSWORD, MAX_PASSWORD } from './validate.js'

export const RULE_TEXT = {
  name: `Up to ${MAX_NAME} characters`,
  password: `${MIN_PASSWORD} to ${MAX_PASSWORD} characters`,
}

// -> { name?, email?, password? }: a friendly message per field that fails. Login only needs the two basics.
export function checkAuth(mode, { name = '', email = '', password = '' }) {
  const errors = {}
  if (mode === 'register') {
    const clean = stripControl(String(name))
    if (!clean) errors.name = 'Enter your name'
    else if (Array.from(clean).length > MAX_NAME) errors.name = `Names can be up to ${MAX_NAME} characters`
  }
  if (!String(email).trim()) errors.email = 'Enter your email address'
  else if (!checkEmail(email).ok) errors.email = 'Enter a valid email address, like name@example.com'
  if (mode === 'register') {
    if (!password) errors.password = 'Choose a password'
    else if (password.length < MIN_PASSWORD) errors.password = `Use at least ${MIN_PASSWORD} characters`
    else if (password.length > MAX_PASSWORD) errors.password = `Use at most ${MAX_PASSWORD} characters`
  } else if (!password) {
    errors.password = 'Enter your password'
  } else if (password.length > MAX_PASSWORD) {
    errors.password = 'That password is too long'
  }
  return errors
}



// status 0 = the request never got an answer. -> { text, link? } for the form's alert area.
export function authMessage(mode, status, retryAfter = null, serverError = '') {
  if (status === 409) return { text: 'That email is already registered — ', link: { href: '/login', label: 'sign in instead' } }
  if (status === 401) return { text: 'Invalid email or password' }
  if (status === 429) return { text: `Too many attempts — ${waitText(retryAfter)} and try again` }
  if (status === 0) return { text: 'Couldn’t reach the server. Check your connection and try again.' }
  if (status === 400 && serverError) return { text: serverError[0].toUpperCase() + serverError.slice(1) }
  if (status === 403) return { text: 'Your browser blocked this request. Reload the page and try again.' }
  return { text: 'Something went wrong. Please try again.' }
}
