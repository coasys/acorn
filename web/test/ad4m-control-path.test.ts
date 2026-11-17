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
const computedOutcome = (inst: any) => {
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
    actionHash: OUTCOME_HASH,
    content: inst.content,
    creatorAgentPubKey: AGENT_B64,
    editorAgentPubKey: null,
    timestampCreated: inst.timestampCreated,
    timestampUpdated: null,
    scope,
    tags: [],
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
  createStore((s: any) => s, {
    agentAddress: AGENT_B64,
    projects: {
      outcomeComments: { [PROJECT_ID]: {} },
      outcomeMembers: { [PROJECT_ID]: {} },
      tags: { [PROJECT_ID]: {} },
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
  } as any)

const flush = () => new Promise((r) => setTimeout(r, 0))

/** an Ad4mAppClient-shaped fake over a mutable mounted instance; only
 *  rpc.call is a stub — zome rows, mapping and baselines all run for real */
const makeWorld = (initialInstance: any) => {
  const transport = { readyState: 1 /* OPEN */ }
  const calls: { method: string; params: any }[] = []
  let current: any = initialInstance
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
        if (current?.id === params.expressionAddress) {
          Object.assign(current, JSON.parse(params.values))
        }
        return true
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

describe('expanded-view controls through the real connector', () => {
  let renderer: TestRenderer.ReactTestRenderer | undefined

  beforeEach(() => {
    jest.clearAllMocks()
    for (const k of Object.keys(docListeners)) delete docListeners[k]
  })

  afterEach(() => {
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
})
