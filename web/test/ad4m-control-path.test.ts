// Control-path coverage for the AD4M update row (Lal round 5 on C9): the
// real expanded-view controls render through their real save connectors —
// ConnectedExpandedViewMode -> ConnectedEvDetails/ConnectedEVRightColumn ->
// ProjectsZomeApi -> callZome -> dispatchZomeCall — and only the RPC
// transport is stubbed (same fake Ad4mAppClient as the presence test).
//
// - Escape close with an unedited githubLink declares and sends nothing.
// - Mounting the range picker is not a user edit: no timeFrame goes out.
// - Picking only the range's start date writes nothing either: a
//   half-picked range is a selection in progress, not a value (Lal round
//   6 on C10).
// - Clearing the range a peer added sends the model's clear (null).
// - Picking a range then picking back the one the picker opened with
//   declares no timeFrame on the last submit (the picker's changed flag).
// - Selecting a value that differs from what the control shows is declared
//   and sent even when it equals the stale view-open snapshot (the C9 fix).

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import moment from 'moment'
import { DateRangePicker } from 'react-dates'
import { Ad4mAppClient } from '../src/ad4m/Ad4mAppClient'
import { CellCtx } from '../src/ad4m/zomeTable'
import { urlToHash } from '../src/ad4m/mapping'
import { agentToDid } from '../src/ad4m/agent'
import { socketSurface } from '../src/ad4m/rpc'
import { cellIdToString } from '../src/utils'
import { getAppWs } from '../src/hcWebsockets'
import ProjectsZomeApi from '../src/api/projectsApi'
import { updateOutcome as updateOutcomeAction } from '../src/redux/persistent/projects/outcomes/actions'
import AppWebsocketContext from '../src/context/AppWebsocketContext'
import ConnectedExpandedViewMode from '../src/components/ExpandedViewMode/ExpandedViewMode.connector'
import OutcomeRangePicker from '../src/components/DatePicker/DatePicker'
import { ComputedScope, ComputedSimpleAchievementStatus } from '../src/types'

jest.mock('../src/hcWebsockets', () => ({
  getAppWs: jest.fn(),
  getWeaveClient: jest.fn(() => null),
}))
jest.mock('@theweave/api', () => ({
  isWeaveContext: () => false,
}))
// the markdown/title textareas pull in resize-observer machinery the node
// environment lacks; a plain textarea keeps the same props/behaviour
jest.mock('react-textarea-autosize', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: (props: any) => React.createElement('textarea', props),
  }
})
// react-dates needs a DOM; the pickers' props carry everything the tests
// drive, so the inner widgets render as inert stubs
jest.mock('react-dates', () => ({
  DateRangePicker: () => null,
  SingleDatePicker: () => null,
}))
jest.mock('react-dates/constants', () => ({
  START_DATE: 'startDate',
  END_DATE: 'endDate',
}))
jest.mock('react-dates/initialize', () => ({}))
// the visual shell (modal chrome, tabs) is not under test; the connector's
// real details and right-column slots are rendered so their own redux
// connectors and save paths stay live
jest.mock(
  '../src/components/ExpandedViewMode/ExpandedViewMode.component',
  () => {
    const React = require('react')
    return {
      __esModule: true,
      default: (props: any) =>
        React.createElement(
          React.Fragment,
          null,
          props.details,
          props.rightColumn
        ),
    }
  }
)

// a minimal document: OnClickOutside registers mousedown/touchstart it
// never sees fired, and the connector's Escape handler needs body.keyup
const docListeners: Record<string, Function[]> = {}
const addDocListener = (type: string, fn: Function) => {
  ;(docListeners[type] = docListeners[type] || []).push(fn)
}
const removeDocListener = (type: string, fn: Function) => {
  const l = docListeners[type]
  if (l) {
    const i = l.indexOf(fn)
    if (i >= 0) l.splice(i, 1)
  }
}
;(globalThis as any).document = {
  addEventListener: addDocListener,
  removeEventListener: removeDocListener,
  body: {
    addEventListener: addDocListener,
    removeEventListener: removeDocListener,
  },
}
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const DNA = new Uint8Array(39).fill(1)
const AGENT = new Uint8Array(39).fill(2)
const cellId: any = [DNA, AGENT]
const PROJECT_ID = cellIdToString(cellId)
const AGENT_B64 = 'uhCAkDsZGYpTXiihwf8CcfsbpLcyzmP_jMWv28biNaAknxgUudQnS'
const LANG = 'acornlang-ctl'
const OUTCOME_HASH = 'oCtl'
const GITHUB_LINK = 'https://github.com/acorn-o/acorn-r/issues/3'
const RANGE = { fromDate: 1790000000, toDate: 1791000000 }
// the project tag options the picker's rows are built from
const TAG_A = {
  actionHash: 'tagCtlA',
  text: 'Alpha',
  backgroundColor: '#1DA094',
}
const TAG_B = {
  actionHash: 'tagCtlB',
  text: 'Beta',
  backgroundColor: '#103BB1',
}
const TAG_C = {
  actionHash: 'tagCtlC',
  text: 'Gamma',
  backgroundColor: '#A0871D',
}
const tagUrl = (hash: string) => `${LANG}://${hash}`
const sameSet = (a: any[], b: any[]) =>
  a.length === b.length && a.every((x) => b.includes(x))

/** the mount-data shape perspective.modelQuery returns for the outcome */
const outcomeInstance = (over: any = {}) => ({
  id: `${LANG}://${OUTCOME_HASH}`,
  __subjectClass: 'AcornOutcome',
  content: 'an outcome',
  description: '',
  githubLink: '',
  scopeType: 'Uncertain',
  smallsEstimate: 0,
  inBreakdown: false,
  tags: [],
  creator: agentToDid(AGENT_B64),
  timestampCreated: 1763370000.0,
  isImported: false,
  entryHash: 'e',
  recordCreatedAt: 1,
  recordUpdatedAt: 1,
  ...over,
})

/** the ComputedOutcome the real ProjectView would hand the connector */
const computedOutcome = (inst: any, hash: string = OUTCOME_HASH) => {
  const scope =
    inst.scopeType === 'Small'
      ? {
          Small: {
            achievementStatus: inst.achievementStatus ?? 'NotAchieved',
            targetDate: inst.targetDate ?? null,
            taskList: JSON.parse(inst.taskList ?? '[]'),
          },
        }
      : {
          Uncertain: {
            timeFrame: inst.timeFrame != null ? JSON.parse(inst.timeFrame) : null,
            smallsEstimate: inst.smallsEstimate ?? 0,
            inBreakdown: inst.inBreakdown ?? false,
          },
        }
  return {
    actionHash: hash,
    content: inst.content,
    creatorAgentPubKey: AGENT_B64,
    editorAgentPubKey: null,
    timestampCreated: inst.timestampCreated,
    timestampUpdated: null,
    scope,
    tags: (inst.tags ?? []).map((t: string) => urlToHash(t, LANG)),
    description: inst.description,
    isImported: false,
    githubLink: inst.githubLink,
    computedScope:
      inst.scopeType === 'Small' ? ComputedScope.Small : ComputedScope.Uncertain,
    computedAchievementStatus: {
      uncertains: 0,
      smallsAchieved: 0,
      smallsTotal: 0,
      tasksTotal: 0,
      tasksAchieved: 0,
      simple: ComputedSimpleAchievementStatus.NotAchieved,
    },
    children: [],
  } as any
}

const makeStore = () =>
  createStore(
    // '@@test/set-state' moves the static state for tests that navigate
    // (e.g. the expanded view switching to another outcome)
    (s: any, a: any) => (a?.type === '@@test/set-state' ? a.state : s),
    {
      agentAddress: AGENT_B64,
      projects: {
        outcomeComments: { [PROJECT_ID]: {} },
        outcomeMembers: { [PROJECT_ID]: {} },
        tags: {
          [PROJECT_ID]: {
            [TAG_A.actionHash]: TAG_A,
            [TAG_B.actionHash]: TAG_B,
            [TAG_C.actionHash]: TAG_C,
          },
        },
        members: { [PROJECT_ID]: { members: {}, profiles: [] } },
        entryPoints: { [PROJECT_ID]: {} },
        projectMeta: { [PROJECT_ID]: { topPriorityOutcomes: [] } },
      },
      ui: {
        activeProject: PROJECT_ID,
        realtimeInfo: {},
        expandedView: { outcomeActionHash: OUTCOME_HASH },
        outcomeEditing: {},
      },
    } as any
  )

const flush = () => new Promise((r) => setTimeout(r, 0))

/** an Ad4mAppClient-shaped fake over a mutable mounted instance; only
 *  rpc.call is a stub — zome rows, mapping and baselines all run for real */
const makeWorld = (initialInstance: any) => {
  const transport = { readyState: 1 /* OPEN */ }
  const calls: { method: string; params: any }[] = []
  let current: any = initialInstance
  // a manual gate on perspective.updateSubject: while held, submissions are
  // recorded but the write neither applies to the mount data nor resolves,
  // modelling a write round trip the user can out-click. Released in
  // submission order — the picker does not promise ordering against a
  // transport that commits writes out of order
  let holdUpdates = false
  const heldUpdates: { release: () => void }[] = []
  const cellCtx: CellCtx = {
    uuid: 'persp-uuid-ctl',
    lang: LANG,
    info: { seed: 'uid-ctl', agentPubKey: AGENT_B64 },
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
          ? [current].filter((r: any) => r.id === q.where.id)
          : [current]
        return { instances: rows }
      }
      if (method === 'perspective.updateSubject') {
        const apply = () => {
          if (current?.id === params.expressionAddress) {
            Object.assign(current, JSON.parse(params.values))
          }
          return true
        }
        if (!holdUpdates) return apply()
        return new Promise((resolve) => {
          heldUpdates.push({ release: () => resolve(apply()) })
        })
      }
      if (method === 'expression.interact') return null
      throw new Error(`unexpected rpc ${method}`)
    }),
  }
  const fetch = () =>
    client.callZome({
      cell_id: cellId,
      zome_name: 'projects',
      fn_name: 'fetch_outcomes',
      payload: null,
    })
  // the presence emit a real view-open makes; captures the edit-session
  // record baseline from the latest remote state
  const openPresence = () =>
    client.callZome({
      cell_id: cellId,
      zome_name: 'projects',
      fn_name: 'emit_realtime_info_signal',
      payload: {
        outcomeExpandedView: OUTCOME_HASH,
        outcomeBeingEdited: null,
      },
    })
  const updateValues = () =>
    calls
      .filter((c) => c.method === 'perspective.updateSubject')
      .map((c) => JSON.parse(c.params.values))
  return {
    client,
    calls,
    fetch,
    openPresence,
    updateValues,
    holdUpdateWrites: () => {
      holdUpdates = true
    },
    heldUpdateCount: () => heldUpdates.length,
    releaseNextUpdate: () => heldUpdates.shift()?.release(),
    // drain the gate AND the writes queued behind it in callZome's
    // per-cell write queue: each release lets the next queued submission
    // reach the gate, so loop until two ticks see nothing new
    settleWrites: async () => {
      for (let i = 0; i < 20; i++) {
        while (heldUpdates.length) heldUpdates.shift()!.release()
        await new Promise((r) => setTimeout(r, 0))
        if (!heldUpdates.length) {
          await new Promise((r) => setTimeout(r, 0))
          if (!heldUpdates.length) return
        }
      }
    },
    setRemote: (inst: any) => {
      current = inst
    },
    get current() {
      return current
    },
  }
}

/** render the real connector with a ProjectView-shaped updateOutcome prop
 *  (its connector does the same getAppWs -> api -> dispatch chain) */
const makeRenderer = (world: any) => {
  const store = makeStore()
  const onClose = jest.fn()
  // the dirtyProps each updateOutcome call carried: what the control
  // declared its user changed, before the adapter diff applies
  const declared: (string[] | undefined)[] = []
  const props = (outcome: any) => ({
    projectId: PROJECT_ID,
    openExpandedView: () => {},
    activeAgentPubKey: AGENT_B64,
    outcome,
    outcomeAndAncestors: [outcome],
    onClose,
    updateOutcome: async (o: any, actionHash: string, dirtyProps?: string[]) => {
      declared.push(dirtyProps)
      const appWebsocket = await getAppWs()
      const api = new ProjectsZomeApi(appWebsocket)
      const wire = await api.outcome.update(cellId, {
        entry: o,
        actionHash,
        dirtyProps,
      })
      return store.dispatch(updateOutcomeAction(PROJECT_ID, wire))
    },
    createOutcomeWithConnection: async () => {},
  })
  const tree = (outcome: any) =>
    React.createElement(
      Provider,
      { store },
      React.createElement(
        AppWebsocketContext.Provider,
        { value: world.client },
        React.createElement(ConnectedExpandedViewMode as any, props(outcome))
      )
    )
  return { store, onClose, tree, declared }
}

const findByClass = (root: any, klass: string) =>
  root.findAll(
    (n: any) =>
      typeof n.props.className === 'string' &&
      n.props.className.split(' ')[0] === klass
  )

/** the picker's tag rows, identified by the option text their Tag shows */
const tagPickerRows = (root: any) =>
  findByClass(root, 'tag-picker-selectable-area')
const tagRowFor = (root: any, text: string) =>
  tagPickerRows(root).find(
    (r: any) =>
      r.findAll((n: any) => n.props && n.props.text === text).length > 0
  )
const addTagButton = (root: any) =>
  findByClass(root, 'add-tag-button')[0]

describe('expanded-view controls through the real connector', () => {
  let renderer: TestRenderer.ReactTestRenderer | undefined
  let activeWorld: any = null

  beforeEach(() => {
    jest.clearAllMocks()
    for (const k of Object.keys(docListeners)) delete docListeners[k]
    activeWorld = null
  })

  afterEach(async () => {
    // a held write never released stalls the per-cell write queue for the
    // next test — drain the gate even when the test failed mid-assertion
    if (activeWorld) {
      await act(async () => {
        await activeWorld.settleWrites()
      })
    }
    renderer?.unmount()
    renderer = undefined
  })

  it('Escape close with an unedited githubLink sends no githubLink', async () => {
    const world = makeWorld(outcomeInstance({ githubLink: GITHUB_LINK }))
    ;(getAppWs as jest.Mock).mockResolvedValue(world.client)
    await world.fetch()
    await world.openPresence()

    const { onClose, tree } = makeRenderer(world)
    await act(async () => {
      renderer = TestRenderer.create(tree(computedOutcome(world.current)))
    })

    const handlers = docListeners['keyup'] || []
    await act(async () => {
      await handlers[handlers.length - 1]({ key: 'Escape' })
    })
    await act(async () => flush())

    expect(onClose).toHaveBeenCalled()
    const updates = world.updateValues()
    expect(updates.length).toBeGreaterThan(0)
    expect(updates.every((v) => !('githubLink' in v))).toBe(true)
  })

  it('mounting the range picker sends no timeFrame', async () => {
    const world = makeWorld(
      outcomeInstance({ timeFrame: JSON.stringify(RANGE) })
    )
    ;(getAppWs as jest.Mock).mockResolvedValue(world.client)
    await world.fetch()
    await world.openPresence()

    const { tree } = makeRenderer(world)
    await act(async () => {
      renderer = TestRenderer.create(tree(computedOutcome(world.current)))
    })

    const timeDisplay = findByClass(renderer!.root, 'ev-time-display')[0]
    await act(async () => {
      timeDisplay.props.onClick()
    })
    await act(async () => flush())

    expect(world.updateValues().every((v) => !('timeFrame' in v))).toBe(true)
  })

  it('a half-picked range writes nothing when the picker closes', async () => {
    const world = makeWorld(
      outcomeInstance({ timeFrame: JSON.stringify(RANGE) })
    )
    ;(getAppWs as jest.Mock).mockResolvedValue(world.client)
    await world.fetch()
    await world.openPresence()

    const { tree } = makeRenderer(world)
    await act(async () => {
      renderer = TestRenderer.create(tree(computedOutcome(world.current)))
    })

    const timeDisplay = findByClass(renderer!.root, 'ev-time-display')[0]
    await act(async () => {
      timeDisplay.props.onClick()
    })
    const drp = renderer!.root.findByType(DateRangePicker)
    // the first click of a new range: react-dates reports the start date
    // alone with the end still null — a selection in progress, not a value
    await act(async () => {
      drp.props.onDatesChange({
        startDate: moment.unix(RANGE.toDate + 86400),
        endDate: null,
      })
    })
    // closing after the half pick must keep the stored range
    const picker = renderer!.root.findByType(OutcomeRangePicker)
    await act(async () => {
      picker.props.onClose()
    })
    await act(async () => flush())

    expect(world.updateValues().every((v) => !('timeFrame' in v))).toBe(true)
  })

  it('a range picked back to its opened-with value declares no timeFrame', async () => {
    const world = makeWorld(
      outcomeInstance({ timeFrame: JSON.stringify(RANGE) })
    )
    ;(getAppWs as jest.Mock).mockResolvedValue(world.client)
    await world.fetch()
    await world.openPresence()

    const { tree, declared } = makeRenderer(world)
    await act(async () => {
      renderer = TestRenderer.create(tree(computedOutcome(world.current)))
    })

    const timeDisplay = findByClass(renderer!.root, 'ev-time-display')[0]
    await act(async () => {
      timeDisplay.props.onClick()
    })
    const drp = renderer!.root.findByType(DateRangePicker)
    // pick a new range, then pick back the range the picker opened with
    // (each range is start click then end click): the last submit reverts
    // to the picker's own original, so it declares nothing
    const NEW = {
      fromDate: RANGE.fromDate + 86400,
      toDate: RANGE.toDate + 86400,
    }
    for (const pick of [
      { startDate: moment.unix(NEW.fromDate), endDate: null },
      {
        startDate: moment.unix(NEW.fromDate),
        endDate: moment.unix(NEW.toDate),
      },
      { startDate: moment.unix(RANGE.fromDate), endDate: null },
      {
        startDate: moment.unix(RANGE.fromDate),
        endDate: moment.unix(RANGE.toDate),
      },
    ]) {
      await act(async () => {
        drp.props.onDatesChange(pick)
      })
      await act(async () => flush())
    }

    expect(declared.length).toBeGreaterThan(0)
    expect(
      (declared[declared.length - 1] ?? []).includes('timeFrame')
    ).toBe(false)
  })

  it('clearing the range picker sends the timeFrame clear', async () => {
    const world = makeWorld(outcomeInstance())
    ;(getAppWs as jest.Mock).mockResolvedValue(world.client)
    await world.fetch()
    await world.openPresence()

    const { tree } = makeRenderer(world)
    await act(async () => {
      renderer = TestRenderer.create(tree(computedOutcome(world.current)))
    })

    // a peer adds a range mid-view; the remote baseline moves with it
    const peerInst = outcomeInstance({ timeFrame: JSON.stringify(RANGE) })
    world.setRemote(peerInst)
    await world.fetch()
    await act(async () => {
      renderer!.update(tree(computedOutcome(peerInst)))
    })

    const timeDisplay = findByClass(renderer!.root, 'ev-time-display')[0]
    await act(async () => {
      timeDisplay.props.onClick()
    })
    const drp = renderer!.root.findByType(DateRangePicker)
    await act(async () => {
      drp.props.onDatesChange({ startDate: null, endDate: null })
    })
    await act(async () => flush())

    const updates = world.updateValues()
    expect(
      updates.some((v) => 'timeFrame' in v && v.timeFrame === null)
    ).toBe(true)
  })

  it('a status revert to the control original still goes out', async () => {
    const world = makeWorld(
      outcomeInstance({
        scopeType: 'Small',
        achievementStatus: 'NotAchieved',
        taskList: '[]',
      })
    )
    ;(getAppWs as jest.Mock).mockResolvedValue(world.client)
    await world.fetch()
    await world.openPresence()

    const { tree } = makeRenderer(world)
    await act(async () => {
      renderer = TestRenderer.create(tree(computedOutcome(world.current)))
    })

    // a peer moves the status mid-view
    const peerInst = outcomeInstance({
      scopeType: 'Small',
      achievementStatus: 'Achieved',
      taskList: '[]',
    })
    world.setRemote(peerInst)
    await world.fetch()
    await act(async () => {
      renderer!.update(tree(computedOutcome(peerInst)))
    })

    // the user sets the value the control opened with: a real change from
    // 'Achieved' that must still be declared and sent
    const dropdownButton = findByClass(
      renderer!.root,
      'select-dropdown-button'
    )[0]
    await act(async () => {
      dropdownButton.props.onClick()
    })
    const options = findByClass(
      renderer!.root,
      'select-dropdown-menu-option'
    )
    await act(async () => {
      options[1].props.onClick() // 'Not Achieved'
    })
    await act(async () => flush())

    const updates = world.updateValues()
    expect(
      updates.some((v) => v.achievementStatus === 'NotAchieved')
    ).toBe(true)
  })

  it('two tag toggles in one write round trip keep both selections', async () => {
    const world = makeWorld(outcomeInstance({ tags: [] }))
    ;(getAppWs as jest.Mock).mockResolvedValue(world.client)
    await world.fetch()
    await world.openPresence()
    world.holdUpdateWrites()
    activeWorld = world

    const { tree, declared } = makeRenderer(world)
    await act(async () => {
      renderer = TestRenderer.create(tree(computedOutcome(world.current)))
    })

    await act(async () => {
      addTagButton(renderer!.root).props.onClick()
    })
    const rowA = tagRowFor(renderer!.root, TAG_A.text)!
    const rowB = tagRowFor(renderer!.root, TAG_B.text)!

    // both toggles inside the same synchronous act: no rerender and no RPC
    // resolution between them — the second click must still see the first.
    // callZome serializes a cell's writes, so the second updateSubject
    // submits only after the first resolves; the submissions still record
    // in click order at the gate
    await act(async () => {
      rowA.props.onClick()
      rowB.props.onClick()
    })
    await act(async () => flush())

    expect(declared.length).toBe(2)
    expect(declared.every((d) => (d ?? []).includes('tags'))).toBe(true)
    let tagWrites = world.updateValues().filter((v) => 'tags' in v)
    expect(tagWrites.length).toBe(1)
    expect(world.heldUpdateCount()).toBe(1)
    expect(sameSet(tagWrites[0].tags, [tagUrl(TAG_A.actionHash)])).toBe(true)

    // release the first write; the queued second submission reaches the gate
    await act(async () => {
      world.releaseNextUpdate()
      await flush()
    })
    tagWrites = world.updateValues().filter((v) => 'tags' in v)
    expect(tagWrites.length).toBe(2)
    expect(
      sameSet(tagWrites[1].tags, [
        tagUrl(TAG_A.actionHash),
        tagUrl(TAG_B.actionHash),
      ])
    ).toBe(true)

    // release the second; the last write persists both tags
    await act(async () => {
      await world.settleWrites()
      await flush()
    })
    expect(
      sameSet(world.current.tags, [
        tagUrl(TAG_A.actionHash),
        tagUrl(TAG_B.actionHash),
      ])
    ).toBe(true)

    // props catching up to the last submission issues no third write
    await act(async () => {
      renderer!.update(tree(computedOutcome(world.current)))
    })
    await act(async () => flush())
    expect(world.updateValues().filter((v) => 'tags' in v).length).toBe(2)
  })

  it('an intermediate echo keeps pending, so a third toggle keeps all three', async () => {
    const world = makeWorld(outcomeInstance({ tags: [] }))
    ;(getAppWs as jest.Mock).mockResolvedValue(world.client)
    await world.fetch()
    await world.openPresence()
    world.holdUpdateWrites()
    activeWorld = world

    const { tree } = makeRenderer(world)
    await act(async () => {
      renderer = TestRenderer.create(tree(computedOutcome(world.current)))
    })

    await act(async () => {
      addTagButton(renderer!.root).props.onClick()
    })

    // toggles 1 and 2 inside the held round trip submit [A] then [A,B]
    await act(async () => {
      tagRowFor(renderer!.root, TAG_A.text)!.props.onClick()
      tagRowFor(renderer!.root, TAG_B.text)!.props.onClick()
    })
    await act(async () => flush())

    // write 1 lands and its echo reaches the picker while write 2 is
    // still out: props [A] is a list this picker submitted, not a peer
    // change — pending [A,B] must survive it
    await act(async () => {
      world.releaseNextUpdate()
      await flush()
    })
    await act(async () => {
      renderer!.update(tree(computedOutcome(world.current)))
    })
    await act(async () => flush())

    // the third toggle must still build on the pending [A,B]
    await act(async () => {
      tagRowFor(renderer!.root, TAG_C.text)!.props.onClick()
    })
    await act(async () => flush())

    await act(async () => {
      await world.settleWrites()
      await flush()
    })
    const tagWrites = world.updateValues().filter((v) => 'tags' in v)
    expect(tagWrites.length).toBe(3)
    expect(sameSet(tagWrites[0].tags, [tagUrl(TAG_A.actionHash)])).toBe(true)
    expect(
      sameSet(tagWrites[1].tags, [
        tagUrl(TAG_A.actionHash),
        tagUrl(TAG_B.actionHash),
      ])
    ).toBe(true)
    expect(
      sameSet(tagWrites[2].tags, [
        tagUrl(TAG_A.actionHash),
        tagUrl(TAG_B.actionHash),
        tagUrl(TAG_C.actionHash),
      ])
    ).toBe(true)
    expect(
      sameSet(world.current.tags, [
        tagUrl(TAG_A.actionHash),
        tagUrl(TAG_B.actionHash),
        tagUrl(TAG_C.actionHash),
      ])
    ).toBe(true)
  })

  it('a remove then re-add of the same tag submits the revert as dirty', async () => {
    const world = makeWorld(
      outcomeInstance({ tags: [tagUrl(TAG_A.actionHash)] })
    )
    ;(getAppWs as jest.Mock).mockResolvedValue(world.client)
    await world.fetch()
    await world.openPresence()
    world.holdUpdateWrites()
    activeWorld = world

    const { tree, declared } = makeRenderer(world)
    await act(async () => {
      renderer = TestRenderer.create(tree(computedOutcome(world.current)))
    })

    await act(async () => {
      addTagButton(renderer!.root).props.onClick()
    })
    const rowA = tagRowFor(renderer!.root, TAG_A.text)!

    // uncheck A then check A again inside one act: the second click must
    // toggle from the first click's list, not from the rendered [A]
    await act(async () => {
      rowA.props.onClick()
      rowA.props.onClick()
    })
    await act(async () => flush())

    expect(declared.length).toBe(2)
    let tagWrites = world.updateValues().filter((v) => 'tags' in v)
    expect(tagWrites.length).toBe(1)
    expect(tagWrites[0].tags.length).toBe(0)

    await act(async () => {
      await world.settleWrites()
      await flush()
    })
    tagWrites = world.updateValues().filter((v) => 'tags' in v)
    expect(tagWrites.length).toBe(2)
    expect(sameSet(tagWrites[1].tags, [tagUrl(TAG_A.actionHash)])).toBe(true)
    // the final list equals what the props showed, but the user DID change
    // the selection from its immediately-preceding visible state — the
    // revert must still be declared so the baseline diff does not drop it
    expect(declared.every((d) => (d ?? []).includes('tags'))).toBe(true)
    expect(sameSet(world.current.tags, [tagUrl(TAG_A.actionHash)])).toBe(true)
  })

  it('an add then remove of the same tag submits an explicit clear', async () => {
    const world = makeWorld(outcomeInstance({ tags: [] }))
    ;(getAppWs as jest.Mock).mockResolvedValue(world.client)
    await world.fetch()
    await world.openPresence()
    world.holdUpdateWrites()
    activeWorld = world

    const { tree, declared } = makeRenderer(world)
    await act(async () => {
      renderer = TestRenderer.create(tree(computedOutcome(world.current)))
    })

    await act(async () => {
      addTagButton(renderer!.root).props.onClick()
    })
    const rowA = tagRowFor(renderer!.root, TAG_A.text)!

    await act(async () => {
      rowA.props.onClick()
      rowA.props.onClick()
    })
    await act(async () => flush())

    expect(declared.length).toBe(2)
    let tagWrites = world.updateValues().filter((v) => 'tags' in v)
    expect(tagWrites.length).toBe(1)
    expect(sameSet(tagWrites[0].tags, [tagUrl(TAG_A.actionHash)])).toBe(true)

    await act(async () => {
      await world.settleWrites()
      await flush()
    })
    tagWrites = world.updateValues().filter((v) => 'tags' in v)
    expect(tagWrites.length).toBe(2)
    // the empty final list is a real edit and goes out declared
    expect('tags' in tagWrites[1] && tagWrites[1].tags.length === 0).toBe(true)
    expect(declared.every((d) => (d ?? []).includes('tags'))).toBe(true)
    expect(sameSet(world.current.tags, [])).toBe(true)
  })

  it('a peer change while pending resets the next toggle to the peer list', async () => {
    const world = makeWorld(outcomeInstance({ tags: [] }))
    ;(getAppWs as jest.Mock).mockResolvedValue(world.client)
    await world.fetch()
    await world.openPresence()
    world.holdUpdateWrites()
    activeWorld = world

    const { tree } = makeRenderer(world)
    await act(async () => {
      renderer = TestRenderer.create(tree(computedOutcome(world.current)))
    })

    await act(async () => {
      addTagButton(renderer!.root).props.onClick()
    })
    await act(async () => {
      tagRowFor(renderer!.root, TAG_A.text)!.props.onClick()
    })
    await act(async () => flush())

    // a content-different prop list lands while our write is still out:
    // pending resets and the next toggle starts from the peer list
    const peerInst = outcomeInstance({ tags: [tagUrl(TAG_C.actionHash)] })
    world.setRemote(peerInst)
    await world.fetch()
    await act(async () => {
      renderer!.update(tree(computedOutcome(peerInst)))
    })
    await act(async () => {
      tagRowFor(renderer!.root, TAG_B.text)!.props.onClick()
    })
    await act(async () => flush())

    await act(async () => {
      await world.settleWrites()
      await flush()
    })
    const tagWrites = world.updateValues().filter((v) => 'tags' in v)
    expect(tagWrites.length).toBe(2)
    expect(sameSet(tagWrites[0].tags, [tagUrl(TAG_A.actionHash)])).toBe(true)
    expect(
      sameSet(tagWrites[1].tags, [
        tagUrl(TAG_C.actionHash),
        tagUrl(TAG_B.actionHash),
      ])
    ).toBe(true)
  })

  it('an unchanged-content rerender retains the pending selection', async () => {
    const world = makeWorld(outcomeInstance({ tags: [] }))
    ;(getAppWs as jest.Mock).mockResolvedValue(world.client)
    await world.fetch()
    await world.openPresence()
    world.holdUpdateWrites()
    activeWorld = world

    const { tree } = makeRenderer(world)
    await act(async () => {
      renderer = TestRenderer.create(tree(computedOutcome(world.current)))
    })

    await act(async () => {
      addTagButton(renderer!.root).props.onClick()
    })
    await act(async () => {
      tagRowFor(renderer!.root, TAG_A.text)!.props.onClick()
    })
    await act(async () => flush())

    // an unrelated rerender with a fresh [] array must not drop the
    // pending selection — contents, not identity, decide
    await act(async () => {
      renderer!.update(tree(computedOutcome(world.current)))
    })
    await act(async () => {
      tagRowFor(renderer!.root, TAG_B.text)!.props.onClick()
    })
    await act(async () => {
      await world.settleWrites()
      await flush()
    })

    const tagWrites = world.updateValues().filter((v) => 'tags' in v)
    expect(tagWrites.length).toBe(2)
    expect(
      sameSet(tagWrites[1].tags, [
        tagUrl(TAG_A.actionHash),
        tagUrl(TAG_B.actionHash),
      ])
    ).toBe(true)
  })

  it('close and reopen before catch-up retains the pending selection', async () => {
    const world = makeWorld(outcomeInstance({ tags: [] }))
    ;(getAppWs as jest.Mock).mockResolvedValue(world.client)
    await world.fetch()
    await world.openPresence()
    world.holdUpdateWrites()
    activeWorld = world

    const { tree } = makeRenderer(world)
    await act(async () => {
      renderer = TestRenderer.create(tree(computedOutcome(world.current)))
    })

    await act(async () => {
      addTagButton(renderer!.root).props.onClick()
    })
    await act(async () => {
      tagRowFor(renderer!.root, TAG_A.text)!.props.onClick()
    })
    await act(async () => flush())

    // close, then reopen before the write resolves: the pending selection
    // survives on the still-mounted picker, and nothing resends
    await act(async () => {
      addTagButton(renderer!.root).props.onClick()
    })
    await act(async () => {
      addTagButton(renderer!.root).props.onClick()
    })
    await act(async () => flush())
    expect(world.updateValues().filter((v) => 'tags' in v).length).toBe(1)

    await act(async () => {
      tagRowFor(renderer!.root, TAG_B.text)!.props.onClick()
    })
    await act(async () => flush())
    // the second submission is queued behind the first, still held
    expect(world.updateValues().filter((v) => 'tags' in v).length).toBe(1)

    await act(async () => {
      await world.settleWrites()
      await flush()
    })
    const tagWrites = world.updateValues().filter((v) => 'tags' in v)
    expect(tagWrites.length).toBe(2)
    expect(
      sameSet(tagWrites[1].tags, [
        tagUrl(TAG_A.actionHash),
        tagUrl(TAG_B.actionHash),
      ])
    ).toBe(true)
  })

  it('switching the outcome does not leak a pending selection', async () => {
    const world = makeWorld(outcomeInstance({ tags: [] }))
    ;(getAppWs as jest.Mock).mockResolvedValue(world.client)
    await world.fetch()
    await world.openPresence()
    world.holdUpdateWrites()
    activeWorld = world

    const { store, tree } = makeRenderer(world)
    await act(async () => {
      renderer = TestRenderer.create(tree(computedOutcome(world.current)))
    })

    await act(async () => {
      addTagButton(renderer!.root).props.onClick()
    })
    await act(async () => {
      tagRowFor(renderer!.root, TAG_A.text)!.props.onClick()
    })
    await act(async () => flush())
    expect(world.updateValues().filter((v) => 'tags' in v).length).toBe(1)

    // let the first write land while the view still names this outcome,
    // then move the expanded view to another outcome: its picker owns a
    // fresh selection, and the old outcome's pending list must not leak in
    await act(async () => {
      await world.settleWrites()
      await flush()
    })
    const otherHash = 'oCtl2'
    const otherInst = outcomeInstance({
      id: tagUrl(otherHash),
      tags: [],
    })
    world.setRemote(otherInst)
    await world.fetch()
    const nextState = {
      ...store.getState(),
      ui: {
        ...store.getState().ui,
        expandedView: { outcomeActionHash: otherHash },
      },
    }
    await act(async () => {
      store.dispatch({ type: '@@test/set-state', state: nextState })
      renderer!.update(tree(computedOutcome(otherInst, otherHash)))
    })

    // a keyed TagsList remounts closed for the new outcome; open it first
    if (!tagPickerRows(renderer!.root).length) {
      await act(async () => {
        addTagButton(renderer!.root).props.onClick()
      })
    }
    await act(async () => {
      tagRowFor(renderer!.root, TAG_B.text)!.props.onClick()
    })
    await act(async () => {
      await world.settleWrites()
      await flush()
    })

    const tagCalls = world.calls.filter(
      (c) =>
        c.method === 'perspective.updateSubject' &&
        'tags' in JSON.parse(c.params.values)
    )
    expect(tagCalls.length).toBe(2)
    expect(tagCalls[1].params.expressionAddress).toBe(tagUrl(otherHash))
    const secondValues = JSON.parse(tagCalls[1].params.values)
    expect(sameSet(secondValues.tags, [tagUrl(TAG_B.actionHash)])).toBe(true)
  })
})
