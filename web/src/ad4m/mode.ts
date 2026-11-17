// AD4M run mode detection. The UI runs in AD4M mode when the page URL carries
// `?ad4m=<ws url>` (e.g. `?ad4m=ws://127.0.0.1:45400/api/v1/ws`) or when the
// build-time env ACORN_AD4M_URL was set (see the DefinePlugin entries in
// webpack.dev.js / webpack.prod.js — outside jest `process.env.X` is the
// literal the plugin inlined).

function urlParams(): URLSearchParams {
  return new URLSearchParams(window.location.search)
}

export function isAd4mMode(): boolean {
  return urlParams().get('ad4m') != null || !!process.env.ACORN_AD4M_URL
}

export function ad4mUrl(): string {
  const url = urlParams().get('ad4m') || process.env.ACORN_AD4M_URL
  if (!url) {
    throw new Error('AD4M mode: no executor URL (?ad4m= or ACORN_AD4M_URL)')
  }
  return url
}

// --- the capability token -------------------------------------------------------
//
// The executor's capability token is a credential, so two rules hold:
//
// 1. It is never baked into the bundle. There is no build-time token env —
//    built output is public and a token inlined by DefinePlugin would be a
//    credential sitting in every copy of dist/.
// 2. It is only sent to the executor it was issued for. A token arrives in
//    the `#ad4mToken=` fragment (or, for compatibility, `?ad4mToken=` —
//    this fork's stand-in for ad4m-connect's capability request); we
//    remember it bound to that executor's origin and reuse it for later
//    visits to the same executor. A `?ad4m=` pointing at a different
//    origin gets NO stored token — reaching another executor needs a
//    fresh `#ad4mToken=` in the link (re-authorization).

const TOKEN_BINDINGS_KEY = 'acorn-ad4m-token-bindings'

// Credential params are matched by DECODED name: `ad4m%54oken` decodes to
// `ad4mToken`, and URLSearchParams would read it as the token — so it has
// to go under either spelling.
const CREDENTIAL_PARAMS = ['ad4mToken']

function decodedName(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** The `k=v` pieces of the URL fragment. App hash routes have no `=` and
 *  pass through as pieces that are never credential params.
 *  Supported token syntax with the app's HashRouter: `#ad4mToken=...`
 *  alone, or `#/route&ad4mToken=...` — the fragment is split on `&`, so
 *  the route must be its own piece. `#/route?ad4mToken=...` is NOT
 *  recognised: the piece's name is `route?ad4mToken`, the token is
 *  neither read nor stripped. */
function fragmentParts(): string[] {
  const raw = (window.location.hash || '').replace(/^#/, '')
  return raw.split('&').filter((kv) => kv !== '')
}

/** A token passed as `#ad4mToken=...` — the link form: a fragment is never
 *  sent to the app server in a request URL or a Referer. The `?ad4mToken=`
 *  query form still works for compatibility (and is stripped below). */
function fragmentToken(): string | undefined {
  for (const kv of fragmentParts()) {
    const eq = kv.indexOf('=')
    if (eq <= 0) continue
    if (decodedName(kv.slice(0, eq)) === 'ad4mToken') {
      const raw = kv.slice(eq + 1)
      try {
        return decodeURIComponent(raw)
      } catch {
        return raw
      }
    }
  }
  return undefined
}

/** The executor a token is bound to, normalized to scheme://host[:port]. */
function executorOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

function readBindings(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TOKEN_BINDINGS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function ad4mToken(): string | undefined {
  const url = urlParams().get('ad4m') || process.env.ACORN_AD4M_URL
  const paramToken = fragmentToken() ?? urlParams().get('ad4mToken')
  if (!url) return undefined
  const origin = executorOrigin(url)
  if (paramToken) {
    // a token in the link is an explicit authorization for this destination
    const bindings = readBindings()
    bindings[origin] = paramToken
    try {
      localStorage.setItem(TOKEN_BINDINGS_KEY, JSON.stringify(bindings))
    } catch {}
    return paramToken
  }
  return readBindings()[origin]
}

// Credential params come off the address bar once they have been read, so a
// copied/shared link never carries the capability token — from the query
// AND from the fragment, compared by decoded name.
export function stripCredentialParams() {
  const parts = (window.location.search || '')
    .replace(/^\?/, '')
    .split('&')
    .filter((kv) => kv !== '')
  const kept = parts.filter(
    (kv) => !CREDENTIAL_PARAMS.includes(decodedName(kv.split('=')[0]))
  )
  const hashParts = fragmentParts()
  const keptHash = hashParts.filter(
    (kv) => !CREDENTIAL_PARAMS.includes(decodedName(kv.split('=')[0]))
  )
  if (kept.length === parts.length && keptHash.length === hashParts.length) {
    return
  }
  const url =
    (window.location.pathname || '/') +
    (kept.length ? `?${kept.join('&')}` : '') +
    (keptHash.length ? `#${keptHash.join('&')}` : '')
  window.history.replaceState(null, '', url)
}

// The untemplated acorn language's address: `?acornLanguage=<addr>` or
// ACORN_LANGUAGE_ADDRESS at build time. createCloneCell templates it with the
// project's seed.
export function acornLanguageAddress(): string | null {
  return (
    urlParams().get('acornLanguage') ||
    process.env.ACORN_LANGUAGE_ADDRESS ||
    null
  )
}
