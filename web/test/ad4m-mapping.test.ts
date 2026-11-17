// Round-trip tests for the AD4M <-> Acorn entry mapping (spec C1).
// Fixtures mirror the language's mapping.test fixtures
// (~/code/acorn-ad4m/language/test/unit/fixtures.ts): an instance as
// perspective.modelQuery returns it ({id, __subjectClass, ...mount props})
// maps back to the WireRecord the UI's reducers expect, and an entry maps to
// mount values (toValues, for writes) and back to the same entry.
import { agentToDid } from '../src/ad4m/agent'
import {
  toEntry,
  toValues,
  toWireRecord,
  seedToPassphrase,
} from '../src/ad4m/mapping'

const LANG = 'acornlang'
const SEED = 'uid-rig-test-project'
const ctx = { lang: LANG, seed: SEED }
const url = (h: string) => `${LANG}://${h}`

const AGENT_A = 'uhCAkDsZGYpTXiihwf8CcfsbpLcyzmP_jMWv28biNaAknxgUudQnS'
const AGENT_B = 'uhCAk4vA0NdZ55vQYDvbdNKf23Emrho0SHs8KlgxA8pVD4aG_aGbO'
const OUTCOME_A =
  'uhCkkb3V0Y29tZUEuLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi5sb2Mh'
const OUTCOME_B =
  'uhCkkb3V0Y29tZUIuLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi5sb2Mh'
const CONNECTION_AB =
  'uhCkkY29ubkFCLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi5sb2Mh'
const TAG_T = 'uhCkkdGFnVC4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi5sb2Mh'
const COMMENT_1 =
  'uhCkkY29tbWVudDEuLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi5sb2Mh'
const ENTRY_POINT_1 =
  'uhCkkZXAxLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi5sb2Mh'
const OUTCOME_MEMBER_1 =
  'uhCkkb20xLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi5sb2Mh'
const PROJECT_META =
  'uhCkkbWV0YTEuLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi5sb2Mh'
const MEMBER_1 = 'uhCkkbWVtYmVyMS4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi5sb2Mh'
const ENTRY_HASH = 'uhCkkZW50cnkLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi5sb2Mh'

const CREATED = 1763370000123456
const UPDATED = 1763370111456789

function smallOutcomeEntry() {
  return {
    content: 'Write the spec',
    creatorAgentPubKey: AGENT_A,
    editorAgentPubKey: AGENT_B,
    timestampCreated: 1763370000.123,
    timestampUpdated: 1763370111.456,
    scope: {
      Small: {
        achievementStatus: 'NotAchieved',
        targetDate: 1763500000.5,
        taskList: [
          { complete: false, task: 'draft' },
          { complete: true, task: 'review' },
        ],
      },
    },
    tags: [TAG_T],
    description: 'the description',
    isImported: false,
    githubLink: 'https://github.com/x/y',
  }
}

function uncertainOutcomeEntry() {
  return {
    content: 'Big thing',
    creatorAgentPubKey: AGENT_A,
    editorAgentPubKey: null,
    timestampCreated: 1763370000.0,
    timestampUpdated: null,
    scope: {
      Uncertain: {
        smallsEstimate: 5,
        timeFrame: { fromDate: 1763400000.0, toDate: 1763700000.0 },
        inBreakdown: true,
      },
    },
    tags: [],
    description: '',
    isImported: true,
    githubLink: '',
  }
}

function connectionEntry() {
  return {
    parentActionHash: OUTCOME_A,
    childActionHash: OUTCOME_B,
    siblingOrder: 0,
    randomizer: 1763370000999,
    isImported: false,
  }
}

function entryPointEntry() {
  return {
    color: '#aabbcc',
    creatorAgentPubKey: AGENT_A,
    createdAt: 1763370001.25,
    outcomeActionHash: OUTCOME_A,
    isImported: false,
  }
}

function outcomeCommentEntry() {
  return {
    outcomeActionHash: OUTCOME_A,
    content: 'a comment',
    creatorAgentPubKey: AGENT_A,
    unixTimestamp: 1763370002.5,
    isImported: false,
  }
}

function outcomeMemberEntry() {
  return {
    outcomeActionHash: OUTCOME_A,
    memberAgentPubKey: AGENT_B,
    creatorAgentPubKey: AGENT_A,
    unixTimestamp: 1763370003.5,
    isImported: false,
  }
}

function tagEntry() {
  return { backgroundColor: '#112233', text: 'urgent' }
}

function projectMetaEntry() {
  return {
    creatorAgentPubKey: AGENT_A,
    createdAt: 1763370004.5,
    name: 'Rig Project',
    image: 'data:image/png;base64,xx',
    passphrase: 'rig test project',
    isImported: false,
    layeringAlgorithm: 'LongestPath',
    topPriorityOutcomes: [OUTCOME_A, OUTCOME_B],
    isMigrated: '0.7',
  }
}

function memberEntry() {
  return { agentPubKey: AGENT_A }
}

function profileEntry() {
  return {
    firstName: 'Stock',
    lastName: 'Rig',
    handle: 'stockrig',
    status: 'Online',
    avatarUrl: '',
    agentPubKey: AGENT_A,
    isImported: false,
  }
}

// The mount-prop view of each fixture entry — what modelQuery instances
// carry (the language's toData output).
function mountProps(className: string): Record<string, unknown> {
  switch (className) {
    case 'AcornOutcome':
      return {
        content: 'Write the spec',
        description: 'the description',
        githubLink: 'https://github.com/x/y',
        scopeType: 'Small',
        achievementStatus: 'NotAchieved',
        targetDate: 1763500000.5,
        taskList: JSON.stringify([
          { complete: false, task: 'draft' },
          { complete: true, task: 'review' },
        ]),
        tags: [url(TAG_T)],
        creator: agentToDid(AGENT_A),
        editor: agentToDid(AGENT_B),
        timestampCreated: 1763370000.123,
        timestampUpdated: 1763370111.456,
        isImported: false,
      }
    case 'AcornConnection':
      return {
        parent: url(OUTCOME_A),
        child: url(OUTCOME_B),
        siblingOrder: 0,
        randomizer: 1763370000999,
        isImported: false,
      }
    case 'AcornEntryPoint':
      return {
        color: '#aabbcc',
        outcome: url(OUTCOME_A),
        creator: agentToDid(AGENT_A),
        createdAtTime: 1763370001.25,
        isImported: false,
      }
    case 'AcornOutcomeComment':
      return {
        outcome: url(OUTCOME_A),
        content: 'a comment',
        creator: agentToDid(AGENT_A),
        unixTimestamp: 1763370002.5,
        isImported: false,
      }
    case 'AcornOutcomeMember':
      return {
        outcome: url(OUTCOME_A),
        member: agentToDid(AGENT_B),
        creator: agentToDid(AGENT_A),
        unixTimestamp: 1763370003.5,
        isImported: false,
      }
    case 'AcornTag':
      return { text: 'urgent', backgroundColor: '#112233' }
    case 'AcornProjectMeta':
      return {
        name: 'Rig Project',
        image: 'data:image/png;base64,xx',
        layeringAlgorithm: 'LongestPath',
        topPriorityOutcomes: [url(OUTCOME_A), url(OUTCOME_B)],
        creator: agentToDid(AGENT_A),
        createdAtTime: 1763370004.5,
        isImported: false,
        isMigrated: '0.7',
        // no passphrase — never mounted
      }
    case 'AcornMember':
      return { agent: agentToDid(AGENT_A) }
    case 'AcornProfile':
      return {
        firstName: 'Stock',
        lastName: 'Rig',
        handle: 'stockrig',
        status: 'Online',
        avatarUrl: '',
        agent: agentToDid(AGENT_A),
        agentPubKey: AGENT_A,
        isImported: false,
      }
    default:
      throw new Error(`fixture: unknown class ${className}`)
  }
}

const CASES: { className: string; id: string; entry: () => any }[] = [
  { className: 'AcornOutcome', id: url(OUTCOME_A), entry: smallOutcomeEntry },
  { className: 'AcornConnection', id: url(CONNECTION_AB), entry: connectionEntry },
  { className: 'AcornEntryPoint', id: url(ENTRY_POINT_1), entry: entryPointEntry },
  {
    className: 'AcornOutcomeComment',
    id: url(COMMENT_1),
    entry: outcomeCommentEntry,
  },
  {
    className: 'AcornOutcomeMember',
    id: url(OUTCOME_MEMBER_1),
    entry: outcomeMemberEntry,
  },
  { className: 'AcornTag', id: url(TAG_T), entry: tagEntry },
  { className: 'AcornProjectMeta', id: url(PROJECT_META), entry: projectMetaEntry },
  { className: 'AcornMember', id: url(MEMBER_1), entry: memberEntry },
  {
    className: 'AcornProfile',
    id: url(`profile/${AGENT_A}`),
    entry: profileEntry,
  },
]

describe('toWireRecord', () => {
  for (const { className, id, entry } of CASES) {
    test(`${className} instance -> WireRecord`, () => {
      const instance = {
        id,
        __subjectClass: className,
        ...mountProps(className),
        entryHash: ENTRY_HASH,
        recordCreatedAt: CREATED,
        recordUpdatedAt: UPDATED,
      }
      const wire = toWireRecord(className, instance, ctx)
      const expectedActionHash =
        className === 'AcornProfile' ? AGENT_A : id.slice(LANG.length + 3)
      expect(wire).toEqual({
        actionHash: expectedActionHash,
        entryHash: ENTRY_HASH,
        createdAt: CREATED,
        updatedAt: UPDATED,
        entry: entry(),
      })
    })
  }

  test('AcornProfile has no wire metadata on the mount', () => {
    const instance = {
      id: url(`profile/${AGENT_A}`),
      __subjectClass: 'AcornProfile',
      ...mountProps('AcornProfile'),
    }
    const wire = toWireRecord('AcornProfile', instance, ctx)
    expect(wire.actionHash).toBe(AGENT_A)
    expect(wire.entryHash).toBe('')
    expect(wire.createdAt).toBe(0)
    expect(wire.updatedAt).toBe(0)
  })

  test('Uncertain outcome rebuilds the Uncertain scope', () => {
    const instance = {
      id: url(OUTCOME_B),
      __subjectClass: 'AcornOutcome',
      content: 'Big thing',
      description: '',
      githubLink: '',
      scopeType: 'Uncertain',
      smallsEstimate: 5,
      timeFrame: JSON.stringify({
        fromDate: 1763400000.0,
        toDate: 1763700000.0,
      }),
      inBreakdown: true,
      tags: [],
      creator: agentToDid(AGENT_A),
      timestampCreated: 1763370000.0,
      isImported: true,
      entryHash: ENTRY_HASH,
      recordCreatedAt: CREATED,
      recordUpdatedAt: UPDATED,
    }
    const wire = toWireRecord('AcornOutcome', instance, ctx)
    expect(wire.entry).toEqual(uncertainOutcomeEntry())
    // the scope rebuild is what turns red if removed
    expect(wire.entry.scope).toEqual({
      Uncertain: {
        smallsEstimate: 5,
        timeFrame: { fromDate: 1763400000.0, toDate: 1763700000.0 },
        inBreakdown: true,
      },
    })
  })

  test('ProjectMeta passphrase comes from the seed, not the mount', () => {
    const instance = {
      id: url(PROJECT_META),
      __subjectClass: 'AcornProjectMeta',
      ...mountProps('AcornProjectMeta'),
      entryHash: ENTRY_HASH,
      recordCreatedAt: CREATED,
      recordUpdatedAt: UPDATED,
    }
    expect('passphrase' in instance).toBe(false)
    const wire = toWireRecord('AcornProjectMeta', instance, ctx)
    expect(wire.entry.passphrase).toBe('rig test project')
  })
})

describe('toValues -> toWireRecord round trip', () => {
  for (const { className, id, entry } of CASES) {
    test(`${className}`, () => {
      const values = toValues(className, entry(), ctx)
      const instance = { id, __subjectClass: className, ...values }
      const wire = toWireRecord(className, instance, ctx)
      expect(wire.entry).toEqual(entry())
    })
  }

  test('uncertain scope round trip', () => {
    const values = toValues('AcornOutcome', uncertainOutcomeEntry(), ctx)
    const wire = toWireRecord(
      'AcornOutcome',
      { id: url(OUTCOME_B), ...values },
      ctx
    )
    expect(wire.entry).toEqual(uncertainOutcomeEntry())
  })

  test('toValues never emits the passphrase', () => {
    const values = toValues('AcornProjectMeta', projectMetaEntry(), ctx)
    expect('passphrase' in values).toBe(false)
  })
})

describe('helpers', () => {
  test('seedToPassphrase', () => {
    expect(seedToPassphrase('uid-rig-test-project')).toBe('rig test project')
    expect(seedToPassphrase('noseed')).toBe('noseed')
  })
})
