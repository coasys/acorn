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
    if (method === 'perspective.updateSubject') return true
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
})
