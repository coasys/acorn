// Record state for the changed-keys update diff (Lal review Part 3, P2:
// "Changed keys overwrites concurrent edits"; round 2: "the shared read
// cache is not an edit baseline").
//
// Two maps, both per cell and keyed `className:actionHash`:
//
// - `byCell` is the LATEST REMOTE STATE this client has produced or seen:
//   fetch rows and the client's own write results record it, and live
//   subscription deliveries move it. An update with no edit session diffs
//   against it — the saved entry carries the redux record for every field
//   the user did not touch, so only the user's changes differ and are sent.
//   With no entry at all (a record this client never produced, e.g. straight
//   after boot) the rows fall back to the old fresh-fetch diff.
//
// - `editsByCell` holds an IMMUTABLE baseline per open edit session, a
//   frozen copy of the remote entry captured when the session opened. An
//   update for a record under edit diffs against that snapshot instead: a
//   field the user kept still equals the snapshot even when a peer moved it
//   remotely mid-edit, so it is not resent and the peer's value survives.
//   Sessions are captured and ended from the realtime-info emits (the
//   expanded view and focused title/description fields name their outcome).

const byCell = new Map<string, Map<string, any>>() // uuid -> key -> entry
const editsByCell = new Map<string, Map<string, any>>() // uuid -> key -> frozen entry

function key(className: string, actionHash: string) {
  return `${className}:${actionHash}`
}

/** The latest remote entry this client has seen for the record, if any. */
export function baselineEntry(
  uuid: string,
  className: string,
  actionHash: string
): Record<string, any> | undefined {
  return byCell.get(uuid)?.get(key(className, actionHash))
}

/** Record a WireRecord's entry as the latest remote state (fetch/create/
 *  update result, or a live delivery's upsert). */
export function rememberBaseline(
  uuid: string,
  className: string,
  wire: { actionHash?: unknown; entry?: unknown } | null | undefined
) {
  if (
    !wire ||
    typeof wire.actionHash !== 'string' ||
    wire.entry == null ||
    typeof wire.entry !== 'object'
  ) {
    return
  }
  let m = byCell.get(uuid)
  if (!m) {
    m = new Map()
    byCell.set(uuid, m)
  }
  m.set(key(className, wire.actionHash), wire.entry)
}

/** Record a bare entry under an explicit hash (fetch_agents' bare Profile). */
export function rememberBaselineEntry(
  uuid: string,
  className: string,
  actionHash: string,
  entry: any
) {
  rememberBaseline(uuid, className, { actionHash, entry })
}

// --- the per-session edit baseline -------------------------------------------

/** The frozen entry the user started editing, if a session is open. */
export function editBaselineEntry(
  uuid: string,
  className: string,
  actionHash: string
): Record<string, any> | undefined {
  return editsByCell.get(uuid)?.get(key(className, actionHash))
}

function setEditBaseline(
  uuid: string,
  className: string,
  actionHash: string,
  entry: any
) {
  let m = editsByCell.get(uuid)
  if (!m) {
    m = new Map()
    editsByCell.set(uuid, m)
  }
  m.set(key(className, actionHash), entry)
}

/** Snapshot the current remote entry as the session baseline — a deep copy,
 *  so later remote moves and the editor's own entry leave it untouched. */
export function captureEditBaseline(
  uuid: string,
  className: string,
  actionHash: string
): boolean {
  const entry = baselineEntry(uuid, className, actionHash)
  if (entry == null) return false
  setEditBaseline(
    uuid,
    className,
    actionHash,
    JSON.parse(JSON.stringify(entry))
  )
  return true
}

/** `wanted` is the set of records an edit session is open on right now
 *  (from the realtime-info emit): capture a baseline for each newly opened
 *  one — an already open session keeps its original snapshot — and drop the
 *  baselines of the sessions that ended. */
export function syncEditBaselines(
  uuid: string,
  className: string,
  wanted: Set<string>
) {
  const m = editsByCell.get(uuid)
  if (m) {
    const prefix = `${className}:`
    for (const k of [...m.keys()]) {
      if (k.startsWith(prefix) && !wanted.has(k.slice(prefix.length))) {
        m.delete(k)
      }
    }
  }
  for (const hash of wanted) {
    if (!editBaselineEntry(uuid, className, hash)) {
      captureEditBaseline(uuid, className, hash)
    }
  }
}

/** After our own update landed mid-session, the baseline moves to the write
 *  result: the next save diffs against what the user now sees. No-op when
 *  the record is not under edit. */
export function rebaseEditBaseline(
  uuid: string,
  className: string,
  wire: { actionHash?: unknown; entry?: unknown } | null | undefined
) {
  if (
    !wire ||
    typeof wire.actionHash !== 'string' ||
    wire.entry == null ||
    typeof wire.entry !== 'object' ||
    !editBaselineEntry(uuid, className, wire.actionHash)
  ) {
    return
  }
  setEditBaseline(
    uuid,
    className,
    wire.actionHash,
    JSON.parse(JSON.stringify(wire.entry))
  )
}

export function forgetBaseline(
  uuid: string,
  className: string,
  actionHash: string
) {
  byCell.get(uuid)?.delete(key(className, actionHash))
  editsByCell.get(uuid)?.delete(key(className, actionHash))
}

/** Drop every baseline of a cell (its perspective went away). */
export function forgetCellBaselines(uuid: string) {
  byCell.delete(uuid)
  editsByCell.delete(uuid)
}
