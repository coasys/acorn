// Live updates (design §6.3, spec C3): one `perspective.modelSubscribe` per
// Acorn class on each mounted cell; every `query-subscription-update` frame
// the executor pushes is diffed by id against the last result and the rows
// that changed go to the UI's 'signal' handler as the stock zomes' own
// msgpack payloads.
//
// Wire protocol (ad4m core/src/perspectives/{PerspectiveClient,LiveQuery}.ts
// and rust-executor/src/api/perspectives_ws.rs):
//   subscribe  perspective.modelSubscribe { uuid, class_name, query_json,
//                subscriptionId } -> { subscriptionId, result, revision }
//                (result is the parsed model result { instances, totalCount })
//   update     { type: "query-subscription-update", subscriptionId, revision,
//                ids, upsert, totalCount } — or `result` for a whole
//                replacement, or { type: "query-subscription-update",
//                lagged: true } when the socket's stream dropped events
//   resync     perspective.resyncSubscription { uuid, subscriptionId } ->
//                { revision, result } after a revision gap or a lag
//   dispose    perspective.disposeQuery { uuid, subscriptionId }
// Live query updates bypass events.watch and reach only the socket that
// opened them, so rpc.ts's onEvent fan-out delivers them with no watch.
//
// The first result is the baseline: no signals. Each later update diffs
// against the last result — a new id is a `create`, an id whose instance
// changed an `update`, an id that vanished a `delete` — and every change is
// emitted in the stock zomes' signal shape (hdk_crud's ActionSignal / the
// projects zome's MemberSignal / the profiles zome's AgentSignal):
//   { signalType, data: { entryType|entry_type, action, data } }
// msgpack-encoded as payload of { type: "app", value: { cell_id, zome_name:
// "projects", payload } } — what signalsHandlers.ts decodes.

import * as msgpack from '@msgpack/msgpack/dist'
import _ from 'lodash'
import { CellId } from '@holochain/client'
import { MapCtx, toEntry, toWireRecord, urlToHash } from './mapping'
import { CellCtx, RpcCall } from './zomeTable'

export interface LiveCell extends CellCtx {
  /** the binary cell id the signal envelope carries */
  cellId: CellId
}

export interface LiveClient {
  call: RpcCall
  /** every frame that is not an rpc reply (Ad4mRpc.onEvent) */
  onEvent: (cb: (msg: any) => void) => () => void
  /** every stored on('signal') handler (Ad4mAppClient.emitSignal) */
  emit: (signal: any) => void
}

export interface LiveHandle {
  stop(): Promise<void>
}

type Action = 'create' | 'update' | 'delete'

interface SignalSpec {
  /** the stock SignalType variant */
  signalType: string
  /** `entryType` everywhere but the Member signal, whose MemberSignal has no
   *  camelCase rename and serializes `entry_type` */
  entryTypeKey: 'entryType' | 'entry_type'
  /** the lowercase wire entryType (signalsHandlers.ts's crudTypes keys) */
  entryType: string
  /** Member's data is the bare Member entry, not a WireRecord */
  bareEntry?: boolean
}

// the mounted classes, in the stock zomes' signal spellings
const SIGNALS: Record<string, SignalSpec> = {
  AcornOutcome: { signalType: 'Outcome', entryTypeKey: 'entryType', entryType: 'outcome' },
  AcornConnection: { signalType: 'Connection', entryTypeKey: 'entryType', entryType: 'connection' },
  AcornEntryPoint: { signalType: 'EntryPoint', entryTypeKey: 'entryType', entryType: 'entry_point' },
  AcornOutcomeComment: { signalType: 'OutcomeComment', entryTypeKey: 'entryType', entryType: 'outcome_comment' },
  AcornOutcomeMember: { signalType: 'OutcomeMember', entryTypeKey: 'entryType', entryType: 'outcome_member' },
  AcornTag: { signalType: 'Tag', entryTypeKey: 'entryType', entryType: 'tag' },
  AcornProjectMeta: { signalType: 'ProjectMeta', entryTypeKey: 'entryType', entryType: 'project_meta' },
  AcornMember: { signalType: 'Member', entryTypeKey: 'entry_type', entryType: 'member', bareEntry: true },
  AcornProfile: { signalType: 'Agent', entryTypeKey: 'entryType', entryType: 'agent' },
}

export const LIVE_CLASSES = Object.keys(SIGNALS)

export interface InstanceChange {
  action: Action
  instance: any
}

/** Diff two instance lists by `id`: new -> create, changed -> update,
 *  missing -> delete. Creates and updates come in `next` order, deletes in
 *  `prev` order after them. */
export function diffInstances(prev: any[], next: any[]): InstanceChange[] {
  const prevById = new Map(prev.map((i) => [String(i?.id), i]))
  const nextIds = new Set(next.map((i) => String(i?.id)))
  const changes: InstanceChange[] = []
  for (const instance of next) {
    const old = prevById.get(String(instance?.id))
    if (!old) changes.push({ action: 'create', instance })
    else if (!_.isEqual(old, instance)) changes.push({ action: 'update', instance })
  }
  for (const instance of prev) {
    if (!nextIds.has(String(instance?.id))) {
      changes.push({ action: 'delete', instance })
    }
  }
  return changes
}

/** The hash a WireRecord's actionHash carries for this class: the record
 *  hash, or the agent key for a profile (mount address `profile/<key>`). */
function hashOf(className: string, instance: any, lang: string): string {
  const hash = urlToHash(String(instance?.id ?? ''), lang)
  return className === 'AcornProfile' && hash.startsWith('profile/')
    ? hash.slice('profile/'.length)
    : hash
}

/** The decoded signal payload, in the stock zome's own shape. */
export function acornSignalData(
  className: string,
  action: Action,
  instance: any,
  ctx: MapCtx
): { signalType: string; data: any } {
  const spec = SIGNALS[className]
  if (!spec) throw new Error(`acornSignalData: unknown class ${className}`)
  const data =
    action === 'delete'
      ? spec.bareEntry
        ? toEntry(className, instance, ctx)
        : hashOf(className, instance, ctx.lang)
      : spec.bareEntry
        ? toEntry(className, instance, ctx)
        : toWireRecord(className, instance, ctx)
  return {
    signalType: spec.signalType,
    data: { [spec.entryTypeKey]: spec.entryType, action, data },
  }
}

/** The signal as the UI's on('signal') handler receives it: SignalType.App's
 *  `{ type: "app", value: { cell_id, zome_name, payload } }` with the payload
 *  msgpack-encoded, as @holochain/client 0.21 frames AppSignals. */
export function acornSignal(
  cell: LiveCell,
  className: string,
  action: Action,
  instance: any
): any {
  const ctx: MapCtx = { lang: cell.lang, seed: cell.info?.seed }
  return {
    type: 'app',
    value: {
      cell_id: cell.cellId,
      zome_name: 'projects',
      payload: msgpack.encode(acornSignalData(className, action, instance, ctx)),
    },
  }
}

/** A subscription id, 1-64 chars of [A-Za-z0-9-] (the executor's
 *  `client_subscription_id` rule), as core mints them: a v4 UUID. */
function mintSubscriptionId(): string {
  const b = new Uint8Array(16)
  const c = globalThis.crypto
  if (c?.getRandomValues) {
    c.getRandomValues(b)
  } else {
    for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  }
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function instancesOf(result: any): any[] {
  const parsed = typeof result === 'string' ? JSON.parse(result) : result
  return Array.isArray(parsed?.instances) ? parsed.instances : []
}

function toIdMap(instances: any[]): Map<string, any> {
  return new Map(instances.map((i) => [String(i?.id), i]))
}

interface ClassSub {
  className: string
  subscriptionId: string
  /** revision of the last applied frame or snapshot */
  revision: number
  /** id -> instance of the last result */
  last: Map<string, any>
  /** the subscribe response has not been applied yet — frames buffer */
  initializing: boolean
  /** a resyncSubscription call is in flight — frames buffer */
  resyncing: boolean
  /** a lag/dropped event while busy: resync again once idle */
  needResync: boolean
  /** frames held while initializing or resyncing, replayed in order */
  buffer: any[]
}

/** Open the live subscriptions of one mounted cell. Returns a handle whose
 *  stop() ends every subscription the cell opened.
 *
 *  Updates can reach the socket before their subscription is registered here
 *  (a frame outruns its modelSubscribe response) or while a resync is in
 *  flight. Those frames are buffered on the subscription — which is
 *  registered before its request goes out — and replayed in order on top of
 *  the snapshot that arrives. A snapshot at or behind the revision the stream
 *  already reached is stale and gets rejected instead of rolling state back. */
export async function startLive(
  client: LiveClient,
  cell: LiveCell
): Promise<LiveHandle> {
  const subs = new Map<string, ClassSub>()
  let disposed = false

  const emitChange = (className: string, change: InstanceChange) => {
    try {
      const spec = SIGNALS[className]
      console.debug(
        `[ad4m-live] ${spec.signalType} ${change.action} ` +
          `${hashOf(className, change.instance, cell.lang).slice(0, 16)}`
      )
      client.emit(acornSignal(cell, className, change.action, change.instance))
    } catch (e) {
      console.error(`AD4M live: ${className} ${change.action} signal failed`, e)
    }
  }

  /** Replace `sub.last` with `instances`, emitting the diff between them. */
  const replace = (sub: ClassSub, instances: any[]) => {
    const next = toIdMap(instances)
    for (const change of diffInstances([...sub.last.values()], [...next.values()])) {
      emitChange(sub.className, change)
    }
    sub.last = next
  }

  const onFrame = (msg: any) => {
    if (disposed || msg?.type !== 'query-subscription-update') return
    if (msg.lagged) {
      for (const sub of subs.values()) resync(sub)
      return
    }
    const sub = subs.get(msg.subscriptionId)
    if (!sub) return
    if (sub.initializing || sub.resyncing) {
      // a snapshot is on its way; hold the frame until it lands
      sub.buffer.push(msg)
      return
    }
    applyFrame(sub, msg)
  }

  /** Replay the frames buffered while `sub` was busy, through the normal
   *  path (busy flags are re-checked, so a frame that opens another resync
   *  re-buffers the rest). */
  const drain = (sub: ClassSub) => {
    const buffered = sub.buffer
    sub.buffer = []
    for (const m of buffered) onFrame(m)
  }

  /** Revision gap, lagged stream, or a delta we cannot apply: pull the
   *  subscription's whole current result and diff against it. */
  const resync = (sub: ClassSub) => {
    if (sub.initializing || sub.resyncing) {
      sub.needResync = true
      return
    }
    sub.resyncing = true
    client
      .call('perspective.resyncSubscription', {
        uuid: cell.uuid,
        subscriptionId: sub.subscriptionId,
      })
      .then((res) => {
        sub.resyncing = false
        if (disposed || !subs.has(sub.subscriptionId)) return
        if (
          typeof res?.revision === 'number' &&
          res.revision <= sub.revision
        ) {
          // superseded snapshot: the stream already moved past it
        } else {
          sub.revision =
            typeof res?.revision === 'number' ? res.revision : sub.revision
          replace(sub, instancesOf(res?.result))
        }
        drain(sub)
        if (sub.needResync) {
          sub.needResync = false
          resync(sub)
        }
      })
      .catch(() => {
        sub.resyncing = false
        // the resync failed; let the buffered frames through so the next
        // delta or gap retries against them instead of stalling
        drain(sub)
      })
  }

  const applyFrame = (sub: ClassSub, msg: any) => {
    if (typeof msg.revision === 'number') {
      if (msg.revision <= sub.revision) return
      if (msg.revision !== sub.revision + 1) {
        resync(sub)
        return
      }
    }
    // a whole-result delta replaces the last result outright
    if ('result' in msg) {
      replace(sub, instancesOf(msg.result))
      // the revision counts once the frame applied (below)
      if (typeof msg.revision === 'number') sub.revision = msg.revision
      return
    }
    if (!Array.isArray(msg.ids)) {
      // row deltas (`added`/`removed`) do not describe model instances
      resync(sub)
      return
    }
    const upsert = toIdMap(msg.upsert ?? [])
    const next = new Map<string, any>()
    for (const rawId of msg.ids) {
      const id = String(rawId)
      const inst = upsert.get(id) ?? sub.last.get(id)
      if (!inst) {
        // the delta names an instance we never had — our state is stale
        resync(sub)
        return
      }
      next.set(id, inst)
    }
    for (const change of diffInstances([...sub.last.values()], [...next.values()])) {
      emitChange(sub.className, change)
    }
    sub.last = next
    // Commit the revision only now that the delta applied. A delta that ends
    // in resync leaves the counter at the last applied revision, so the
    // recovery snapshot carrying this same revision is not rejected as stale.
    if (typeof msg.revision === 'number') sub.revision = msg.revision
  }

  // listen before the first subscribe call so no update can slip between
  const unlisten = client.onEvent(onFrame)

  for (const className of LIVE_CLASSES) {
    if (disposed) break
    const subscriptionId = mintSubscriptionId()
    // the id is registered before the request: frames that outrun the
    // response buffer on the subscription instead of being dropped
    const sub: ClassSub = {
      className,
      subscriptionId,
      revision: -1,
      last: new Map(),
      initializing: true,
      resyncing: false,
      needResync: false,
      buffer: [],
    }
    subs.set(subscriptionId, sub)
    try {
      const res = await client.call(
        'perspective.modelSubscribe',
        { uuid: cell.uuid, class_name: className, query_json: '{}', subscriptionId },
        180000
      )
      if (disposed) {
        subs.delete(subscriptionId)
        client
          .call('perspective.disposeQuery', { uuid: cell.uuid, subscriptionId })
          .catch(() => {})
        break
      }
      sub.revision = typeof res?.revision === 'number' ? res.revision : 0
      sub.last = toIdMap(instancesOf(res?.result))
      sub.initializing = false
      drain(sub)
      if (sub.needResync) {
        sub.needResync = false
        resync(sub)
      }
    } catch (e) {
      subs.delete(subscriptionId)
      console.error(`AD4M live: modelSubscribe ${className} failed`, e)
    }
  }

  return {
    async stop() {
      if (disposed) return
      disposed = true
      unlisten()
      await Promise.all(
        [...subs.values()].map((sub) =>
          client
            .call('perspective.disposeQuery', {
              uuid: cell.uuid,
              subscriptionId: sub.subscriptionId,
            })
            .catch(() => false)
        )
      )
      subs.clear()
    },
  }
}
