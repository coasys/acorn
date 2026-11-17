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
//
// - `fieldEditsByCell` is the same snapshot one level down, keyed
//   `className:actionHash:prop` — the title editor's prop is `content`, the
//   description editor's `description`. It freezes when the FIELD's own
//   edit session starts (the emit names it in outcomeBeingEdited), so that
//   field's saves diff against the value the editor showed when typing
//   began — not the expanded view's older snapshot, which a live update
//   the component already accepted would leave behind. Such an accepted
//   live update already moved the remote state, so it IS the next
//   session's original.
//   A field baseline outlives its own session's end: the blur save can
//   reach the diff after the session-end emit already ran. It goes only
//   with its record's session, a remote delete, or cell disposal.
//   `openFieldSessions` tracks which sessions the last emit named, so a
//   (re)opened field recaptures instead of keeping a stale original.

const byCell = new Map<string, Map<string, any>>() // uuid -> key -> entry
const editsByCell = new Map<string, Map<string, any>>() // uuid -> key -> frozen entry
const fieldEditsByCell = new Map<string, Map<string, any>>() // uuid -> key:prop -> frozen entry
const openFieldSessions = new Map<string, Set<string>>() // uuid -> key:prop

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

/** The frozen entry a FIELD edit session started from, if one is held. */
export function fieldEditBaselineEntry(
  uuid: string,
  className: string,
  actionHash: string,
  prop: string
): Record<string, any> | undefined {
  return fieldEditsByCell
    .get(uuid)
    ?.get(`${key(className, actionHash)}:${prop}`)
}

function setFieldEditBaseline(
  uuid: string,
  className: string,
  actionHash: string,
  prop: string,
  entry: any
) {
  let m = fieldEditsByCell.get(uuid)
  if (!m) {
    m = new Map()
    fieldEditsByCell.set(uuid, m)
  }
  m.set(`${key(className, actionHash)}:${prop}`, entry)
}

/** Snapshot the current remote entry as a field session's original. */
export function captureFieldEditBaseline(
  uuid: string,
  className: string,
  actionHash: string,
  prop: string
): boolean {
  const entry = baselineEntry(uuid, className, actionHash)
  if (entry == null) return false
  setFieldEditBaseline(
    uuid,
    className,
    actionHash,
    prop,
    JSON.parse(JSON.stringify(entry))
  )
  return true
}

/** Split a `className:actionHash[:prop]` map key; actionHash has no ':'. */
function splitFieldKey(k: string, prefix: string): [string, string] {
  const rest = k.slice(prefix.length)
  const sep = rest.lastIndexOf(':')
  return [rest.slice(0, sep), rest.slice(sep + 1)]
}

/** `wantedRecords` is the set of records an edit session is open on right
 *  now (from the realtime-info emit: the expanded view's outcome and the
 *  focused field's); `wantedFields` holds `'actionHash:prop'` for each
 *  open FIELD session (a focused title or description editor).
 *  A newly wanted record captures a record baseline — an already open one
 *  keeps its snapshot — and a record no longer wanted drops its baseline
 *  and every field baseline on it. A field session captures its original
 *  only on the transition to open, so a focused-then-refocused field
 *  freezes the remote state at ITS start; when its session ends the
 *  baseline stays for the save that is still in flight. */
export function syncEditBaselines(
  uuid: string,
  className: string,
  wantedRecords: Set<string>,
  wantedFields: Set<string>
) {
  const prefix = `${className}:`
  const m = editsByCell.get(uuid)
  if (m) {
    for (const k of [...m.keys()]) {
      if (k.startsWith(prefix) && !wantedRecords.has(k.slice(prefix.length))) {
        m.delete(k)
      }
    }
  }
  const fm = fieldEditsByCell.get(uuid)
  if (fm) {
    for (const k of [...fm.keys()]) {
      if (!k.startsWith(prefix)) continue
      const [hash] = splitFieldKey(k, prefix)
      if (!wantedRecords.has(hash)) fm.delete(k)
    }
  }
  const open = openFieldSessions.get(uuid) ?? new Set<string>()
  openFieldSessions.set(uuid, open)
  for (const fk of [...open]) {
    if (!fk.startsWith(prefix)) continue
    const [hash, prop] = splitFieldKey(fk, prefix)
    if (!wantedRecords.has(hash) || !wantedFields.has(`${hash}:${prop}`)) {
      // the session ended (or its record did): the original itself is kept
      // for the in-flight save
      open.delete(fk)
    }
  }
  for (const hf of wantedFields) {
    const fk = `${prefix}${hf}`
    if (!open.has(fk)) {
      open.add(fk)
      const [hash, prop] = splitFieldKey(fk, prefix)
      captureFieldEditBaseline(uuid, className, hash, prop)
    }
  }
  for (const hash of wantedRecords) {
    if (!editBaselineEntry(uuid, className, hash)) {
      captureEditBaseline(uuid, className, hash)
    }
  }
}

/** After our own update landed mid-session, the record baseline moves to
 *  the write result: the next save diffs against what the user now sees.
 *  A FIELD baseline moves only on the props the save actually wrote
 *  (`sentProps` are mount-prop names): a field session the save did not
 *  touch keeps its own original, so another editor's unchanged draft is
 *  not resent over a peer's value. No-op when nothing tracks the record. */
export function rebaseEditBaseline(
  uuid: string,
  className: string,
  wire: { actionHash?: unknown; entry?: unknown } | null | undefined,
  sentProps?: Iterable<string>
) {
  if (
    !wire ||
    typeof wire.actionHash !== 'string' ||
    wire.entry == null ||
    typeof wire.entry !== 'object'
  ) {
    return
  }
  const k = key(className, wire.actionHash)
  const fm = fieldEditsByCell.get(uuid)
  const fieldKeys = fm
    ? [...fm.keys()].filter((fk) => fk.startsWith(`${k}:`))
    : []
  if (!editBaselineEntry(uuid, className, wire.actionHash) && !fieldKeys.length) {
    return
  }
  if (editBaselineEntry(uuid, className, wire.actionHash)) {
    setEditBaseline(
      uuid,
      className,
      wire.actionHash,
      JSON.parse(JSON.stringify(wire.entry))
    )
  }
  if (sentProps && fm) {
    const sent = new Set(sentProps)
    const entry = wire.entry as Record<string, any>
    for (const fk of fieldKeys) {
      const prop = fk.slice(k.length + 1)
      const frozen = fm.get(fk)
      if (sent.has(prop) && frozen && prop in entry) {
        frozen[prop] = JSON.parse(JSON.stringify(entry[prop]))
      }
    }
  }
}

export function forgetBaseline(
  uuid: string,
  className: string,
  actionHash: string
) {
  byCell.get(uuid)?.delete(key(className, actionHash))
  editsByCell.get(uuid)?.delete(key(className, actionHash))
  const fp = `${key(className, actionHash)}:`
  const fm = fieldEditsByCell.get(uuid)
  if (fm) {
    for (const k of [...fm.keys()]) {
      if (k.startsWith(fp)) fm.delete(k)
    }
  }
  const open = openFieldSessions.get(uuid)
  if (open) {
    for (const k of [...open]) {
      if (k.startsWith(fp)) open.delete(k)
    }
  }
}

/** Drop every baseline of a cell (its perspective went away). */
export function forgetCellBaselines(uuid: string) {
  byCell.delete(uuid)
  editsByCell.delete(uuid)
  fieldEditsByCell.delete(uuid)
  openFieldSessions.delete(uuid)
}
