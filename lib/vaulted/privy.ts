/**
 * The one piece of Privy configuration the browser is allowed to know.
 *
 * An app id is a public identifier — it names the app to Privy and nothing more. The app secret is
 * read only on the server, in `server/privy.ts`, and must never be given a NEXT_PUBLIC_ name.
 *
 * Read through a literal `process.env.X` rather than a computed key: Next inlines these at build
 * time by static substitution, and a dynamic lookup would silently become undefined in the browser.
 * That also means the app id must be present when the app is *built*, not only when it runs.
 */

/** Privy app ids are exactly this long, and its SDK throws on init if they are not. */
export const PRIVY_APP_ID_LENGTH = 25

const configured = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || null

/**
 * Null unless a well-formed app id is configured.
 *
 * The length is checked here rather than left to the SDK on purpose: the SDK throws while the
 * provider mounts, which during `next build` surfaces as a prerender failure on an unrelated page.
 * Catching it here turns a mistyped variable into a deployment that says what is wrong.
 */
export const PRIVY_APP_ID = configured && configured.length === PRIVY_APP_ID_LENGTH ? configured : null

/** A value was set, but it cannot be a Privy app id. Worth saying out loud rather than ignoring. */
export const PRIVY_APP_ID_MALFORMED = Boolean(configured) && PRIVY_APP_ID === null
