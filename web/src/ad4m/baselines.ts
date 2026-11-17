// Record baselines for the changed-keys update diff (Lal review Part 3, P2:
// "Changed keys overwrites concurrent edits").
//
// An update_<type> row diffs the UI's entry against the entry the user
// started editing — the last WireRecord this client produced for that record
// through a fetch or a write result — instead of a fresh modelQuery. A fresh
// fetch reads a peer's concurrent edit back into the diff, and the user's
// stale value for a key they never touched then overwrites the peer's edit.
// With no baseline (a record this client never produced, e.g. straight after
// boot) the rows fall back to the old fresh-fetch diff.
//
// Live-signal deliveries deliberately do not move a baseline: they land while
// the user's in-flight entry is already derived, so moving the baseline under
// it would put the peer's keys right back into the diff.

const byCell = new Map<string, Map<string, any>>() // uuid -> key -> entry

function key(className: string, actionHash: string) {
  return `${className}:${actionHash}`
}

/** The last entry this client produced for the record, if any. */
export function baselineEntry(
  uuid: string,
  className: string,
  actionHash: string
): Record<string, any> | undefined {
  return byCell.get(uuid)?.get(key(className, actionHash))
}

/** Record a WireRecord the UI was given (fetch/create/update result). */
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

export function forgetBaseline(
  uuid: string,
  className: string,
  actionHash: string
) {
  byCell.get(uuid)?.delete(key(className, actionHash))
}

/** Drop every baseline of a cell (its perspective went away). */
export function forgetCellBaselines(uuid: string) {
  byCell.delete(uuid)
}
