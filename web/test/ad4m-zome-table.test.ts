// The fn_name -> AD4M call translation table (spec C1): each read row must
// hit perspective.modelQuery with the right class_name + snake_case params,
// convert instances to WireRecords, and keep the zome's error semantics
// ('no project meta exists') and the C2 boundary ('not implemented yet').
import { dispatchZomeCall, CellCtx } from '../src/ad4m/zomeTable'
import { agentToDid } from '../src/ad4m/agent'

const LANG = 'acornlang'
const SEED = 'uid-rig-test-project'
const UUID = 'persp-uuid-1'

const AGENT_A = 'uhCAkDsZGYpTXiihwf8CcfsbpLcyzmP_jMWv28biNaAknxgUudQnS'
const DNA_B64 = 'uhC0kRGlmYQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAZGNhIQ'
const AGENT_B64 =
  'uhCAkDsZGYpTXiihwf8CcfsbpLcyzmP_jMWv28biNaAknxgUudQnS'
const OUTCOME_A =
  'uhCkkb3V0Y29tZUEuLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi5sb2Mh'

const url = (h: string) => `${LANG}://${h}`

const cell: CellCtx = {
  uuid: UUID,
  lang: LANG,
  info: {
    dnaHash: DNA_B64,
    agentPubKey: AGENT_B64,
    agentDid: agentToDid(AGENT_B64),
    ad4mDid: 'did:key:zAD4M',
    seed: SEED,
    cellId: [DNA_B64, AGENT_B64],
  },
}

function outcomeInstance(id: string) {
  return {
    id: url(id),
    __subjectClass: 'AcornOutcome',
    content: 'Stock outcome',
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

function projectMetaInstance() {
  return {
    id: url('uhCkkTWV0YS'),
    __subjectClass: 'AcornProjectMeta',
    name: 'Rig Project',
    image: '',
    layeringAlgorithm: 'LongestPath',
    topPriorityOutcomes: [],
    creator: agentToDid(AGENT_B64),
    createdAtTime: 1763370001.0,
    isImported: false,
    isMigrated: '0.7',
    entryHash: 'uhCkkZW50cnk',
    recordCreatedAt: 1763370000123456,
    recordUpdatedAt: 1763370000123456,
  }
}

function profileInstance() {
  return {
    id: url(`profile/${AGENT_B64}`),
    __subjectClass: 'AcornProfile',
    firstName: 'Stock',
    lastName: 'Rig',
    handle: 'stockrig',
    status: 'Online',
    avatarUrl: '',
    agent: agentToDid(AGENT_B64),
    agentPubKey: AGENT_B64,
    isImported: false,
  }
}

/** fake rpc.call: records calls, serves canned modelQuery rows per class. */
function fakeRpc(canned: Record<string, any[]>, interactResult?: any) {
  const calls: { method: string; params: any }[] = []
  const call = jest.fn(async (method: string, params: any) => {
    calls.push({ method, params })
    if (method === 'perspective.modelQuery') {
      return { instances: canned[params.class_name] ?? [] }
    }
    if (method === 'expression.interact') {
      return interactResult
    }
    throw new Error(`unexpected rpc ${method}`)
  })
  return { calls, call }
}

describe('zomeTable read rows', () => {
  test('fetch_outcomes queries AcornOutcome and maps to WireRecords', async () => {
    const { calls, call } = fakeRpc({
      AcornOutcome: [outcomeInstance('o1'), outcomeInstance('o2')],
    })
    const res = await dispatchZomeCall(call, cell, 'fetch_outcomes', null)

    expect(calls).toEqual([
      {
        method: 'perspective.modelQuery',
        params: { uuid: UUID, class_name: 'AcornOutcome', query_json: '{}' },
      },
    ])
    expect(res).toHaveLength(2)
    expect(res[0]).toMatchObject({
      actionHash: 'o1',
      entryHash: 'uhCkkZW50cnk',
      createdAt: 1763370000123456,
      updatedAt: 1763370000123456,
    })
    expect(res[0].entry.content).toBe('Stock outcome')
    expect(res[0].entry.scope).toEqual({
      Small: {
        achievementStatus: 'NotAchieved',
        targetDate: null,
        taskList: [],
      },
    })
  })

  test.each([
    ['fetch_connections', 'AcornConnection'],
    ['fetch_entry_points', 'AcornEntryPoint'],
    ['fetch_outcome_comments', 'AcornOutcomeComment'],
    ['fetch_outcome_members', 'AcornOutcomeMember'],
    ['fetch_tags', 'AcornTag'],
    ['fetch_members', 'AcornMember'],
  ])('%s queries %s', async (fnName, className) => {
    const { calls, call } = fakeRpc({})
    await dispatchZomeCall(call, cell, fnName, null)
    expect(calls[0].params.class_name).toBe(className)
    expect(calls[0].method).toBe('perspective.modelQuery')
  })

  test('fetch_project_meta returns the row, passphrase from seed', async () => {
    const { call } = fakeRpc({ AcornProjectMeta: [projectMetaInstance()] })
    const wire = await dispatchZomeCall(call, cell, 'fetch_project_meta', null)
    expect(wire.entry.name).toBe('Rig Project')
    expect(wire.entry.passphrase).toBe('rig test project')
  })

  test('fetch_project_meta with no rows throws "no project meta exists"', async () => {
    const { call } = fakeRpc({})
    await expect(
      dispatchZomeCall(call, cell, 'fetch_project_meta', null)
    ).rejects.toThrow('no project meta exists')
  })

  test('check_project_meta_exists is a boolean', async () => {
    const empty = fakeRpc({})
    await expect(
      dispatchZomeCall(empty.call, cell, 'check_project_meta_exists', null)
    ).resolves.toBe(false)
    const one = fakeRpc({ AcornProjectMeta: [projectMetaInstance()] })
    await expect(
      dispatchZomeCall(one.call, cell, 'check_project_meta_exists', null)
    ).resolves.toBe(true)
  })

  test('fetch_agents returns bare Profiles', async () => {
    const { call } = fakeRpc({ AcornProfile: [profileInstance()] })
    const res = await dispatchZomeCall(call, cell, 'fetch_agents', null)
    expect(res).toEqual([
      {
        firstName: 'Stock',
        lastName: 'Rig',
        handle: 'stockrig',
        status: 'Online',
        avatarUrl: '',
        agentPubKey: AGENT_B64,
        isImported: false,
      },
    ])
  })

  test('whoami goes through expression.interact on L://project', async () => {
    // the language's whoami answers { address: "profile/<own key>", data }
    // where data is the AcornProfile mount props (no id)
    const data = { ...profileInstance() }
    delete (data as any).id
    delete (data as any).__subjectClass
    const { calls, call } = fakeRpc({}, {
      address: `profile/${AGENT_B64}`,
      data,
    })
    const res = await dispatchZomeCall(call, cell, 'whoami', null)
    expect(calls[0]).toEqual({
      method: 'expression.interact',
      params: {
        url: `${LANG}://project`,
        interactionCall: { name: 'whoami', parametersStringified: '{}' },
      },
    })
    expect(res.actionHash).toBe(AGENT_B64)
    expect(res.entry.handle).toBe('stockrig')
  })

  test('whoami is null when the language answers null', async () => {
    const { call } = fakeRpc({}, null)
    await expect(
      dispatchZomeCall(call, cell, 'whoami', null)
    ).resolves.toBeNull()
  })

  test('fetch_agent_address comes from info', async () => {
    const { calls, call } = fakeRpc({})
    const res = await dispatchZomeCall(call, cell, 'fetch_agent_address', null)
    expect(res).toBe(AGENT_B64)
    expect(calls).toHaveLength(0)
  })

  test('fetch_entry_point_details returns entryPoints + their outcomes', async () => {
    const ep = {
      id: url('ep1'),
      __subjectClass: 'AcornEntryPoint',
      color: '#aabbcc',
      outcome: url(OUTCOME_A),
      creator: agentToDid(AGENT_B64),
      createdAtTime: 1763370001.0,
      isImported: false,
      entryHash: 'e',
      recordCreatedAt: 1,
      recordUpdatedAt: 1,
    }
    const { calls, call } = fakeRpc({
      AcornEntryPoint: [ep],
      AcornOutcome: [outcomeInstance(OUTCOME_A), outcomeInstance('other')],
    })
    const res = await dispatchZomeCall(
      call,
      cell,
      'fetch_entry_point_details',
      null
    )
    expect(res.entryPoints).toHaveLength(1)
    expect(res.entryPoints[0].entry.outcomeActionHash).toBe(OUTCOME_A)
    expect(res.outcomes).toHaveLength(1)
    expect(res.outcomes[0].actionHash).toBe(OUTCOME_A)
    expect(calls.map((c) => c.params.class_name)).toEqual([
      'AcornEntryPoint',
      'AcornOutcome',
    ])
  })

  test('unknown fn_name throws "not implemented yet"', async () => {
    const { call } = fakeRpc({})
    await expect(
      dispatchZomeCall(call, cell, 'fetch_outcome_votes', {})
    ).rejects.toThrow('not implemented yet')
  })
})

// ---- write rows (spec C2) ---------------------------------------------------

function connInstance(id: string, parent: string, child: string, order = 0) {
  return {
    id: url(id),
    __subjectClass: 'AcornConnection',
    parent: url(parent),
    child: url(child),
    siblingOrder: order,
    randomizer: 999,
    isImported: false,
    entryHash: 'e',
    recordCreatedAt: 1,
    recordUpdatedAt: 1,
  }
}

function memberInstance(id: string, outcome: string) {
  return {
    id: url(id),
    __subjectClass: 'AcornOutcomeMember',
    outcome: url(outcome),
    member: agentToDid(AGENT_B64),
    creator: agentToDid(AGENT_B64),
    unixTimestamp: 1763370002,
    isImported: false,
    entryHash: 'e',
    recordCreatedAt: 1,
    recordUpdatedAt: 1,
  }
}

function commentInstance(id: string, outcome: string) {
  return {
    id: url(id),
    __subjectClass: 'AcornOutcomeComment',
    outcome: url(outcome),
    content: 'a comment',
    creator: agentToDid(AGENT_B64),
    unixTimestamp: 1763370003,
    isImported: false,
    entryHash: 'e',
    recordCreatedAt: 1,
    recordUpdatedAt: 1,
  }
}

function entryPointInstance(id: string, outcome: string) {
  return {
    id: url(id),
    __subjectClass: 'AcornEntryPoint',
    outcome: url(outcome),
    color: '#aabbcc',
    creator: agentToDid(AGENT_B64),
    createdAtTime: 1763370004,
    isImported: false,
    entryHash: 'e',
    recordCreatedAt: 1,
    recordUpdatedAt: 1,
  }
}

const outcomeEntry = (over: any = {}) => ({
  content: 'Stock outcome',
  creatorAgentPubKey: AGENT_B64,
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
  ...over,
})

/** fake rpc for writes: canned() supplies the CURRENT modelQuery rows (flip
 *  it between calls to fake the post-delete state); createSubject pops the
 *  next createdUrls entry as its URL result. */
function fakeWriteRpc(opts: {
  canned: () => Record<string, any[]>
  createdUrls?: string[]
  interact?: any
  onRemove?: () => void
  onUpdate?: () => void
}) {
  const calls: { method: string; params: any }[] = []
  const created = [...(opts.createdUrls ?? [])]
  const call = jest.fn(async (method: string, params: any) => {
    calls.push({ method, params })
    if (method === 'perspective.modelQuery') {
      const q = params.query_json ? JSON.parse(params.query_json) : {}
      let rows = opts.canned()[params.class_name] ?? []
      const wanted = q?.where?.id
      if (wanted) rows = rows.filter((r) => r.id === wanted)
      return { instances: rows }
    }
    if (method === 'perspective.createSubject') {
      return created.length ? created.shift()! : url('created-hash')
    }
    if (method === 'perspective.updateSubject') {
      opts.onUpdate?.()
      return true
    }
    if (method === 'perspective.removeSubject') {
      opts.onRemove?.()
      return true
    }
    if (method === 'expression.interact') return opts.interact
    throw new Error(`unexpected rpc ${method}`)
  })
  return { calls, call }
}

describe('zomeTable write rows', () => {
  test('update_outcome sends only the changed keys', async () => {
    const inst = outcomeInstance('o1')
    const { calls, call } = fakeWriteRpc({
      canned: () => ({ AcornOutcome: [inst] }),
    })
    const res = await dispatchZomeCall(call, cell, 'update_outcome', {
      actionHash: 'o1',
      entry: outcomeEntry({ content: 'renamed by ad4m' }),
    })
    const updates = calls.filter(
      (c) => c.method === 'perspective.updateSubject'
    )
    expect(updates).toHaveLength(1)
    expect(updates[0].params).toMatchObject({
      uuid: UUID,
      subjectClass: 'AcornOutcome',
      expressionAddress: url('o1'),
    })
    expect(JSON.parse(updates[0].params.values)).toEqual({
      content: 'renamed by ad4m',
    })
    expect(res.actionHash).toBe('o1')
    expect(res.entry.content).toBe('Stock outcome')
  })

  test('update_whoami updates the own profile address', async () => {
    const inst = profileInstance()
    const { calls, call } = fakeWriteRpc({
      canned: () => ({ AcornProfile: [inst] }),
    })
    await dispatchZomeCall(call, cell, 'update_whoami', {
      actionHash: AGENT_B64,
      entry: {
        firstName: 'Renamed',
        lastName: 'Rig',
        handle: 'stockrig',
        status: 'Online',
        avatarUrl: '',
        agentPubKey: AGENT_B64,
        isImported: false,
      },
    })
    const updates = calls.filter(
      (c) => c.method === 'perspective.updateSubject'
    )
    expect(updates).toHaveLength(1)
    expect(updates[0].params.subjectClass).toBe('AcornProfile')
    expect(updates[0].params.expressionAddress).toBe(
      url(`profile/${AGENT_B64}`)
    )
    expect(JSON.parse(updates[0].params.values)).toEqual({
      firstName: 'Renamed',
    })
  })

  test('create_outcome_with_connection, ExistingOutcomeAsParent: one create with parent+siblingOrder', async () => {
    const canned = {
      AcornOutcome: [outcomeInstance('newout')],
      AcornConnection: [connInstance('conn1', 'parent-o', 'newout', 4)],
    }
    const { calls, call } = fakeWriteRpc({
      canned: () => canned,
      createdUrls: [url('newout')],
    })
    const res = await dispatchZomeCall(
      call,
      cell,
      'create_outcome_with_connection',
      {
        entry: outcomeEntry({ content: 'new child' }),
        maybeLinkedOutcome: {
          outcomeActionHash: 'parent-o',
          relation: 'ExistingOutcomeAsParent',
          siblingOrder: 4,
        },
      }
    )
    const creates = calls.filter(
      (c) => c.method === 'perspective.createSubject'
    )
    expect(creates).toHaveLength(1)
    expect(creates[0].params.subjectClass).toBe('AcornOutcome')
    const values = JSON.parse(creates[0].params.initialValues)
    expect(values.parent).toBe(url('parent-o'))
    expect(values.siblingOrder).toBe(4)
    expect(res.outcome.actionHash).toBe('newout')
    expect(res.maybeConnection.actionHash).toBe('conn1')
    expect(res.maybeConnection.entry.parentActionHash).toBe('parent-o')
    expect(res.maybeConnection.entry.childActionHash).toBe('newout')
  })

  test('create_outcome_with_connection, ExistingOutcomeAsChild: outcome then connection', async () => {
    const canned = {
      AcornOutcome: [outcomeInstance('newout')],
      AcornConnection: [connInstance('newconn', 'newout', 'existingchild', 7)],
    }
    const { calls, call } = fakeWriteRpc({
      canned: () => canned,
      createdUrls: [url('newout'), url('newconn')],
    })
    const res = await dispatchZomeCall(
      call,
      cell,
      'create_outcome_with_connection',
      {
        entry: outcomeEntry({ content: 'new parent' }),
        maybeLinkedOutcome: {
          outcomeActionHash: 'existingchild',
          relation: 'ExistingOutcomeAsChild',
          siblingOrder: 7,
        },
      }
    )
    const creates = calls.filter(
      (c) => c.method === 'perspective.createSubject'
    )
    expect(creates).toHaveLength(2)
    expect(creates[0].params.subjectClass).toBe('AcornOutcome')
    // the linked outcome is the CHILD: the outcome create carries no parent
    const outcomeValues = JSON.parse(creates[0].params.initialValues)
    expect(outcomeValues.parent).toBeUndefined()
    expect(outcomeValues.siblingOrder).toBeUndefined()
    expect(creates[1].params.subjectClass).toBe('AcornConnection')
    const connValues = JSON.parse(creates[1].params.initialValues)
    expect(connValues.parent).toBe(url('newout'))
    expect(connValues.child).toBe(url('existingchild'))
    expect(connValues.siblingOrder).toBe(7)
    expect(res.outcome.actionHash).toBe('newout')
    expect(res.maybeConnection.actionHash).toBe('newconn')
  })

  test('create_outcome_with_connection, no linked outcome: outcome only, maybeConnection null', async () => {
    const { calls, call } = fakeWriteRpc({
      canned: () => ({ AcornOutcome: [outcomeInstance('newout')] }),
      createdUrls: [url('newout')],
    })
    const res = await dispatchZomeCall(
      call,
      cell,
      'create_outcome_with_connection',
      {
        entry: outcomeEntry({ content: 'standalone' }),
        maybeLinkedOutcome: null,
      }
    )
    const creates = calls.filter(
      (c) => c.method === 'perspective.createSubject'
    )
    expect(creates).toHaveLength(1)
    expect(res.maybeConnection).toBeNull()
  })

  test('simple_create_project_meta: values carry no passphrase', async () => {
    const { calls, call } = fakeWriteRpc({
      canned: () => ({ AcornProjectMeta: [projectMetaInstance()] }),
      createdUrls: [url('uhCkkTWV0YS')],
    })
    const res = await dispatchZomeCall(
      call,
      cell,
      'simple_create_project_meta',
      {
        input: {
          creatorAgentPubKey: AGENT_B64,
          createdAt: 1763370001.0,
          name: 'Fork Project',
          image: null,
          passphrase: 'alpha bravo charlie delta echo',
          isImported: false,
          layeringAlgorithm: 'LongestPath',
          topPriorityOutcomes: [],
          isMigrated: null,
        },
        local: true,
      }
    )
    const creates = calls.filter(
      (c) => c.method === 'perspective.createSubject'
    )
    expect(creates).toHaveLength(1)
    expect(creates[0].params.subjectClass).toBe('AcornProjectMeta')
    const values = JSON.parse(creates[0].params.initialValues)
    expect(values.passphrase).toBeUndefined()
    expect(values.name).toBe('Fork Project')
    expect(res.actionHash).toBe('uhCkkTWV0YS')
  })

  test('delete_outcome_fully returns exactly what disappeared', async () => {
    let deleted = false
    const canned = () => ({
      AcornOutcome: deleted
        ? [outcomeInstance('o2')]
        : [outcomeInstance('o1'), outcomeInstance('o2')],
      AcornConnection: deleted
        ? [connInstance('c2', 'o2', 'o3')]
        : [connInstance('c1', 'o1', 'o2'), connInstance('c2', 'o2', 'o3')],
      AcornOutcomeMember: deleted ? [] : [memberInstance('m1', 'o1')],
      AcornOutcomeComment: deleted ? [] : [commentInstance('cm1', 'o1')],
      AcornEntryPoint: deleted ? [] : [entryPointInstance('e1', 'o1')],
    })
    const { calls, call } = fakeWriteRpc({
      canned,
      onRemove: () => {
        deleted = true
      },
    })
    const res = await dispatchZomeCall(call, cell, 'delete_outcome_fully', {
      input: 'o1',
      local: true,
    })
    const removes = calls.filter(
      (c) => c.method === 'perspective.removeSubject'
    )
    expect(removes).toHaveLength(1)
    expect(removes[0].params).toMatchObject({
      subjectClass: 'AcornOutcome',
      expressionAddress: url('o1'),
    })
    expect(res).toEqual({
      outcomeActionHash: 'o1',
      deletedConnections: ['c1'],
      deletedOutcomeMembers: ['m1'],
      deletedOutcomeVotes: [],
      deletedOutcomeComments: ['cm1'],
      deletedEntryPoints: ['e1'],
    })
  })

  test('delete_tag removes the subject and returns the hash', async () => {
    const { calls, call } = fakeWriteRpc({ canned: () => ({}) })
    const res = await dispatchZomeCall(call, cell, 'delete_tag', 'taghash1')
    const removes = calls.filter(
      (c) => c.method === 'perspective.removeSubject'
    )
    expect(removes).toHaveLength(1)
    expect(removes[0].params).toMatchObject({
      subjectClass: 'AcornTag',
      expressionAddress: url('taghash1'),
    })
    expect(res).toBe('taghash1')
  })

  test('emit_realtime_info_signal goes to the sendRealtimeInfo interaction', async () => {
    const { calls, call } = fakeWriteRpc({ canned: () => ({}) })
    const res = await dispatchZomeCall(
      call,
      cell,
      'emit_realtime_info_signal',
      {
        projectId: 'some-project',
        outcomeBeingEdited: null,
        outcomeExpandedView: null,
      }
    )
    const interacts = calls.filter(
      (c) => c.method === 'expression.interact'
    )
    expect(interacts).toHaveLength(1)
    expect(interacts[0].params.url).toBe(`${LANG}://project`)
    expect(interacts[0].params.interactionCall.name).toBe('sendRealtimeInfo')
    expect(
      JSON.parse(interacts[0].params.interactionCall.parametersStringified)
    ).toEqual({
      projectId: 'some-project',
      outcomeBeingEdited: null,
      outcomeExpandedView: null,
    })
    expect(res).toBeNull()
  })

  test('init_signal goes to the announceJoin interaction', async () => {
    const { calls, call } = fakeWriteRpc({ canned: () => ({}) })
    const res = await dispatchZomeCall(call, cell, 'init_signal', null)
    const interacts = calls.filter(
      (c) => c.method === 'expression.interact'
    )
    expect(interacts).toHaveLength(1)
    expect(interacts[0].params.url).toBe(`${LANG}://project`)
    expect(interacts[0].params.interactionCall.name).toBe('announceJoin')
    expect(res).toBeNull()
  })
})

// ---- update baselines (Lal review Part 3: "changed keys overwrites
//  concurrent edits") -------------------------------------------------------
//
// The changed-keys diff must run against the entry the user started editing —
// the WireRecord this client last produced for the record — not a fresh
// fetch. A fresh fetch reads a peer's concurrent edit back into the diff and
// the user's stale value overwrites it.
describe('update baselines', () => {
  const EDIT_CELL: CellCtx = {
    ...cell,
    uuid: 'persp-uuid-baselines',
  }

  test('a peer edit on another key survives the update', async () => {
    // the record the user fetched and started editing
    let current = {
      ...outcomeInstance('oB1'),
      content: 'as fetched',
      description: '',
    }
    const { calls, call } = fakeWriteRpc({
      canned: () => ({ AcornOutcome: [current] }),
    })
    await dispatchZomeCall(call, EDIT_CELL, 'fetch_outcomes', null)

    // a peer renamed the content while our user was editing the description
    current = { ...current, content: 'peer rename' }

    await dispatchZomeCall(call, EDIT_CELL, 'update_outcome', {
      actionHash: 'oB1',
      entry: outcomeEntry({
        content: 'as fetched',
        description: 'user desc',
      }),
    })
    const updates = calls.filter(
      (c) => c.method === 'perspective.updateSubject'
    )
    expect(updates).toHaveLength(1)
    // fresh-fetch diff would also send content:'as fetched', reverting the
    // peer's rename; the baseline diff sends only the key the user changed
    expect(JSON.parse(updates[0].params.values)).toEqual({
      description: 'user desc',
    })
  })

  test('a peer edit the user folded into their entry is not resent', async () => {
    let current = {
      ...outcomeInstance('oB2'),
      content: 'as fetched',
      description: 'old desc',
    }
    const { calls, call } = fakeWriteRpc({
      canned: () => ({ AcornOutcome: [current] }),
    })
    // the user fetched, saw the peer's rename, then edited the description
    current = { ...current, content: 'peer rename' }
    await dispatchZomeCall(call, EDIT_CELL, 'fetch_outcomes', null)

    await dispatchZomeCall(call, EDIT_CELL, 'update_outcome', {
      actionHash: 'oB2',
      entry: outcomeEntry({
        content: 'peer rename',
        description: 'user desc',
      }),
    })
    const updates = calls.filter(
      (c) => c.method === 'perspective.updateSubject'
    )
    expect(JSON.parse(updates[0].params.values)).toEqual({
      description: 'user desc',
    })
  })

  test('a second update diffs against the first update, not a stale baseline', async () => {
    let current = { ...outcomeInstance('oB3'), content: 'as fetched' }
    // the mount's state moves forward as each update lands
    const after: (() => void)[] = [
      () => {
        current = { ...current, content: 'user rename' }
      },
      () => {
        current = { ...current, githubLink: 'user link' }
      },
    ]
    const { calls, call } = fakeWriteRpc({
      canned: () => ({ AcornOutcome: [current] }),
      onUpdate: () => after.shift()?.(),
    })
    await dispatchZomeCall(call, EDIT_CELL, 'fetch_outcomes', null)

    // first update: rename; the mount now holds the renamed record
    await dispatchZomeCall(call, EDIT_CELL, 'update_outcome', {
      actionHash: 'oB3',
      entry: outcomeEntry({ content: 'user rename' }),
    })

    // second update, another field: the baseline moved with the first result
    calls.length = 0
    await dispatchZomeCall(call, EDIT_CELL, 'update_outcome', {
      actionHash: 'oB3',
      entry: outcomeEntry({
        content: 'user rename',
        githubLink: 'user link',
      }),
    })
    const updates = calls.filter(
      (c) => c.method === 'perspective.updateSubject'
    )
    expect(JSON.parse(updates[0].params.values)).toEqual({
      githubLink: 'user link',
    })
  })

  test('no baseline still diffs against a fresh fetch', async () => {
    const inst = { ...outcomeInstance('oB9'), content: 'on the mount' }
    const { calls, call } = fakeWriteRpc({
      canned: () => ({ AcornOutcome: [inst] }),
    })
    // no fetch first: update falls back to fetching the current instance
    await dispatchZomeCall(call, EDIT_CELL, 'update_outcome', {
      actionHash: 'oB9',
      entry: outcomeEntry({ content: 'on the mount', description: 'd' }),
    })
    const updates = calls.filter(
      (c) => c.method === 'perspective.updateSubject'
    )
    expect(JSON.parse(updates[0].params.values)).toEqual({ description: 'd' })
  })
})
