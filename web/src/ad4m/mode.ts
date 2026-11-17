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

// The capability token for a secured executor: `?ad4mToken=<jwt>` or
// ACORN_AD4M_TOKEN. The rig executor needs none.
export function ad4mToken(): string | undefined {
  return (
    urlParams().get('ad4mToken') || process.env.ACORN_AD4M_TOKEN || undefined
  )
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
