// Live updates (spec C3, design §6.3): one perspective.modelSubscribe per
// mounted class, the executor's query-subscription-update frames diffed by id
// into Acorn signal payloads — the exact msgpack shape the stock zomes send
// and the UI's existing 'signal' handler decodes.
import * as msgpack from '@msgpack/msgpack/dist'
import {
  acornSignal,
  diffInstances,
  startLive,
  LiveCell,
  LiveClient,
  LIVE_CLASSES,
  MAX_BUFFERED_FRAMES,
} from '../src/ad4m/live'
import {
  baselineEntry,
  captureEditBaseline,
  editBaselineEntry,
  rememberBaseline,
} from '../src/ad4m/baselines'
import { agentToDid } from '../src/ad4m/agent'

const LANG = 'acornlang'
const SEED = 'uid-rig-test-project'
const UUID = 'persp-uuid-1'

const DNA_B64 = 'uhC0kRGlmYQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAZGNhIQ'
const AGENT_B64 =
  'uhCAkDsZGYpTXiihwf8CcfsbpLcyzmP_jMWv28biNaAknxgUudQnS'
const OUTCOME_A =
  'uhCkkb3V0Y29tZUEuLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi5sb2Mh'
const OUTCOME_B =
  'uhCkkb3V0Y29tZUIuLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi5sb2Mh'

const url = (h: string) => `${LANG}://${h}`

function outcomeInstance(id: string, content = 'Stock outcome') {
  return {
    id: url(id),
    __subjectClass: 'AcornOutcome',
    content,
    description: '',
    githubLink: '',
    scopeType: 'Small',
    achievementStatus: 'NotAchieved',
    taskList: '[]',
    tags: [],
    creator: agentToDid(AGENT_B64),
    timestampCreated: 1763370000.0,
    isImported: false,
    entryHash: 'uhCkkZW50cnk',
    recordCreatedAt: 1763370000123456,
    recordUpdatedAt: 1763370000123456,
  }
}

const cell: LiveCell = {
  uuid: UUID,
  lang: LANG,
  info: {
    dnaHash: DNA_B64,
    agentPubKey: AGENT_B64,
    seed: SEED,
  },
  cellId: [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])],
}

function decodeSignal(signal: any): any {
  return msgpack.decode(signal.value.payload)
}

// --- 1. the diff --------------------------------------------------------------

describe('diffInstances', () => {
  it('new -> create, changed -> update, missing -> delete', () => {
    const a1 = { id: 'a1', content: 'x' }
    const a1Next = { id: 'a1', content: 'y' }
    const b = { id: 'b', content: 'b' }

    expect(diffInstances([a1], [a1Next, b])).toEqual([
      { action: 'update', instance: a1Next },
      { action: 'create', instance: b },
    ])
    expect(diffInstances([a1Next, b], [])).toEqual([
      { action: 'delete', instance: a1Next },
      { action: 'delete', instance: b },
    ])
    expect(diffInstances([a1], [a1])).toEqual([])
  })
})

// --- 2. the signal envelope ----------------------------------------------------

describe('acornSignal', () => {
  it('an outcome create decodes to the stock Outcome payload', () => {
    const signal = acornSignal(cell, 'AcornOutcome', 'create', outcomeInstance(OUTCOME_A))
    expect(signal.type).toBe('app')
    expect(signal.value.zome_name).toBe('projects')
    expect(signal.value.cell_id).toBe(cell.cellId)

    const payload = decodeSignal(signal)
    // the UI's crudTypes map keys on the lowercase wire entryType — a
    // camel-cased 'Outcome' here is the wrong shape and must fail
    expect(payload).toEqual({
      signalType: 'Outcome',
      data: {
        entryType: 'outcome',
        action: 'create',
        data: expect.objectContaining({
          actionHash: OUTCOME_A,
          entry: expect.objectContaining({ content: 'Stock outcome' }),
        }),
      },
    })
  })

  it('an outcome update carries the updated WireRecord', () => {
    const inst = outcomeInstance(OUTCOME_A, 'renamed')
    const payload = decodeSignal(acornSignal(cell, 'AcornOutcome', 'update', inst))
    expect(payload.signalType).toBe('Outcome')
    expect(payload.data.entryType).toBe('outcome')
    expect(payload.data.action).toBe('update')
    expect(payload.data.data.actionHash).toBe(OUTCOME_A)
    expect(payload.data.data.entry.content).toBe('renamed')
  })

  it('an outcome delete carries the bare action hash', () => {
    const payload = decodeSignal(
      acornSignal(cell, 'AcornOutcome', 'delete', outcomeInstance(OUTCOME_A))
    )
    expect(payload).toEqual({
      signalType: 'Outcome',
      data: { entryType: 'outcome', action: 'delete', data: OUTCOME_A },
    })
  })

  it('a member create carries the bare Member, entry_type spelled snake', () => {
    const inst = { id: url('memberhash'), agent: agentToDid(AGENT_B64) }
    const payload = decodeSignal(acornSignal(cell, 'AcornMember', 'create', inst))
    // MemberSignal has no camelCase rename — the stock signal carries
    // `entry_type`, and data is the bare Member, not a WireRecord
    expect(payload).toEqual({
      signalType: 'Member',
      data: {
        entry_type: 'member',
        action: 'create',
        data: { agentPubKey: AGENT_B64 },
      },
    })
  })

  it('a profile update is the Agent signal with a WireRecord<Profile>', () => {
    const inst = {
      id: url(`profile/${AGENT_B64}`),
      __subjectClass: 'AcornProfile',
      firstName: 'Ada',
      lastName: 'Lovelace',
      handle: 'ada',
      status: 'Online',
      avatarUrl: '',
      agent: agentToDid(AGENT_B64),
    }
    const payload = decodeSignal(acornSignal(cell, 'AcornProfile', 'update', inst))
    expect(payload.signalType).toBe('Agent')
    expect(payload.data.entryType).toBe('agent')
    expect(payload.data.action).toBe('update')
    expect(payload.data.data.entry.handle).toBe('ada')
    // the profile's mount address is profile/<key>; its signal hash is the key
    expect(payload.data.data.actionHash).toBe(AGENT_B64)
  })
})

// --- 3. subscription wiring -----------------------------------------------------

describe('startLive', () => {
  function fakeClient(firstInstances: Record<string, any[]>) {
    const calls: { method: string; params: any }[] = []
    const listeners = new Set<(msg: any) => void>()
    const emitted: any[] = []
    const client: LiveClient = {
      call: async (method: string, params: any) => {
        calls.push({ method, params })
        if (method === 'perspective.modelSubscribe') {
          return {
            subscriptionId: params.subscriptionId,
            result: { instances: firstInstances[params.class_name] ?? [], totalCount: 0 },
            revision: 0,
          }
        }
        if (method === 'perspective.resyncSubscription') {
          return { revision: 1, result: { instances: [], totalCount: 0 } }
        }
        return true
      },
      onEvent: (cb) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
      emit: (s) => emitted.push(s),
    }
    const fire = (msg: any) => listeners.forEach((cb) => cb(msg))
    return { client, calls, emitted, fire, listeners }
  }

  it('opens one modelSubscribe per class and diffs updates into signals', async () => {
    const a1 = outcomeInstance(OUTCOME_A)
    const { client, calls, emitted, fire } = fakeClient({
      AcornOutcome: [a1],
    })
    const handle = await startLive(client, cell)

    const subCalls = calls.filter((c) => c.method === 'perspective.modelSubscribe')
    expect(subCalls).toHaveLength(LIVE_CLASSES.length)
    expect(subCalls.map((c) => c.params.class_name).sort()).toEqual(
      [...LIVE_CLASSES].sort()
    )
    for (const c of subCalls) {
      expect(c.params).toMatchObject({ uuid: UUID, query_json: '{}' })
      expect(c.params.subscriptionId).toMatch(/^[A-Za-z0-9-]{1,64}$/)
    }

    // no signals for the initial result — it is the baseline
    expect(emitted).toHaveLength(0)

    const outcomeSub = subCalls.find((c) => c.params.class_name === 'AcornOutcome')!
    const a1Next = outcomeInstance(OUTCOME_A, 'renamed')
    const b = outcomeInstance(OUTCOME_B, 'created')
    fire({
      type: 'query-subscription-update',
      subscriptionId: outcomeSub.params.subscriptionId,
      revision: 1,
      ids: [a1Next.id, b.id],
      upsert: [a1Next, b],
      totalCount: 2,
    })

    // one signal per changed row: update a1, create b
    expect(emitted).toHaveLength(2)
    const decoded = emitted.map(decodeSignal)
    expect(decoded.map((d) => [d.data.action, d.data.data.actionHash])).toEqual([
      ['update', OUTCOME_A],
      ['create', OUTCOME_B],
    ])

    fire({
      type: 'query-subscription-update',
      subscriptionId: outcomeSub.params.subscriptionId,
      revision: 2,
      ids: [],
      upsert: [],
      totalCount: 0,
    })
    expect(emitted).toHaveLength(4)
    const deletes = emitted.slice(2).map(decodeSignal)
    expect(deletes.map((d) => [d.data.action, d.data.data])).toEqual([
      ['delete', OUTCOME_A],
      ['delete', OUTCOME_B],
    ])

    // frames for other subscriptions are ignored
    fire({
      type: 'query-subscription-update',
      subscriptionId: 'someone-elses-sub',
      revision: 3,
      ids: [],
      upsert: [],
    })
    expect(emitted).toHaveLength(4)

    await handle.stop()
    const disposes = calls.filter((c) => c.method === 'perspective.disposeQuery')
    expect(disposes).toHaveLength(LIVE_CLASSES.length)
    expect(disposes.map((c) => c.params.subscriptionId).sort()).toEqual(
      subCalls.map((c) => c.params.subscriptionId).sort()
    )
  })

  it('a revision gap resyncs the subscription', async () => {
    const a1 = outcomeInstance(OUTCOME_A)
    const { client, calls, emitted, fire } = fakeClient({ AcornOutcome: [a1] })
    await startLive(client, cell)

    const outcomeSub = calls.find(
      (c) => c.method === 'perspective.modelSubscribe' && c.params.class_name === 'AcornOutcome'
    )!
    fire({
      type: 'query-subscription-update',
      subscriptionId: outcomeSub.params.subscriptionId,
      revision: 7, // gap: expected 1
      ids: [],
      upsert: [],
    })
    await new Promise((r) => setTimeout(r, 0))

    expect(
      calls.some(
        (c) =>
          c.method === 'perspective.resyncSubscription' &&
          c.params.subscriptionId === outcomeSub.params.subscriptionId
      )
    ).toBe(true)
    // resync's empty result -> the baseline row is gone: one delete signal
    expect(emitted.map(decodeSignal).map((d) => d.data.action)).toEqual(['delete'])
  })
})

// --- 4. init/resync races (Lal review Part 3: "live subscriptions can lose
//    updates during initialization/resync") ------------------------------------
//
// A subscription id is registered before its request goes out, and frames
// that land while the subscribe or a resync is in flight are buffered and
// replayed against the snapshot that eventually arrives; a snapshot older
// than the revision the stream already reached is rejected.
describe('startLive init/resync buffering', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0))

  /** client whose responses resolve by hand while `defer()` says so */
  function deferredClient() {
    const calls: { method: string; params: any }[] = []
    const listeners = new Set<(msg: any) => void>()
    const emitted: any[] = []
    const resolvers = new Map<string, (res: any) => void>()
    const deferred = { modelSubscribe: true, resync: true }
    const client: LiveClient = {
      call: async (method: string, params: any) => {
        calls.push({ method, params })
        if (method === 'perspective.modelSubscribe') {
          if (deferred.modelSubscribe) {
            return new Promise((resolve) =>
              resolvers.set(params.subscriptionId, resolve)
            )
          }
          return {
            subscriptionId: params.subscriptionId,
            result: { instances: [], totalCount: 0 },
            revision: 0,
          }
        }
        if (method === 'perspective.resyncSubscription') {
          if (deferred.resync) {
            return new Promise((resolve) =>
              resolvers.set(`resync:${params.subscriptionId}`, resolve)
            )
          }
          return { revision: 0, result: { instances: [], totalCount: 0 } }
        }
        return true
      },
      onEvent: (cb) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
      emit: (s) => emitted.push(s),
    }
    const fire = (msg: any) => listeners.forEach((cb) => cb(msg))
    return { client, calls, emitted, fire, resolvers, deferred }
  }

  it('a frame that lands before the subscribe response is buffered and replayed', async () => {
    const a1 = outcomeInstance(OUTCOME_A)
    const { client, calls, emitted, fire, resolvers, deferred } =
      deferredClient()
    const started = startLive(client, cell)
    await tick()

    const outcomeSub = calls.find(
      (c) => c.params.class_name === 'AcornOutcome'
    )!
    // the update lands while the subscribe is still unanswered: it must not
    // be dropped just because the subscription is not registered yet
    fire({
      type: 'query-subscription-update',
      subscriptionId: outcomeSub.params.subscriptionId,
      revision: 1,
      ids: [a1.id],
      upsert: [a1],
      totalCount: 1,
    })
    // the subscribe answers with an empty baseline at revision 0; the other
    // classes' subscribes answer quietly so startLive can finish
    deferred.modelSubscribe = false
    resolvers.get(outcomeSub.params.subscriptionId)!({
      subscriptionId: outcomeSub.params.subscriptionId,
      result: { instances: [], totalCount: 0 },
      revision: 0,
    })
    await started

    // the buffered frame replays against the snapshot: one create for a1
    const actions = emitted.map(decodeSignal).map((d) => [d.data.action, d.data.data.actionHash])
    expect(actions).toEqual([['create', OUTCOME_A]])
  })

  it('frames during a resync replay on top of the resync snapshot', async () => {
    const a1 = outcomeInstance(OUTCOME_A)
    const b = outcomeInstance(OUTCOME_B, 'created late')
    const { client, calls, emitted, fire, resolvers, deferred } =
      deferredClient()
    deferred.modelSubscribe = false
    await startLive(client, cell)

    const outcomeSub = calls.find(
      (c) => c.params.class_name === 'AcornOutcome'
    )!
    // a revision gap opens a resync whose response we hold back
    fire({
      type: 'query-subscription-update',
      subscriptionId: outcomeSub.params.subscriptionId,
      revision: 5,
      ids: [],
      upsert: [],
    })
    await tick()

    // a newer frame lands while the resync is in flight
    fire({
      type: 'query-subscription-update',
      subscriptionId: outcomeSub.params.subscriptionId,
      revision: 8,
      ids: [a1.id, b.id],
      upsert: [a1, b],
      totalCount: 2,
    })

    // the resync snapshot catches only up to revision 7: a1 exists, b does not
    resolvers.get(`resync:${outcomeSub.params.subscriptionId}`)!({
      revision: 7,
      result: { instances: [a1], totalCount: 1 },
    })
    await tick()

    // snapshot applied (create a1), then the buffered frame on top (create b);
    // without buffering, the frame applied first and the older snapshot then
    // deleted b again
    const actions = emitted
      .map(decodeSignal)
      .map((d) => [d.data.action, d.data.data.actionHash])
    expect(actions).toEqual([
      ['create', OUTCOME_A],
      ['create', OUTCOME_B],
    ])
  })

  it('a delta that cannot apply does not commit its revision: the same-revision recovery snapshot applies', async () => {
    const a1 = outcomeInstance(OUTCOME_A)
    const { client, calls, emitted, fire, resolvers, deferred } =
      deferredClient()
    deferred.modelSubscribe = false
    await startLive(client, cell)

    const outcomeSub = calls.find(
      (c) => c.params.class_name === 'AcornOutcome'
    )!
    // revision 1 names an id this client never had and the frame carries no
    // upsert for it: the delta cannot apply, so the subscription resyncs.
    // The failed delta must NOT have moved the revision counter — otherwise
    // the recovery snapshot carrying that very revision is discarded as stale.
    fire({
      type: 'query-subscription-update',
      subscriptionId: outcomeSub.params.subscriptionId,
      revision: 1,
      ids: [a1.id],
      upsert: [],
    })
    await tick()

    // the recovery snapshot comes back AT revision 1
    resolvers.get(`resync:${outcomeSub.params.subscriptionId}`)!({
      revision: 1,
      result: { instances: [a1], totalCount: 1 },
    })
    await tick()

    const actions = emitted
      .map(decodeSignal)
      .map((d) => [d.data.action, d.data.data.actionHash])
    expect(actions).toEqual([['create', OUTCOME_A]])
  })

  it('a resync snapshot behind the applied revision is rejected', async () => {
    const a1 = outcomeInstance(OUTCOME_A)
    const { client, calls, emitted, fire, resolvers, deferred } =
      deferredClient()
    deferred.modelSubscribe = false
    await startLive(client, cell)

    const outcomeSub = calls.find(
      (c) => c.params.class_name === 'AcornOutcome'
    )!
    // a live frame puts a1 at revision 1
    fire({
      type: 'query-subscription-update',
      subscriptionId: outcomeSub.params.subscriptionId,
      revision: 1,
      ids: [a1.id],
      upsert: [a1],
    })
    expect(emitted).toHaveLength(1)

    // a gap opens a resync; the snapshot it returns is already stale (empty,
    // revision 1 — the stream has seen everything it covers)
    fire({
      type: 'query-subscription-update',
      subscriptionId: outcomeSub.params.subscriptionId,
      revision: 3,
      ids: [],
      upsert: [],
    })
    await tick()
    resolvers.get(`resync:${outcomeSub.params.subscriptionId}`)!({
      revision: 1,
      result: { instances: [], totalCount: 0 },
    })
    await tick()

    // a stale snapshot must not roll a1 back out: still exactly one signal
    expect(emitted).toHaveLength(1)
    expect(decodeSignal(emitted[0]).data.action).toBe('create')
  })

  it('a buffer overflow drops the held frames and asks for a fresh snapshot', async () => {
    const a1 = outcomeInstance(OUTCOME_A)
    const b = outcomeInstance(OUTCOME_B, 'final')
    const { client, calls, emitted, fire, resolvers, deferred } =
      deferredClient()
    deferred.modelSubscribe = false
    await startLive(client, cell)

    const outcomeSub = calls.find(
      (c) => c.params.class_name === 'AcornOutcome'
    )!
    // a revision gap opens a resync whose response we hold back
    fire({
      type: 'query-subscription-update',
      subscriptionId: outcomeSub.params.subscriptionId,
      revision: 5,
      ids: [],
      upsert: [],
    })
    await tick()

    // more frames than the buffer holds pile up while it is in flight
    for (let i = 0; i < MAX_BUFFERED_FRAMES + 10; i++) {
      fire({
        type: 'query-subscription-update',
        subscriptionId: outcomeSub.params.subscriptionId,
        revision: 6 + i,
        ids: [],
        upsert: [],
      })
    }

    // the in-flight snapshot lands; the overflow has queued another resync
    const resyncKey = `resync:${outcomeSub.params.subscriptionId}`
    resolvers.get(resyncKey)!({
      revision: 100,
      result: { instances: [a1], totalCount: 1 },
    })
    await tick()

    const resyncCalls = calls.filter(
      (c) => c.method === 'perspective.resyncSubscription'
    )
    expect(resyncCalls).toHaveLength(2)

    // the second, fresh snapshot is what the UI converges to — the frames
    // the buffer dropped are covered by it, not replayed
    resolvers.get(resyncKey)!({
      revision: 120,
      result: { instances: [b], totalCount: 1 },
    })
    await tick()
    const actions = emitted
      .map(decodeSignal)
      .map((d) => [
        d.data.action,
        d.data.action === 'delete' ? d.data.data : d.data.data.actionHash,
      ])
    expect(actions).toEqual([
      ['create', OUTCOME_A],
      ['create', OUTCOME_B],
      ['delete', OUTCOME_A],
    ])
  })

  it('a remote delete evicts the record baselines', async () => {
    const doomed = outcomeInstance('delhash1')
    const { client, calls, fire, deferred } = deferredClient()
    deferred.modelSubscribe = false

    // the record has a remote entry and an open edit session
    rememberBaseline(UUID, 'AcornOutcome', {
      actionHash: 'delhash1',
      entry: { content: 'held' },
    })
    captureEditBaseline(UUID, 'AcornOutcome', 'delhash1')
    expect(baselineEntry(UUID, 'AcornOutcome', 'delhash1')).toBeDefined()
    expect(editBaselineEntry(UUID, 'AcornOutcome', 'delhash1')).toBeDefined()

    await startLive(client, cell)
    const outcomeSub = calls.find(
      (c) => c.params.class_name === 'AcornOutcome'
    )!
    // the record arrives, then vanishes from the live result
    fire({
      type: 'query-subscription-update',
      subscriptionId: outcomeSub.params.subscriptionId,
      revision: 1,
      ids: [doomed.id],
      upsert: [doomed],
    })
    fire({
      type: 'query-subscription-update',
      subscriptionId: outcomeSub.params.subscriptionId,
      revision: 2,
      ids: [],
      upsert: [],
    })

    expect(baselineEntry(UUID, 'AcornOutcome', 'delhash1')).toBeUndefined()
    expect(editBaselineEntry(UUID, 'AcornOutcome', 'delhash1')).toBeUndefined()
  })
})
