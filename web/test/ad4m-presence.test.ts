// Outbound presence (Lal review Part 3, P2: "Outbound presence is
// implemented but unreachable"). The realtime-info middleware only sends
// when `client.socket.readyState === OPEN`; the shim used to report a
// permanently CLOSED stub, so presence never left. The shim's socket now
// reports the adapter's real readiness, and editing/expanded-view presence
// goes out through callZome -> emit_realtime_info_signal.
import { realtimeInfoWatcher } from '../src/redux/persistent/projects/realtime-info-signal/middleware'
import { openExpandedView } from '../src/redux/ephemeral/expanded-view/actions'
import { startTitleEdit } from '../src/redux/ephemeral/outcome-editing/actions'
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
