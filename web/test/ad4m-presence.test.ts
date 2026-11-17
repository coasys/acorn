// Outbound presence (Lal review Part 3, P2: "Outbound presence is
// implemented but unreachable"). The realtime-info middleware only sends
// when `client.socket.readyState === OPEN`; the shim used to report a
// permanently CLOSED stub, so presence never left. The shim's socket now
// reports the adapter's real readiness, and editing/expanded-view presence
// goes out through callZome -> emit_realtime_info_signal.
import { realtimeInfoWatcher } from '../src/redux/persistent/projects/realtime-info-signal/middleware'
import { openExpandedView } from '../src/redux/ephemeral/expanded-view/actions'
import { startTitleEdit } from '../src/redux/ephemeral/outcome-editing/actions'
import { setActiveProject } from '../src/redux/ephemeral/active-project/actions'
import activeProjectReducer from '../src/redux/ephemeral/active-project/reducer'
import expandedViewReducer from '../src/redux/ephemeral/expanded-view/reducer'
import outcomeEditingReducer from '../src/redux/ephemeral/outcome-editing/reducer'
import { createStore, combineReducers, applyMiddleware } from 'redux'
import { Ad4mAppClient } from '../src/ad4m/Ad4mAppClient'
import { CellCtx } from '../src/ad4m/zomeTable'
import { agentToDid } from '../src/ad4m/agent'
import { socketSurface } from '../src/ad4m/rpc'
import { cellIdToString } from '../src/utils'
import { getAppWs } from '../src/hcWebsockets'

jest.mock('../src/hcWebsockets', () => ({
  getAppWs: jest.fn(),
}))

const DNA = new Uint8Array(39).fill(1)
const AGENT = new Uint8Array(39).fill(2)
const PROJECT_ID = cellIdToString([DNA as any, AGENT as any])

/** an Ad4mAppClient-shaped fake whose transport readiness we control */
function fakeClient(readyState: number) {
  const callZome = jest.fn(async () => null)
  const transport = { readyState }
  const client = {
    client: { socket: socketSurface(transport) },
    callZome,
  }
  return { client, callZome }
}

const store = (state: any) => ({
  getState: () => state,
  dispatch: jest.fn(),
})

const uiState = {
  ui: {
    activeProject: PROJECT_ID,
    outcomeEditing: { outcomeActionHash: 'editing-hash', isTitle: true },
    expandedView: { outcomeActionHash: 'expanded-hash' },
  },
}

describe('realtimeInfoWatcher over the AD4M shim', () => {
  const next = jest.fn((a) => a)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('an OPEN socket sends expanded-view presence via emit_realtime_info_signal', async () => {
    const { client, callZome } = fakeClient(1 /* OPEN */)
    ;(getAppWs as jest.Mock).mockResolvedValue(client)

    const mw = realtimeInfoWatcher(client as any)(store(uiState))(next)
    await mw(openExpandedView('expanded-hash'))

    expect(callZome).toHaveBeenCalledTimes(1)
    const req = callZome.mock.calls[0][0]
    expect(req.fn_name).toBe('emit_realtime_info_signal')
    expect(req.zome_name).toBe('projects')
    expect(req.payload).toEqual({
      projectId: PROJECT_ID,
      outcomeBeingEdited: { outcomeActionHash: 'editing-hash', isTitle: true },
      outcomeExpandedView: 'expanded-hash',
    })
  })

  it('a title edit sends editing presence too', async () => {
    const { client, callZome } = fakeClient(1)
    ;(getAppWs as jest.Mock).mockResolvedValue(client)

    const mw = realtimeInfoWatcher(client as any)(store(uiState))(next)
    await mw(startTitleEdit('editing-hash'))

    expect(callZome).toHaveBeenCalledTimes(1)
    expect(callZome.mock.calls[0][0].fn_name).toBe(
      'emit_realtime_info_signal'
    )
  })

  it('a CLOSED socket still skips the send', async () => {
    const { client, callZome } = fakeClient(3 /* CLOSED */)
    ;(getAppWs as jest.Mock).mockResolvedValue(client)

    const mw = realtimeInfoWatcher(client as any)(store(uiState))(next)
    await mw(openExpandedView('expanded-hash'))

    expect(callZome).not.toHaveBeenCalled()
  })
})

// ---- edit-baseline capture with a dead socket (Lal round 4, P2-2) --------
//
// The middleware used to skip its whole body when the socket was not OPEN —
// including the edit-baseline capture the AD4M update diff relies on. A
// title focus during a transport drop then kept the stale view-open
// baseline, and a save reverting to it compared "no change" and dropped the
// user's edit. The local capture now runs synchronously on the action
// itself; only the presence send still waits for an OPEN socket.
describe('edit-baseline capture with a dead socket', () => {
  const MW_LANG = 'acornlang-mw'
  const MW_AGENT_B64 =
    'uhCAkDsZGYpTXiihwf8CcfsbpLcyzmP_jMWv28biNaAknxgUudQnS'
  const cellId: any = [DNA, AGENT]

  const outcomeInstance = (id: string, content: string) => ({
    id: `${MW_LANG}://${id}`,
    __subjectClass: 'AcornOutcome',
    content,
    description: '',
    githubLink: '',
    scopeType: 'Small',
    achievementStatus: 'NotAchieved',
    taskList: '[]',
    tags: [],
    creator: agentToDid(MW_AGENT_B64),
    timestampCreated: 1763370000.0,
    isImported: false,
    entryHash: 'e',
    recordCreatedAt: 1,
    recordUpdatedAt: 1,
  })

  const outcomeEntry = (content: string) => ({
    content,
    creatorAgentPubKey: MW_AGENT_B64,
    editorAgentPubKey: null,
    timestampCreated: 1763370000.0,
    timestampUpdated: null,
    scope: {
      Small: {
        achievementStatus: 'NotAchieved',
        targetDate: null,
        taskList: [],
      },
    },
    tags: [],
    description: '',
    isImported: false,
    githubLink: '',
  })

  it('START_TITLE_EDIT while the socket is down still lets a revert go out', async () => {
    // a real Ad4mAppClient without connect(): its own rpc stub answers the
    // zome rows; the transport starts OPEN and drops mid-scenario
    const transport = { readyState: 1 /* OPEN */ }
    const calls: { method: string; params: any }[] = []
    let current: any = outcomeInstance('oM1', 'original A')
    const cellCtx: CellCtx = {
      uuid: 'persp-uuid-mw',
      lang: MW_LANG,
      info: { seed: 'uid-mw', agentPubKey: MW_AGENT_B64 },
    }
    const client: any = Object.create(Ad4mAppClient.prototype)
    client.cells = new Map([
      [PROJECT_ID, { ...cellCtx, cloneId: 'projects.0', name: 'p' }],
    ])
    client.client = { socket: socketSurface(transport) }
    client.rpc = {
      call: jest.fn(async (method: string, params: any) => {
        calls.push({ method, params })
        if (method === 'perspective.modelQuery') {
          const q = params.query_json ? JSON.parse(params.query_json) : {}
          const rows = q?.where?.id
            ? [current].filter((r) => r.id === q.where.id)
            : [current]
          return { instances: rows }
        }
        if (method === 'perspective.updateSubject') {
          if (current?.id === params.expressionAddress) {
            Object.assign(current, JSON.parse(params.values))
          }
          return true
        }
        if (method === 'expression.interact') return null
        throw new Error(`unexpected rpc ${method}`)
      }),
    }
    ;(getAppWs as jest.Mock).mockResolvedValue(client)

    const store = createStore(
      combineReducers({
        ui: combineReducers({
          activeProject: activeProjectReducer,
          expandedView: expandedViewReducer,
          outcomeEditing: outcomeEditingReducer,
        }),
      }),
      applyMiddleware(realtimeInfoWatcher(client))
    )

    const fetch = () =>
      client.callZome({
        cell_id: cellId,
        zome_name: 'projects',
        fn_name: 'fetch_outcomes',
        payload: null,
      })
    const updateTitle = (content: string) =>
      client.callZome({
        cell_id: cellId,
        zome_name: 'projects',
        fn_name: 'update_outcome',
        payload: { actionHash: 'oM1', entry: outcomeEntry(content) },
      })
    const updateValues = () =>
      calls
        .filter((c) => c.method === 'perspective.updateSubject')
        .map((c) => JSON.parse(c.params.values))
    const flush = () => new Promise((r) => setTimeout(r, 0))

    // the fetch lands the record in the remote baseline; opening the view
    // sends presence and freezes 'original A' as the record baseline
    await fetch()
    await store.dispatch(setActiveProject(PROJECT_ID))
    await store.dispatch(openExpandedView('oM1'))
    await flush()
    expect(
      calls.filter((c) => c.method === 'expression.interact')
    ).toHaveLength(1)

    // the transport drops, then a peer rename lands through a fetch
    transport.readyState = 3 /* CLOSED */
    current = outcomeInstance('oM1', 'peer moved to B')
    await fetch()

    // the title gets focused while the socket is down: nothing reaches the
    // executor — but the local edit baseline must still have captured the B
    // the editor is looking at
    calls.length = 0
    await store.dispatch(startTitleEdit('oM1'))
    await flush()
    expect(calls).toHaveLength(0)

    // the user types the title back to A and the save must go out: without
    // the synchronous capture the stale view-open baseline (A) sees "no
    // change" and silently drops the revert
    await updateTitle('original A')
    expect(updateValues()).toEqual([{ content: 'original A' }])
  })
})
