// Minimal JSON-RPC client for the AD4M executor's WebSocket API.
//
// Same frames as the rig driver (~/code/acorn-ad4m/rig/ad4m.mjs):
//   request  { id, type: <method>, params }
//   reply    { id, result | error }
// Every frame that is not a reply (query-subscription-update, events) fans
// out to listeners registered with onEvent().
//
// The capability token travels in the WS URL's `?token=` query param
// (rust-executor/src/api/ws_rpc.rs). The rig executor runs with
// --insecure-no-admin-credential, so no token is needed on loopback.

type Pending = (msg: any) => void
type Listener = (msg: any) => void

export class Ad4mRpc {
  private ws: WebSocket
  private nextId = 1
  private pending = new Map<string, Pending>()
  private listeners = new Set<Listener>()

  private constructor(ws: WebSocket) {
    this.ws = ws
  }

  static connect(url: string, token?: string): Promise<Ad4mRpc> {
    const fullUrl = token
      ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(
          token
        )}`
      : url
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(fullUrl)
      const rpc = new Ad4mRpc(ws)
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.id != null && rpc.pending.has(String(msg.id))) {
          rpc.pending.get(String(msg.id))!(msg)
          rpc.pending.delete(String(msg.id))
        } else {
          for (const cb of rpc.listeners) cb(msg)
        }
      }
      ws.onopen = () => resolve(rpc)
      ws.onerror = (e) => reject(new Error(`AD4M websocket error: ${e}`))
    })
  }

  call(method: string, params: any = {}, timeoutMs = 120000): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = String(this.nextId++)
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method}: timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, (m) => {
        clearTimeout(timer)
        if (m.error) reject(new Error(`${method}: ${JSON.stringify(m.error)}`))
        else resolve(m.result)
      })
      this.ws.send(JSON.stringify({ id, type: method, params }))
    })
  }

  // Every frame that is not an rpc reply, live query updates included (they
  // bypass events.watch but only reach the socket that opened them).
  onEvent(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  close() {
    this.ws.close()
    this.listeners.clear()
  }
}
