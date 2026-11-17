// fn_name -> AD4M call translation (design §6.2, spec C1 read rows, C2 write
// rows).
//
// Every fetch maps to `perspective.modelQuery` on the cell's mounted
// perspective; the instances map back to WireRecords through mapping.ts.
// `whoami`/`create_whoami` go to the language's `project` interactions /
// createSubject. Writes go to `perspective.createSubject` / `updateSubject` /
// `removeSubject`; the two presence fns go to `project` interactions. Every
// fn_name with no row throws `AD4M mode: <fn> not implemented yet`.

import { toEntry, toValues, toWireRecord, urlToHash, MapCtx } from './mapping'

export type RpcCall = (
  method: string,
  params?: any,
  timeoutMs?: number
) => Promise<any>

/** One mounted Acorn project cell. */
export interface CellCtx {
  /** the mounting perspective's uuid */
  uuid: string
  /** the templated language's address */
  lang: string
  /** the language's `info` interaction result:
   *  { dnaHash, agentPubKey, agentDid, ad4mDid, seed, cellId: [b64, b64] } */
  info: any
}

export interface ZomeCtx {
  call: RpcCall
  cell: CellCtx
}

type Row = (ctx: ZomeCtx, payload: any) => Promise<any>

function mapCtx(cell: CellCtx): MapCtx {
  return { lang: cell.lang, seed: cell.info?.seed }
}

export async function modelQuery(
  call: RpcCall,
  uuid: string,
  className: string,
  queryJson = '{}'
): Promise<any[]> {
  const res = await call(
    'perspective.modelQuery',
    { uuid, class_name: className, query_json: queryJson },
    180000
  )
  const parsed = typeof res === 'string' ? JSON.parse(res) : res
  return parsed?.instances ?? []
}

/** expression.interact(<lang>://<exprUrl>, name, params) -> parsed result. */
export async function interact(
  call: RpcCall,
  exprUrl: string,
  name: string,
  params: any,
  timeoutMs = 120000
): Promise<any> {
  const result = await call(
    'expression.interact',
    {
      url: exprUrl,
      interactionCall: {
        name,
        parametersStringified: JSON.stringify(params ?? {}),
      },
    },
    timeoutMs
  )
  if (typeof result !== 'string') return result
  try {
    return JSON.parse(result)
  } catch {
    return result
  }
}

function fetchClass(className: string): Row {
  return async ({ call, cell }) => {
    const rows = await modelQuery(call, cell.uuid, className)
    return rows.map((r) => toWireRecord(className, r, mapCtx(cell)))
  }
}

// --- write helpers -----------------------------------------------------------

const urlFor = (cell: CellCtx, hash: string) => `${cell.lang}://${hash}`

/** createSubject on a mounted class calls the language's `create`, which
 *  names the record it made — the RPC result is its URL (`boolean` only for
 *  link-writing constructors, which a mounted class never has). */
async function createSubject(
  { call, cell }: ZomeCtx,
  className: string,
  values: Record<string, unknown>
): Promise<string> {
  const res = await call(
    'perspective.createSubject',
    {
      uuid: cell.uuid,
      subjectClass: className,
      expressionAddress: '',
      initialValues: JSON.stringify(values),
    },
    300000
  )
  if (typeof res !== 'string' || !res) {
    throw new Error(
      `createSubject ${className}: expected the new record URL, got ` +
        JSON.stringify(res)
    )
  }
  return res
}

/** One mounted instance by id (id = its `<lang>://…` URL). The mount applies
 *  a call's delta before the RPC returns, so it is there on the first read;
 *  the short poll only absorbs stragglers. */
async function instanceById(
  { call, cell }: ZomeCtx,
  className: string,
  id: string,
  tries = 20
): Promise<any> {
  const query = JSON.stringify({ where: { id } })
  for (let i = 0; i < tries; i++) {
    const rows = await modelQuery(call, cell.uuid, className, query)
    const hit = rows.find((r) => String(r?.id) === id)
    if (hit) return hit
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${className} ${id}: not in the mounted data`)
}

/** The keys of `values` that differ from the current instance, so one UI
 *  save is one update call carrying only the props that moved. null and
 *  absent both read as "no value". */
function changedValues(
  values: Record<string, unknown>,
  instance: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    const cur = instance[k]
    if (v == null && cur == null) continue
    if (
      v != null &&
      cur != null &&
      JSON.stringify(v) === JSON.stringify(cur)
    ) {
      continue
    }
    out[k] = v
  }
  return out
}

/** hdk_crud `create_<type>`: payload is the bare entry (or `ZomeFnInput`'s
 *  `{input}` when `unwrap` asks for it). Returns the new WireRecord. */
function createRow(className: string, unwrap?: (p: any) => any): Row {
  return async (ctx, payload) => {
    const entry = unwrap ? unwrap(payload) : payload
    const map = mapCtx(ctx.cell)
    const id = await createSubject(
      ctx,
      className,
      toValues(className, entry, map)
    )
    const inst = await instanceById(ctx, className, id)
    return toWireRecord(className, inst, map)
  }
}

const projectMetaRows = (ctx: ZomeCtx) =>
  modelQuery(ctx.call, ctx.cell.uuid, 'AcornProjectMeta')

async function whoamiRow(ctx: ZomeCtx): Promise<any> {
  const res = await interact(ctx.call, `${ctx.cell.lang}://project`, 'whoami', {})
  if (!res || !res.address || !res.data) return null
  return toWireRecord(
    'AcornProfile',
    { ...res.data, id: `${ctx.cell.lang}://${res.address}` },
    mapCtx(ctx.cell)
  )
}

export const zomeTable: Record<string, Row> = {
  fetch_outcomes: fetchClass('AcornOutcome'),
  fetch_connections: fetchClass('AcornConnection'),
  fetch_entry_points: fetchClass('AcornEntryPoint'),
  fetch_outcome_comments: fetchClass('AcornOutcomeComment'),
  fetch_outcome_members: fetchClass('AcornOutcomeMember'),
  fetch_tags: fetchClass('AcornTag'),

  fetch_project_meta: async (ctx) => {
    const rows = await projectMetaRows(ctx)
    if (!rows.length) {
      // the stock zome errors with this exact text; the UI pattern-matches it
      throw new Error('no project meta exists')
    }
    return toWireRecord('AcornProjectMeta', rows[0], mapCtx(ctx.cell))
  },
  check_project_meta_exists: async (ctx) =>
    (await projectMetaRows(ctx)).length > 0,

  fetch_members: fetchClass('AcornMember'),

  // fetch_agents returns bare Profiles, not WireRecords (Correction 6)
  fetch_agents: async ({ call, cell }) => {
    const rows = await modelQuery(call, cell.uuid, 'AcornProfile')
    return rows.map((r) => toEntry('AcornProfile', r, mapCtx(cell)))
  },

  whoami: whoamiRow,

  fetch_agent_address: async ({ cell }) => cell.info.agentPubKey,

  fetch_entry_point_details: async ({ call, cell }) => {
    const ctx = mapCtx(cell)
    const entryPoints = (await modelQuery(call, cell.uuid, 'AcornEntryPoint')).map(
      (r) => toWireRecord('AcornEntryPoint', r, ctx)
    )
    const wanted = new Set(
      entryPoints.map((w) => w.entry.outcomeActionHash).filter(Boolean)
    )
    const outcomes = (await modelQuery(call, cell.uuid, 'AcornOutcome'))
      .filter((r) => wanted.has(urlToHash(r.id, cell.lang)))
      .map((r) => toWireRecord('AcornOutcome', r, ctx))
    return { entryPoints, outcomes }
  },

  // create_whoami is a write row — pulled forward from C2 because C1's
  // install/join path (installProject.ts) awaits it: a throw there fails the
  // whole join before the project ever opens.
  create_whoami: async ({ call, cell }, payload) => {
    await call(
      'perspective.createSubject',
      {
        uuid: cell.uuid,
        subjectClass: 'AcornProfile',
        expressionAddress: '',
        initialValues: JSON.stringify(
          toValues('AcornProfile', payload, mapCtx(cell))
        ),
      },
      300000
    )
    // createSubject's result is the record URL; the profile's canonical
    // address (and the shape installProject wants back) comes from whoami.
    const deadline = Date.now() + 60000
    let last: any = null
    while (Date.now() < deadline) {
      last = await whoamiRow({ call, cell })
      if (last) return last
      await new Promise((r) => setTimeout(r, 2000))
    }
    throw new Error('create_whoami: profile not readable after create')
  },

  // --- creates (hdk_crud `create_<type>`; `create_outcome` lands here via
  // cloneOutcomes/import, AcornOutcome's mount create is the zome's
  // create_outcome_with_connection with no link) ---
  create_outcome: createRow('AcornOutcome'),
  create_connection: createRow('AcornConnection'),
  create_entry_point: createRow('AcornEntryPoint'),
  create_outcome_comment: createRow('AcornOutcomeComment'),
  create_outcome_member: createRow('AcornOutcomeMember'),
  create_tag: createRow('AcornTag'),
  create_project_meta: createRow('AcornProjectMeta'),

  simple_create_project_meta: createRow(
    'AcornProjectMeta',
    (p) => p?.input ?? p
  ),

  // `parent` on the outcome create is the mount's spelling of
  // `maybeLinkedOutcome: ExistingOutcomeAsParent`; `ExistingOutcomeAsChild`
  // is a separate AcornConnection create (the new outcome is the parent).
  create_outcome_with_connection: async (ctx, payload) => {
    const map = mapCtx(ctx.cell)
    const { entry, maybeLinkedOutcome } = payload ?? {}
    const values = toValues('AcornOutcome', entry ?? {}, map)
    if (maybeLinkedOutcome?.relation === 'ExistingOutcomeAsParent') {
      values.parent = urlFor(ctx.cell, maybeLinkedOutcome.outcomeActionHash)
      values.siblingOrder = maybeLinkedOutcome.siblingOrder
    }
    const outcomeId = await createSubject(ctx, 'AcornOutcome', values)
    const outcomeInst = await instanceById(ctx, 'AcornOutcome', outcomeId)

    let connInst: any = null
    if (maybeLinkedOutcome?.relation === 'ExistingOutcomeAsParent') {
      // the zome made the connection inside create_outcome_with_connection;
      // the new outcome is its child — that edge identifies it.
      const wantedParent = urlFor(
        ctx.cell,
        maybeLinkedOutcome.outcomeActionHash
      )
      for (let i = 0; i < 20 && !connInst; i++) {
        const conns = await modelQuery(
          ctx.call,
          ctx.cell.uuid,
          'AcornConnection'
        )
        connInst = conns.find(
          (r) => r?.child === outcomeId && r?.parent === wantedParent
        )
        if (!connInst) await new Promise((r) => setTimeout(r, 500))
      }
      if (!connInst) {
        throw new Error(
          'create_outcome_with_connection: connection not readable after create'
        )
      }
    } else if (maybeLinkedOutcome?.relation === 'ExistingOutcomeAsChild') {
      const connId = await createSubject(ctx, 'AcornConnection', {
        parent: outcomeId,
        child: urlFor(ctx.cell, maybeLinkedOutcome.outcomeActionHash),
        siblingOrder: maybeLinkedOutcome.siblingOrder,
      })
      connInst = await instanceById(ctx, 'AcornConnection', connId)
    }

    return {
      outcome: toWireRecord('AcornOutcome', outcomeInst, map),
      maybeConnection: connInst
        ? toWireRecord('AcornConnection', connInst, map)
        : null,
    }
  },
}

export async function dispatchZomeCall(
  call: RpcCall,
  cell: CellCtx,
  fnName: string,
  payload: any
): Promise<any> {
  const row = zomeTable[fnName]
  if (!row) {
    throw new Error(`AD4M mode: ${fnName} not implemented yet`)
  }
  return row({ call, cell }, payload)
}
