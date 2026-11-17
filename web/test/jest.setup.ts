// Provides the browser globals the production code touches when run under
// jest's `node` test environment (no jsdom installed).

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
}

const g = globalThis as any

g.localStorage = new MemoryStorage()
g.window = g.window || {}
g.window.localStorage = g.localStorage
g.window.location = g.window.location || { protocol: 'http:', search: '' }

// react-dom/react-test-renderer's scheduler takes its browser branch when
// `window` exists; give it the timing globals it reads at module load.
g.window.performance = g.window.performance || { now: () => Date.now() }
g.requestAnimationFrame =
  g.requestAnimationFrame || ((fn: () => void) => setTimeout(fn, 0))
g.cancelAnimationFrame =
  g.cancelAnimationFrame || ((id: number) => clearTimeout(id))
g.window.requestAnimationFrame = g.requestAnimationFrame
g.window.cancelAnimationFrame = g.cancelAnimationFrame
