// AD4M mount data <-> Acorn entries/WireRecords (design §6.2, spec C1).
//
// toEntry is the exact inverse of the language's toData and is ported from
// ~/code/acorn-ad4m/language/src/mapping.ts: `<lang>://<hash>` URLs become
// ActionHashB64 again, did:key agents become AgentPubKeyB64, scopeType + the
// flattened scope fields rebuild the externally tagged `scope` enum, and the
// JSON-string taskList/timeFrame parse back to values. Everything that is not
// an entry field — WireRecord metadata, derived parent/children, sameAs — is
// dropped. toWireRecord wraps it in the hdk_crud envelope the UI expects.
// toValues is the forward map (entry -> mount values) used by the write rows.

import { WireRecord } from '../api/hdkCrud'
import { agentToDid, didToAgent } from './agent'

export interface MapCtx {
  /** this cell's language address; refs are `<lang>://<hash>` */
  lang: string
  /** project network seed: the ONLY source of ProjectMeta.passphrase */
  seed?: string
}

/** "uid-a-b-c-d-e" -> "a b c d e" — the inverse of Acorn's uidToPassphrase
 *  (web/src/secrets.ts:8-9), so the stock UI's passphrase convention holds. */
export function seedToPassphrase(seed: string): string {
  return (seed.startsWith('uid-') ? seed.slice(4) : seed)
    .split('-')
    .join(' ')
}

/** `<lang>://<hash>` -> `<hash>`; a bare hash passes through unchanged. */
export function urlToHash(url: unknown, lang: string): string {
  const s = String(url)
  const prefix = `${lang}://`
  return s.startsWith(prefix) ? s.slice(prefix.length) : s
}

// did:key -> AgentPubKeyB64; a raw key passes through unchanged.
function agentValue(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v)
  return s.startsWith('did:') ? didToAgent(s) : s
}

// A mounted JSON-string field ("[...]", "{...}") parses back to its value;
// anything already a value passes through.
function jsonValue(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

function scopeToEntry(data: Record<string, unknown>): Record<string, unknown> {
  if (data.scopeType === 'Small') {
    return {
      Small: {
        achievementStatus: data.achievementStatus ?? 'NotAchieved',
        targetDate: data.targetDate ?? null,
        taskList: jsonValue(data.taskList) ?? [],
      },
    }
  }
  return {
    Uncertain: {
      smallsEstimate: data.smallsEstimate ?? null,
      timeFrame: jsonValue(data.timeFrame),
      inBreakdown: data.inBreakdown ?? false,
    },
  }
}

// --- mount data -> Acorn entry (ported from language/src/mapping.ts) --------

export function toEntry(
  className: string,
  data: Record<string, unknown>,
  ctx: MapCtx
): Record<string, unknown> {
  const ref = (v: unknown) => (v == null ? null : urlToHash(v, ctx.lang))
  const agent = (v: unknown) => agentValue(v)
  const num = (v: unknown) => (typeof v === 'number' ? v : 0)
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const refs = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((x) => ref(x)).filter((x): x is string => x != null)
      : []

  switch (className) {
    case 'AcornOutcome':
      return {
        content: str(data.content),
        creatorAgentPubKey: agent(data.creator),
        editorAgentPubKey: agent(data.editor),
        timestampCreated: num(data.timestampCreated),
        timestampUpdated: data.timestampUpdated ?? null,
        scope: scopeToEntry(data),
        tags: refs(data.tags),
        description: str(data.description),
        isImported: data.isImported === true,
        githubLink: str(data.githubLink),
      }
    case 'AcornConnection':
      return {
        parentActionHash: ref(data.parent),
        childActionHash: ref(data.child),
        siblingOrder: num(data.siblingOrder),
        randomizer: num(data.randomizer),
        isImported: data.isImported === true,
      }
    case 'AcornEntryPoint':
      return {
        color: str(data.color),
        creatorAgentPubKey: agent(data.creator),
        createdAt: num(data.createdAtTime),
        outcomeActionHash: ref(data.outcome),
        isImported: data.isImported === true,
      }
    case 'AcornOutcomeComment':
      return {
        outcomeActionHash: ref(data.outcome),
        content: str(data.content),
        creatorAgentPubKey: agent(data.creator),
        unixTimestamp: num(data.unixTimestamp),
        isImported: data.isImported === true,
      }
    case 'AcornOutcomeMember':
      return {
        outcomeActionHash: ref(data.outcome),
        memberAgentPubKey: agent(data.member),
        creatorAgentPubKey: agent(data.creator),
        unixTimestamp: num(data.unixTimestamp),
        isImported: data.isImported === true,
      }
    case 'AcornTag':
      return {
        backgroundColor: str(data.backgroundColor),
        text: str(data.text),
      }
    case 'AcornProjectMeta':
      return {
        creatorAgentPubKey: agent(data.creator),
        createdAt: num(data.createdAtTime),
        name: str(data.name),
        image: data.image ?? null,
        // The project passphrase is derived from the language seed — it is
        // never mounted data and never accepted from interaction params.
        passphrase:
          typeof data.passphrase === 'string' && data.passphrase !== ''
            ? data.passphrase
            : seedToPassphrase(ctx.seed ?? ''),
        isImported: data.isImported === true,
        layeringAlgorithm: str(data.layeringAlgorithm),
        topPriorityOutcomes: refs(data.topPriorityOutcomes),
        isMigrated: data.isMigrated ?? null,
      }
    case 'AcornMember':
      return { agentPubKey: agent(data.agent) }
    case 'AcornProfile':
      return {
        firstName: str(data.firstName),
        lastName: str(data.lastName),
        handle: str(data.handle),
        status: str(data.status),
        avatarUrl: str(data.avatarUrl),
        agentPubKey:
          typeof data.agentPubKey === 'string' && data.agentPubKey !== ''
            ? data.agentPubKey
            : agent(data.agent),
        isImported: data.isImported === true,
      }
    default:
      throw new Error(`toEntry: unknown class ${className}`)
  }
}

/** A modelQuery instance ({id: `<lang>://<hash>`, __subjectClass, ...props})
 *  -> the hdk_crud WireRecord the UI's reducers store. For AcornProfile the
 *  mount address is `profile/<AgentPubKeyB64>` (Correction 6): the agent key
 *  stands in for the action hash, and there is no wire metadata. */
export function toWireRecord(
  className: string,
  instance: Record<string, unknown>,
  ctx: MapCtx
): WireRecord<any> {
  const id = String(instance.id ?? instance.address ?? '')
  let hash = urlToHash(id, ctx.lang)
  if (className === 'AcornProfile' && hash.startsWith('profile/')) {
    hash = hash.slice('profile/'.length)
  }
  return {
    actionHash: hash,
    entryHash: typeof instance.entryHash === 'string' ? instance.entryHash : '',
    createdAt:
      typeof instance.recordCreatedAt === 'number'
        ? instance.recordCreatedAt
        : 0,
    updatedAt:
      typeof instance.recordUpdatedAt === 'number'
        ? instance.recordUpdatedAt
        : 0,
    entry: toEntry(className, instance, ctx),
  }
}

// --- Acorn entry -> mount values (for createSubject/updateSubject) ----------
//
// Emits every prop the entry carries, named as the mount names them, so a
// `toValues -> toWireRecord` round trip reproduces the entry. WireRecord
// metadata (entryHash/createdAt/updatedAt) and derived props (parent,
// children, sameAs, passphrase) are NOT emitted: they are not entry fields.

export function toValues(
  className: string,
  entry: Record<string, any>,
  ctx: MapCtx
): Record<string, unknown> {
  const url = (h: string) => `${ctx.lang}://${h}`
  const did = (k: unknown) =>
    typeof k === 'string' && k !== '' ? agentToDid(k) : undefined
  const out: Record<string, unknown> = {}
  const put = (name: string, value: unknown) => {
    if (value !== undefined) out[name] = value
  }

  switch (className) {
    case 'AcornOutcome': {
      put('content', entry.content)
      put('description', entry.description)
      put('githubLink', entry.githubLink)
      const scope = entry.scope ?? {}
      if (scope.Small != null) {
        put('scopeType', 'Small')
        put('achievementStatus', scope.Small.achievementStatus)
        put('targetDate', scope.Small.targetDate)
        put('taskList', JSON.stringify(scope.Small.taskList ?? []))
      } else if (scope.Uncertain != null) {
        put('scopeType', 'Uncertain')
        put('smallsEstimate', scope.Uncertain.smallsEstimate)
        // null is the mount's clear for a stored range: updateSubject
        // merges it into the language's update params, the entry's
        // timeFrame becomes null and its mount link is dropped — a
        // declared clear must reach the call verbatim, not be omitted
        put(
          'timeFrame',
          scope.Uncertain.timeFrame != null
            ? JSON.stringify(scope.Uncertain.timeFrame)
            : null
        )
        put('inBreakdown', scope.Uncertain.inBreakdown)
      }
      if (Array.isArray(entry.tags)) {
        out.tags = entry.tags.map((h: string) => url(h))
      }
      put('creator', did(entry.creatorAgentPubKey))
      put('editor', did(entry.editorAgentPubKey))
      put('timestampCreated', entry.timestampCreated)
      put('timestampUpdated', entry.timestampUpdated)
      put('isImported', entry.isImported)
      break
    }
    case 'AcornConnection': {
      put('parent', entry.parentActionHash && url(entry.parentActionHash))
      put('child', entry.childActionHash && url(entry.childActionHash))
      put('siblingOrder', entry.siblingOrder)
      put('randomizer', entry.randomizer)
      put('isImported', entry.isImported)
      break
    }
    case 'AcornEntryPoint': {
      put('color', entry.color)
      put('outcome', entry.outcomeActionHash && url(entry.outcomeActionHash))
      put('creator', did(entry.creatorAgentPubKey))
      put('createdAtTime', entry.createdAt)
      put('isImported', entry.isImported)
      break
    }
    case 'AcornOutcomeComment': {
      put('outcome', entry.outcomeActionHash && url(entry.outcomeActionHash))
      put('content', entry.content)
      put('creator', did(entry.creatorAgentPubKey))
      put('unixTimestamp', entry.unixTimestamp)
      put('isImported', entry.isImported)
      break
    }
    case 'AcornOutcomeMember': {
      put('outcome', entry.outcomeActionHash && url(entry.outcomeActionHash))
      put('member', did(entry.memberAgentPubKey))
      put('creator', did(entry.creatorAgentPubKey))
      put('unixTimestamp', entry.unixTimestamp)
      put('isImported', entry.isImported)
      break
    }
    case 'AcornTag': {
      put('text', entry.text)
      put('backgroundColor', entry.backgroundColor)
      break
    }
    case 'AcornProjectMeta': {
      put('name', entry.name)
      put('image', entry.image)
      put('layeringAlgorithm', entry.layeringAlgorithm)
      if (Array.isArray(entry.topPriorityOutcomes)) {
        out.topPriorityOutcomes = entry.topPriorityOutcomes.map((h: string) =>
          url(h)
        )
      }
      put('creator', did(entry.creatorAgentPubKey))
      put('createdAtTime', entry.createdAt)
      put('isImported', entry.isImported)
      put('isMigrated', entry.isMigrated)
      // never `passphrase` — the project's membership secret stays off the
      // mount; toWireRecord re-derives it from the seed.
      break
    }
    case 'AcornMember': {
      put('agent', did(entry.agentPubKey))
      break
    }
    case 'AcornProfile': {
      put('firstName', entry.firstName)
      put('lastName', entry.lastName)
      put('handle', entry.handle)
      put('status', entry.status)
      put('avatarUrl', entry.avatarUrl)
      put('agent', did(entry.agentPubKey))
      put('agentPubKey', entry.agentPubKey)
      put('isImported', entry.isImported)
      break
    }
    default:
      throw new Error(`toValues: unknown class ${className}`)
  }
  return out
}
