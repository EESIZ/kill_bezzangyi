// Independent, read-only verifier. Does not call the planner or scheduler.
import { gateState, globsOverlap, normalizeOwnsGlob, parseGates, validateScopeId } from "./gates.mjs";
import { managedEvidenceIssue } from "./verification.mjs";
import { reportsOf, turnOf, gateDefinitions, originalReport, attemptsFor, retiredAttempt, validateCheckpoint, retiresExecution } from "./handoff.mjs";

function verifyReports(model, issue, final) {
  const { meta, rows } = model, reports = reportsOf(meta), turn = turnOf(meta);
  if (!Array.isArray(reports) || !Number.isSafeInteger(turn) || turn !== meta.operations.length) throw new Error("invalid logical turn/report registry");
  const ids = new Set(), pendingParents = new Set(), retired = new Set();
  for (const r of reports) {
    if (!r || typeof r.id !== "string" || validateScopeId(r.id) || ids.has(r.id) || !["pending", "applied", "resumed", "rejected"].includes(r.state)) throw new Error("invalid or duplicate report");
    ids.add(r.id);
    const parent = rows.find((row) => row.id === r.parent), source = model.dispatchWaves?.[r.source?.wave];
    const start = source?.started["leaf-" + r.parent], returned = source?.returned["leaf-" + r.parent];
    if (!parent || !start || start.handle !== r.source?.handle || start.at !== r.source?.startAt || !["sealed", "complete"].includes(source?.state)) issue("report-source-mismatch", r.id);
    if (!Number.isSafeInteger(r.reportedTurn) || r.reportedTurn < 1 || r.reportedTurn > turn ||
        !meta.operations.some((op) => op.id === r.operation && op.turn === r.reportedTurn)) issue("report-turn-mismatch", r.id);
    if (typeof r.ledger !== "string" || !r.contract || !Array.isArray(r.contract.needs) || !r.refinement?.children?.length) throw new Error("invalid report checkpoint contract");
    const doc = parseGates(r.ledger);
    try {
      if (doc.errors.length) throw new Error("invalid checkpoint ledger");
      validateCheckpoint({ owns: doc.owns, gates: doc.gates.map((g) => ({ id: g.id, state: gateState(g, doc.abandoned) })) }, r.checkpoint);
    } catch { issue("invalid-checkpoint", r.id); }
    if (parent?.ledger && JSON.stringify(gateDefinitions(parent.ledger)) !== JSON.stringify(gateDefinitions(r.ledger))) issue("changed-reported-gates", r.id);
    if (r.state === "pending") {
      if (pendingParents.has(r.parent)) issue("duplicate-pending-report", r.parent);
      pendingParents.add(r.parent);
      if (parent?.state === "VERIFIED") issue("pending-parent-verified", r.id);
      if (r.resolvedTurn !== undefined || r.returnedAt !== undefined) issue("premature-report-resolution", r.id);
      if (final) issue("pending-refinement-report", r.id);
      continue;
    }
    if (!Number.isSafeInteger(r.resolvedTurn) || r.resolvedTurn <= r.reportedTurn || r.resolvedTurn > turn ||
        !meta.operations.some((op) => op.id === r.resolutionOperation && op.turn === r.resolvedTurn)) issue("resolution-turn-mismatch", r.id);
    if (r.state === "rejected") {
      if (typeof r.reason !== "string" || !r.reason.trim() || r.returnedAt !== undefined) issue("invalid-report-rejection", r.id);
      continue;
    }
    const identity = JSON.stringify([r.source.wave, r.parent, r.source.handle, r.source.startAt]);
    if (retired.has(identity)) issue("duplicate-retired-attempt", r.id);
    retired.add(identity);
    if (!returned || r.returnedAt !== returned.at || r.stopped !== true || r.reviewed !== true ||
        typeof r.stopEvidence !== "string" || !r.stopEvidence.trim() || typeof r.reviewEvidence !== "string" || !r.reviewEvidence.trim()) issue("unconfirmed-handoff", r.id);
    if (r.state === "resumed") continue;
    const split = meta.splits.find((s) => s.parent === r.parent);
    for (const c of r.refinement.children) {
      const child = rows.find((row) => row.id === c.id);
      if (!split?.children.includes(c.id) || !parent?.needs.includes(c.id) || !child ||
          r.contract.needs.some((p) => !child.needs.includes(p)) || c.needs.some((p) => !child.needs.includes(p))) issue("lost-reported-child", c.id);
      if (child?.ledger && JSON.stringify(gateDefinitions(child.ledger)) !== JSON.stringify(gateDefinitions(c.ledger))) issue("changed-reported-child-gates", c.id);
      const proposed = parseGates(c.ledger);
      const sortSets = (sets) => JSON.stringify(sets.map((set) => [...set].sort()));
      if (child && sortSets([child.owns, child.reads, child.resourceReads, child.resourceWrites]) !==
          sortSets([proposed.owns, c.access.reads.map((s) => normalizeOwnsGlob(s).value), c.access.resourceReads, c.access.resourceWrites])) issue("changed-reported-child-access", c.id);
    }
  }
}

export function verifyStructure(model, selection = null, final = false) {
  const errors = [];
  const issue = (code, id = "") => errors.push({ code, id });
  const rows = model.rows, meta = model.meta;
  if (!meta || meta.schema !== 1 || !Array.isArray(meta.initial) || !Array.isArray(meta.expected) ||
      !Array.isArray(meta.groups) || !Array.isArray(meta.splits) || !Array.isArray(meta.requiredEdges) ||
      !meta.requiredGates || !Array.isArray(meta.operations)) throw new Error("invalid STRUCTURE schema");
  if (new Set(meta.operations.map((op) => op.id)).size !== meta.operations.length ||
      meta.operations.some((op) => typeof op.id !== "string" || !/^[a-f0-9]{64}$/.test(op.requestHash))) issue("invalid-operations");
  if (meta.operations.some((op, i) => op.turn !== undefined && op.turn !== i + 1)) issue("invalid-operation-turn");
  verifyReports(model, issue, final);
  if (model.dispatchWaves) {
    const expectedActive = new Set(rows.filter((r) => r.state === "IN-FLIGHT").map((r) => r.id));
    for (const [waveId, wave] of Object.entries(model.dispatchWaves)) for (const [fullId, start] of Object.entries(wave.started)) {
      const id = fullId.slice(5), row = rows.find((r) => r.id === id), returned = wave.returned[fullId];
      // Reconcile actual attempts rather than trusting the caller's active count.
      const handedOff = reportsOf(meta).some((r) => (r.state === "applied" || r.state === "resumed") && r.parent === id && r.source.wave === waveId &&
        r.source.handle === start.handle && r.source.startAt === start.at && returned && r.returnedAt === returned.at);
      if ((!returned || row?.state !== "VERIFIED") && !handedOff) expectedActive.add(id);
    }
    if (JSON.stringify([...expectedActive].sort()) !== JSON.stringify([...model.active].sort())) issue("active-accounting-mismatch");
  }
  if ((model.registryInitialized || model.files?.["STRUCTURE.json"] != null) && !model.otherGates?.["GATES.md"]?.some((g) => g.id === "S_STRUCTURE")) issue("missing-structure-gate");
  const nodes = new Map(rows.map((r) => [r.id, r]));
  if (model.root && model.scope) for (const row of rows) {
    if (row.state === "VERIFIED") {
      const stale = managedEvidenceIssue(model.root, ".unlazy/" + model.scope + "/gates/leaf-" + row.id + ".md");
      if (stale) issue("verification-" + stale, row.id);
    }
  }
  for (const id of model.active) if (!nodes.has(id)) issue("orphan-worker", id);
  for (const lease of model.leases) {
    if (lease.invalid) issue("invalid-lease");
    if (lease.scope === model.scope) {
      const id = lease.leaf?.startsWith("leaf-") ? lease.leaf.slice(5) : "";
      if (!nodes.has(id)) issue("orphan-lease", id);
      else if (JSON.stringify([...lease.globs].sort()) !== JSON.stringify([...nodes.get(id).owns].sort())) issue("lease-ownership-mismatch", id);
    }
  }
  if (nodes.size !== rows.length) issue("duplicate-task");
  const expected = new Set(meta.initial);
  if (expected.size !== meta.initial.length) issue("duplicate-initial");
  const splitParents = new Set();
  for (const split of meta.splits) {
    if (!expected.has(split.parent) || splitParents.has(split.parent) || !Array.isArray(split.children) || split.children.length < 2) issue("invalid-split", split.parent);
    splitParents.add(split.parent);
    for (const id of split.children || []) {
      if (expected.has(id)) issue("duplicate-child", id);
      expected.add(id);
      if (!nodes.get(split.parent)?.needs.includes(id)) issue("orphan-child", id);
    }
  }
  if (new Set(meta.expected).size !== meta.expected.length) issue("duplicate-expected");
  for (const id of new Set([...expected, ...meta.expected, ...nodes.keys()])) {
    if (!expected.has(id) || !meta.expected.includes(id) || !nodes.has(id)) issue("task-conservation", id);
  }
  const outgoing = new Map(rows.map((r) => [r.id, []]));
  for (const row of rows) for (const dep of row.needs) {
    if (!nodes.has(dep)) issue("missing-dependency", dep);
    else outgoing.get(dep).push(row.id);
    if (row.state === "VERIFIED" && nodes.get(dep)?.state !== "VERIFIED") issue("premature-verification", row.id);
  }
  // Breadth-first reachability, independent of the planner's topological sets.
  const reach = new Map();
  for (const id of nodes.keys()) {
    const found = new Set(), queue = [...outgoing.get(id)];
    for (let i = 0; i < queue.length; i++) if (!found.has(queue[i])) {
      found.add(queue[i]); queue.push(...(outgoing.get(queue[i]) || []));
    }
    if (found.has(id)) issue("dependency-cycle", id);
    reach.set(id, found);
  }
  for (const edge of meta.requiredEdges) {
    if (!Array.isArray(edge) || edge.length !== 2 || !nodes.get(edge[1])?.needs.includes(edge[0])) issue("lost-edge", String(edge));
  }
  for (const [id, required] of Object.entries(meta.requiredGates)) {
    if (!Array.isArray(required) || !nodes.has(id) || required.some((g) => !nodes.get(id).gates.some((v) => v.id === g))) issue("lost-gate", id);
  }
  for (const row of rows) {
    if (!Object.prototype.hasOwnProperty.call(meta.requiredGates, row.id)) issue("untracked-gates", row.id);
    if (row.state === "VERIFIED" && row.gates.some((g) => g.state !== "met")) issue("stale-verification", row.id);
  }
  for (const [file, ids] of Object.entries(meta.requiredIntegrations || {})) {
    if (!Array.isArray(ids) || ids.some((id) => !model.otherGates?.[file]?.some((g) => g.id === id))) issue("lost-integration-gate", file);
  }
  const owner = new Map();
  for (let i = 0; i < meta.groups.length; i++) {
    const group = meta.groups[i];
    if (!Array.isArray(group) || !group.length) { issue("invalid-group"); continue; }
    for (const id of group) {
      if (!nodes.has(id)) issue("extra-group-member", id);
      if (owner.has(id)) issue("duplicate-assignment", id);
      owner.set(id, i);
    }
    const unfinished = group.filter((id) => nodes.has(id) && nodes.get(id).state !== "VERIFIED");
    for (let a = 0; a < unfinished.length; a++) for (let b = a + 1; b < unfinished.length; b++) {
      const x = unfinished[a], y = unfinished[b];
      if (!reach.get(x).has(y) && !reach.get(y).has(x)) issue("lost-parallelism", x + "," + y);
    }
  }
  for (const id of nodes.keys()) if (!owner.has(id)) issue("unassigned-task", id);
  const groupEdges = Array.from({ length: meta.groups.length }, () => new Set());
  for (const row of rows) for (const dep of row.needs) {
    const a = owner.get(dep), b = owner.get(row.id);
    if (a !== undefined && b !== undefined && a !== b) groupEdges[a].add(b);
  }
  const indegree = Array(groupEdges.length).fill(0);
  for (const edges of groupEdges) for (const to of edges) indegree[to]++;
  const queue = indegree.flatMap((d, i) => d === 0 ? [i] : []);
  for (let i = 0; i < queue.length; i++) for (const to of groupEdges[queue[i]]) if (--indegree[to] === 0) queue.push(to);
  if (queue.length !== groupEdges.length) issue("group-cycle");

  const overlap = (xs, ys) => xs.some((x) => ys.some((y) => globsOverlap(x.toLowerCase(), y.toLowerCase())));
  const same = (xs, ys) => xs.some((x) => ys.includes(x));
  const independent = (x, y) => !reach.get(x.id)?.has(y.id) && !reach.get(y.id)?.has(x.id) &&
    !overlap(x.owns, y.owns) && !overlap(x.owns, y.reads) && !overlap(y.owns, x.reads) &&
    !same(x.resourceWrites, y.resourceWrites) && !same(x.resourceWrites, y.resourceReads) && !same(y.resourceWrites, x.resourceReads);
  if (selection) {
    const ids = selection.launch;
    if (!Array.isArray(ids) || !Number.isSafeInteger(selection.slots) || selection.slots < 1) throw new Error("invalid selection");
    if (new Set(ids).size !== ids.length) issue("duplicate-launch");
    if (ids.length && ids.length + model.active.size > selection.slots) issue("capacity-exceeded");
    for (const id of ids) {
      const row = nodes.get(id);
      if (!row) { issue("unknown-launch", id); continue; }
      if (!['WAITING', 'READY'].includes(row.state) || model.active.has(id) || row.needs.some((p) =>
        nodes.get(p)?.state !== "VERIFIED" || model.leases.some((l) => l.scope === model.scope && l.leaf === "leaf-" + p))) issue("not-ready", id);
      if (model.leases.some((l) => !(l.scope === model.scope && l.leaf === "leaf-" + id) && overlap(l.globs, [...row.owns, ...row.reads]))) issue("lease-conflict", id);
      for (const other of [...model.active, ...ids.filter((v) => v !== id)]) {
        if (nodes.has(other) && !independent(row, nodes.get(other))) issue("parallel-conflict", id + "," + other);
      }
    }
  }
  if (final) {
    if (!model.otherGates?.["GATES.md"]?.some((g) => g.id === "S_STRUCTURE")) issue("missing-structure-gate");
    if (model.otherGates?.["GATES.md"]?.some((g) => g.id === "S_STRUCTURE" && g.state === "abandoned")) issue("abandoned-structure-gate");
    for (const row of rows) if (row.state !== "VERIFIED" || row.gates.some((g) => g.state !== "met")) issue("unfinished-task", row.id);
    if (model.active.size) issue("active-workers");
    if (model.leases.some((l) => l.scope === model.scope || l.invalid)) issue("remaining-leases");
    if (model.dispatch.blocking.length || model.dispatch.abandoned.length) issue("unfinished-dispatch");
    for (const [file, gates] of Object.entries(model.otherGates || {})) {
      for (const gate of gates) if (!(file === "GATES.md" && gate.id === "S_STRUCTURE") && gate.state !== "met") issue("unfinished-integration", file + ":" + gate.id);
    }
  }
  return { ok: errors.length === 0, residual: errors.length, errors };
}

// Checks preservation against the original snapshot, not just a self-consistent
// proposed metadata file. It deliberately does not reproduce the planner policy.
export function verifyTransition(before, after) {
  const result = verifyStructure(after);
  const add = (code, id) => result.errors.push({ code, id });
  const released = new Set();
  for (const old of reportsOf(before.meta)) {
    const current = reportsOf(after.meta).find((r) => r.id === old.id);
    if (!current || JSON.stringify(originalReport(current)) !== JSON.stringify(originalReport(old)) ||
        (old.state !== "pending" && JSON.stringify(current) !== JSON.stringify(old))) { add("changed-handoff-history", old.id); continue; }
    if (old.state === "pending" && retiresExecution(current)) {
      const parent = before.rows.find((r) => r.id === old.parent), a = attemptsFor(before.dispatchWaves, old.parent).find((s) => s.wave === old.source.wave);
      const other = attemptsFor(before.dispatchWaves, old.parent).some((s) => s.wave !== old.source.wave && !retiredAttempt(before.meta, s.wave, old.parent,
        { at: s.startAt, handle: s.handle }, s.returnedAt ? { at: s.returnedAt } : null));
      if (!a?.returnedAt || a.returnedAt !== current.returnedAt || other || !parent || parent.state === "VERIFIED" ||
          before.leases.some((l) => l.scope === before.scope && l.leaf === "leaf-" + old.parent)) add("unsafe-handoff-boundary", old.id);
      else released.add(old.parent);
    }
  }
  for (const r of reportsOf(after.meta)) if (!reportsOf(before.meta).some((old) => old.id === r.id) && r.state !== "pending") add("unreported-resolution", r.id);
  if (turnOf(after.meta) !== turnOf(before.meta) + 1) add("invalid-turn-transition", "");
  for (const op of before.meta.operations) if (!after.meta.operations.some((current) => JSON.stringify(current) === JSON.stringify(op))) add("lost-operation-receipt", op.id);
  for (const old of before.rows) {
    const current = after.rows.find((r) => r.id === old.id);
    if (!current) { add("removed-original-task", old.id); continue; }
    for (const dep of old.needs) if (!current.needs.includes(dep)) add("removed-original-edge", old.id);
    const definition = (text) => parseGates(text).gates.map(({ id, title, check, expect, cwd }) => [id, title, check, expect, cwd]);
    if (JSON.stringify(definition(old.ledger)) !== JSON.stringify(definition(current.ledger))) add("changed-original-gates", old.id);
    if (JSON.stringify([old.owns, old.reads, old.resourceReads, old.resourceWrites]) !==
        JSON.stringify([current.owns, current.reads, current.resourceReads, current.resourceWrites])) add("changed-original-access", old.id);
  }
  for (const split of after.meta.splits.filter((s) => !before.meta.splits.some((old) => old.parent === s.parent && s.children.every((id) => old.children.includes(id))))) {
    const old = before.rows.find((r) => r.id === split.parent);
    if (old && (!released.has(old.id) && (before.declared.has(old.id) || before.active.has(old.id)) || before.leases.some((l) => l.scope === before.scope && l.leaf === "leaf-" + old.id))) add("unsafe-live-split", old.id);
  }
  for (const group of after.meta.groups) if (!before.meta.groups.some((g) => JSON.stringify([...g].sort()) === JSON.stringify([...group].sort()))) {
    for (const id of group) if (before.active.has(id) && !released.has(id) || before.leases.some((l) => l.scope === before.scope && l.leaf === "leaf-" + id)) add("unsafe-live-regroup", id);
  }
  result.ok = result.errors.length === 0; result.residual = result.errors.length;
  return result;
}
