// Ad4mAppClient — the AppClient-shaped shim the whole UI talks through in
// AD4M mode (design §6.1). It implements exactly the six AppClient methods
// the UI calls; every Holochain interaction becomes executor JSON-RPC. The
// page never opens a Holochain connection.
//
// State: cells: cellIdString -> { uuid, lang, info } — one entry per mounted
// Acorn project (perspective uuid + templated language + info() result).
// Persisted in localStorage so a reload finds its projects; on connect the
// executor's perspective.mounts re-read drops stale entries.

import {
  AppInfo,
  CallZomeRequest,
  CellId,
  CellType,
  ClonedCell,
  CreateCloneCellRequest,
  DisableCloneCellRequest,
  decodeHashFromBase64,
  encodeHashToBase64,
} from '@holochain/client'
import { Ad4mRpc } from './rpc'
import { acornLanguageAddress } from './mode'
import { dispatchZomeCall, CellCtx } from './zomeTable'
import { cellIdToString } from '../utils'
import { MAIN_APP_ID, PROJECTS_ROLE_NAME } from '../holochainConfig'

const CELLS_STORAGE_KEY = 'acorn-ad4m-cells'
const AGENT_STORAGE_KEY = 'acorn-ad4m-agent'

export interface CellState extends CellCtx {
  /** the clone_id the UI was told at createCloneCell time */
  cloneId: string
  name: string
}

type SignalHandler = (signal: any) => void
type UnsubscribeFunction = () => void

export class Ad4mAppClient {
  private rpc: Ad4mRpc
  /** cellIdString -> mounted project */
  cells = new Map<string, CellState>()
  /** the conductor's shared agent key (all language cells use it); a
   *  39-byte zero key until a cell's info() teaches us the real one */
  agentPubKey: Uint8Array
  private signalHandlers = new Set<SignalHandler>()
  private agentKeyListeners = new Set<(key: Uint8Array) => void>()

  private constructor(rpc: Ad4mRpc) {
    this.rpc = rpc
    const savedAgent = localStorage.getItem(AGENT_STORAGE_KEY)
    this.agentPubKey = savedAgent
      ? decodeHashFromBase64(savedAgent)
      : new Uint8Array(39)
  }

  static async connect(url: string, token?: string): Promise<Ad4mAppClient> {
    const rpc = await Ad4mRpc.connect(url, token)
    const client = new Ad4mAppClient(rpc)
    await client.restoreCells()
    return client
  }

  // --- persistence --------------------------------------------------------

  private persistCells() {
    const rows = [...this.cells.entries()].map(
      ([cellIdString, { uuid, lang, info, cloneId, name }]) => ({
        cellIdString,
        uuid,
        lang,
        info,
        cloneId,
        name,
      })
    )
    localStorage.setItem(CELLS_STORAGE_KEY, JSON.stringify(rows))
  }

  private async restoreCells() {
    const raw = localStorage.getItem(CELLS_STORAGE_KEY)
    if (!raw) return
    let saved: any[] = []
    try {
      saved = JSON.parse(raw)
    } catch {
      return
    }
    let changed = false
    for (const row of saved) {
      // A cell is real only while its perspective still mounts the language —
      // drop stale entries (another executor, a deleted perspective).
      const mounts = await this.rpc
        .call('perspective.mounts', { uuid: row.uuid })
        .catch(() => null)
      if (Array.isArray(mounts) && mounts.includes(row.lang)) {
        this.cells.set(row.cellIdString, row)
        this.learnAgentKey(row.info)
      } else {
        changed = true
      }
    }
    if (changed) this.persistCells()
  }

  /** Record the conductor's shared Holochain agent key (from a cell's
   *  info().cellId[1]) so appInfo() reports it even before the next cell is
   *  created; persisted for the zero-cell boot case. */
  private learnAgentKey(info: any) {
    const b64 = info?.cellId?.[1] ?? info?.agentPubKey
    if (typeof b64 !== 'string' || !b64) return
    const prevB64 = encodeHashToBase64(this.agentPubKey)
    if (prevB64 === b64) return
    this.agentPubKey = decodeHashFromBase64(b64)
    localStorage.setItem(AGENT_STORAGE_KEY, b64)
    // A local profile stamped before the real key was known (first boot with
    // zero cells) carries the placeholder key — restamp it. The project's
    // AcornProfile entry is unaffected: the language overrides agentPubKey
    // with the real own key at create time.
    try {
      const raw = localStorage.getItem('acorn-MY_PROFILE')
      const profile = raw ? JSON.parse(raw) : null
      if (profile && profile.agentPubKey === prevB64) {
        profile.agentPubKey = b64
        localStorage.setItem('acorn-MY_PROFILE', JSON.stringify(profile))
      }
    } catch {}
    for (const cb of this.agentKeyListeners) cb(this.agentPubKey)
  }

  /** Fires once the real agent key is known (first cell seen). Used by
   *  index.tsx to refresh the redux agent-address after a first join. */
  onAgentKey(cb: (key: Uint8Array) => void): UnsubscribeFunction {
    this.agentKeyListeners.add(cb)
    return () => this.agentKeyListeners.delete(cb)
  }

  private nextCloneId(): string {
    const used = new Set([...this.cells.values()].map((c) => c.cloneId))
    let n = 0
    while (used.has(`${PROJECTS_ROLE_NAME}.${n}`)) n++
    return `${PROJECTS_ROLE_NAME}.${n}`
  }

  // --- AppClient surface ---------------------------------------------------

  async appInfo(): Promise<AppInfo> {
    const cellInfos = [...this.cells.values()].map(
      (cell) =>
        ({
          type: CellType.Cloned,
          value: {
            cell_id: [
              decodeHashFromBase64(cell.info.cellId[0]),
              decodeHashFromBase64(cell.info.cellId[1]),
            ],
            clone_id: cell.cloneId,
            original_dna_hash: decodeHashFromBase64(cell.info.cellId[0]),
            dna_modifiers: {
              network_seed: cell.info.seed,
              properties: new Uint8Array(),
            },
            name: cell.name,
            enabled: true,
          } as ClonedCell,
        } as const)
    )
    return {
      agent_pub_key: this.agentPubKey,
      installed_app_id: MAIN_APP_ID,
      cell_info: { [PROJECTS_ROLE_NAME]: cellInfos },
      status: { type: 'enabled' },
      installed_at: Date.now() * 1000,
    }
  }

  async callZome(request: CallZomeRequest): Promise<any> {
    const cell = this.cells.get(cellIdToString(request.cell_id as CellId))
    if (!cell) {
      throw new Error(
        `AD4M mode: callZome ${request.fn_name} on an unknown cell`
      )
    }
    return dispatchZomeCall(
      (m, p, t) => this.rpc.call(m, p, t),
      cell,
      request.fn_name,
      request.payload
    )
  }

  async createCloneCell(
    request: CreateCloneCellRequest
  ): Promise<ClonedCell> {
    const seed = request.modifiers?.network_seed
    if (!seed) {
      throw new Error('AD4M mode: createCloneCell needs modifiers.network_seed')
    }
    const base = acornLanguageAddress()
    if (!base) {
      throw new Error(
        'AD4M mode: no base acorn language address ' +
          '(?acornLanguage= or ACORN_LANGUAGE_ADDRESS)'
      )
    }

    const ref = await this.rpc.call(
      'language.applyTemplateLocal',
      {
        sourceLanguageHash: base,
        templateData: JSON.stringify({ seed }),
      },
      300000
    )
    const lang = ref.address

    const handle = await this.rpc.call('perspective.create', {
      name: `Acorn ${seed.slice(-12)}`,
    })
    const uuid = handle.uuid

    // the language's cell must answer before mount's first sync can read it
    const info = await this.waitForInfo(lang, 120000)
    await this.rpc.call(
      'perspective.mount',
      { uuid, languageAddress: lang },
      300000
    )

    const cellId: CellId = [
      decodeHashFromBase64(info.cellId[0]),
      decodeHashFromBase64(info.cellId[1]),
    ]
    const cellIdString = cellIdToString(cellId)
    const cloneId = this.nextCloneId()
    const name = `Acorn ${seed}`
    this.cells.set(cellIdString, {
      uuid,
      lang,
      info,
      cloneId,
      name,
    })
    this.learnAgentKey(info)
    this.persistCells()

    return {
      cell_id: cellId,
      clone_id: cloneId,
      original_dna_hash: cellId[0],
      dna_modifiers: { network_seed: seed, properties: new Uint8Array() },
      name,
      enabled: true,
    }
  }

  async disableCloneCell(request: DisableCloneCellRequest): Promise<void> {
    const cid = request.clone_cell_id
    let foundKey: string | undefined
    let found: CellState | undefined
    if (cid?.type === 'dna_hash') {
      const wanted = encodeHashToBase64(cid.value)
      for (const [k, cell] of this.cells) {
        if (cell.info.cellId[0] === wanted) {
          foundKey = k
          found = cell
          break
        }
      }
    } else if (cid?.type === 'clone_id') {
      for (const [k, cell] of this.cells) {
        if (cell.cloneId === cid.value) {
          foundKey = k
          found = cell
          break
        }
      }
    }
    if (!found || foundKey === undefined) {
      throw new Error('AD4M mode: disableCloneCell on an unknown cell')
    }
    await this.rpc.call('perspective.unmount', {
      uuid: found.uuid,
      languageAddress: found.lang,
    })
    await this.rpc.call('perspective.remove', { uuid: found.uuid })
    this.cells.delete(foundKey)
    this.persistCells()
  }

  async dumpNetworkMetrics(): Promise<any> {
    return {}
  }

  on(eventName: string, listener: SignalHandler): UnsubscribeFunction {
    if (eventName === 'signal') this.signalHandlers.add(listener)
    return () => {
      this.signalHandlers.delete(listener)
    }
  }

  /** Fed by subscriptions in C3 (design §6.3). */
  emitSignal(signal: any) {
    for (const h of this.signalHandlers) h(signal)
  }

  // --- internals ------------------------------------------------------------

  private async waitForInfo(
    lang: string,
    timeoutMs: number,
    stepMs = 3000
  ): Promise<any> {
    const t0 = Date.now()
    let lastErr: any = null
    while (Date.now() - t0 < timeoutMs) {
      try {
        const res = await this.rpc.call(
          'expression.interact',
          {
            url: `${lang}://project`,
            interactionCall: { name: 'info', parametersStringified: '{}' },
          },
          30000
        )
        const info = typeof res === 'string' ? JSON.parse(res) : res
        if (info && info.dnaHash) return info
      } catch (e) {
        lastErr = e
      }
      await new Promise((r) => setTimeout(r, stepMs))
    }
    throw new Error(
      `waitForInfo: no info after ${timeoutMs}ms` +
        (lastErr ? ` (last: ${lastErr.message})` : '')
    )
  }
}
