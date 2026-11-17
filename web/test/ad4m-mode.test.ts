// Executor credentials (Lal review Part 3, P1): the capability token is
// build-time public data — it must never be inlined into the bundle — and it
// is only ever sent to the executor it was issued for. A `?ad4m=` pointing at
// a different origin gets no stored token; authorizing a different executor
// needs the token in the link again (the fork's stand-in for ad4m-connect's
// capability request). Credential params come off the address bar once read.
import fs from 'fs'
import path from 'path'
import {
  ad4mToken,
  ad4mUrl,
  isAd4mMode,
  stripCredentialParams,
} from '../src/ad4m/mode'

const g = globalThis as any

const EXEC_A = 'ws://exec-a.test:45400/api/v1/ws'
const EXEC_B = 'ws://exec-b.test:45400/api/v1/ws'

function setLocation(search: string) {
  g.window.location.search = search
  g.window.location.pathname = '/'
  g.window.location.hash = ''
}

beforeEach(() => {
  g.localStorage.clear()
  g.window.history = {
    replaceState: jest.fn((_state: any, _title: any, url: string) => {
      const q = url.indexOf('?')
      g.window.location.search = q >= 0 ? url.slice(q) : ''
    }),
  }
  setLocation('')
  delete process.env.ACORN_AD4M_URL
})

describe('bundle contents', () => {
  test('the webpack configs never inline a capability token', () => {
    for (const name of ['webpack.dev.js', 'webpack.prod.js']) {
      const src = fs.readFileSync(path.join(__dirname, '..', name), 'utf-8')
      expect(src).not.toContain('ACORN_AD4M_TOKEN')
    }
  })

  test('ad4mToken() reads no build-time token', () => {
    expect(ad4mToken.toString()).not.toContain('ACORN_AD4M_TOKEN')
  })
})

describe('ad4mToken binding', () => {
  test('a token in the link is used for its executor and reused for it', () => {
    setLocation(`?ad4m=${EXEC_A}&ad4mToken=tok-A`)
    expect(ad4mUrl()).toBe(EXEC_A)
    expect(ad4mToken()).toBe('tok-A')

    // a reload without the token in the URL still reaches the same executor
    setLocation(`?ad4m=${EXEC_A}`)
    expect(ad4mToken()).toBe('tok-A')
  })

  test('a URL override to a different origin sends no token', () => {
    setLocation(`?ad4m=${EXEC_A}&ad4mToken=tok-A`)
    expect(ad4mToken()).toBe('tok-A')

    // a link pointing the app at another executor does not leak the token
    setLocation(`?ad4m=${EXEC_B}`)
    expect(ad4mUrl()).toBe(EXEC_B)
    expect(ad4mToken()).toBeUndefined()
  })

  test('each executor keeps its own binding', () => {
    setLocation(`?ad4m=${EXEC_A}&ad4mToken=tok-A`)
    ad4mToken()
    setLocation(`?ad4m=${EXEC_B}&ad4mToken=tok-B`)
    ad4mToken()

    setLocation(`?ad4m=${EXEC_A}`)
    expect(ad4mToken()).toBe('tok-A')
    setLocation(`?ad4m=${EXEC_B}`)
    expect(ad4mToken()).toBe('tok-B')
  })

  test('the configured executor URL can be authorized too', () => {
    process.env.ACORN_AD4M_URL = EXEC_A
    setLocation('?ad4mToken=tok-A')
    expect(isAd4mMode()).toBe(true)
    expect(ad4mUrl()).toBe(EXEC_A)
    expect(ad4mToken()).toBe('tok-A')
  })

  test('no token without a destination to bind it to', () => {
    setLocation('?ad4mToken=tok-lonely')
    expect(ad4mToken()).toBeUndefined()
  })
})

describe('stripCredentialParams', () => {
  test('the token leaves the address bar; the rest of the URL stays', () => {
    setLocation(`?ad4m=${EXEC_A}&ad4mToken=tok-A&acornLanguage=lang1`)
    ad4mToken() // capture + bind before stripping

    stripCredentialParams()

    expect(g.window.history.replaceState).toHaveBeenCalledTimes(1)
    const [, , url] = g.window.history.replaceState.mock.calls[0]
    expect(url).toContain(`ad4m=${EXEC_A}`)
    expect(url).toContain('acornLanguage=lang1')
    expect(url).not.toContain('ad4mToken')
    expect(url).not.toContain('tok-A')

    // the stripped page still authenticates to the same executor
    expect(ad4mToken()).toBe('tok-A')
  })

  test('nothing to strip leaves the URL untouched', () => {
    setLocation(`?ad4m=${EXEC_A}`)
    stripCredentialParams()
    expect(g.window.history.replaceState).not.toHaveBeenCalled()
  })
})
