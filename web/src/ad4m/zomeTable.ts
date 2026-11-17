// fn_name -> AD4M call translation (design §6.2, spec C1 read rows).
//
// Every fetch maps to `perspective.modelQuery` on the cell's mounted
// perspective; the instances map back to WireRecords through mapping.ts.
// `whoami`/`create_whoami` go to the language's `project` interactions /
// createSubject. Every fn_name with no row throws
// `AD4M mode: <fn> not implemented yet` — the write rows land in C2.

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
