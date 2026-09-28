// Read-only scheduling over existing unlazy authorities. Node 16+, no dependencies.
import { basename, join, relative, resolve } from "node:path";
import {
  gateState, globsOverlap, normalizeOwnsGlob, parseGates, readLeases,
  readStableRegularFile, resolveTarget, scopeRoot, sha256, validateScopeId,
} from "./gates.mjs";
import { dispatchStatus } from "./dispatch.mjs";
import { verifyStructure } from "./structure-check.mjs";
import { retiredAttempt, reportsOf, turnOf, retiresExecution } from "./handoff.mjs";
import { managedEvidenceIssue } from "./verification.mjs";

const STATES = new Set(["WAITING", "READY", "IN-FLIGHT", "VERIFIED", "ABANDONED"]);
const HEADER = ["Leaf", "Owns", "Needs", "Tier", "Planned wave", "State"];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = (message) => { throw new Error(message); };
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const equal = (a, b) => JSON.stringify([...a].sort(compare)) === JSON.stringify([...b].sort(compare));
const cells = (line) => line.trim().slice(1, -1).split("|").map((s) => s.trim());
const list = (s) => s === "-" ? [] : s.split(",").map((v) => v.trim());

function uniqueStrings(values, label) {
  if (!Array.isArray(values) || values.some((v) => typeof v !== "string" || !v || /[\x00-\x1f\x7f]/.test(v))) {
    fail(label + " must be an array of nonblank strings");
  }
  if (new Set(values).size !== values.length) fail(label + " contains duplicates");
  return values;
}

function paths(values, label) {
  return uniqueStrings(uniqueStrings(values, label).map((v) => {
    const result = normalizeOwnsGlob(v);
    if (result.error || /[<>|]/.test(v)) fail(label + " contains an invalid or placeholder path");
    return result.value;
  }), label);
}

export function parsePlan(text) {
  // Fenced examples are not operational tables or revisions.
  let fence = null;
  const lines = text.split(/\r?\n/).filter((line) => {
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (match) {
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = null;
      return false;
    }
    return !fence;
  });
  const revisions = lines.map((line) => line.match(/^Contract revision:\s*([1-9]\d*)(?:\.|\s|$)/)).filter(Boolean);
  if (revisions.length !== 1) fail("PLAN needs exactly one Contract revision: positive integer");
  const revision = Number(revisions[0][1]);
  if (!Number.isSafeInteger(revision)) fail("invalid contract revision");
  const headers = lines.map((line, i) => /^\s*\|\s*Leaf\s*\|/.test(line) ? i : -1).filter((i) => i >= 0);
  if (headers.length !== 1) fail("PLAN needs exactly one leaf dispatch table");
  const start = headers[0];
  if (!equalOrdered(cells(lines[start]), HEADER)) fail("unsupported PLAN dispatch columns");
  const separator = cells(lines[start + 1] || "");
  if (separator.length !== HEADER.length || separator.some((v) => !/^:?-{3,}:?$/.test(v))) fail("invalid table separator");
  const rows = [];
  for (let i = start + 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) {
    const row = cells(lines[i]);
    if (row.length !== HEADER.length) fail("invalid PLAN row");
    const [id, owns, needs, tier, wave, state] = row;
    if (validateScopeId(id, "leaf") || id.startsWith("leaf-")) fail("use bare leaf ids (without leaf-) in PLAN");
    if (!STATES.has(state) || !["judgment", "mechanical"].includes(tier) || !/^[1-9]\d*$/.test(wave) || !Number.isSafeInteger(Number(wave))) fail("invalid PLAN metadata for " + id);
    rows.push({ id, owns: paths(list(owns), id + " Owns"), needs: uniqueStrings(list(needs), id + " Needs"), tier, state, wave: Number(wave) });
  }
  if (!rows.length) fail("PLAN has no leaves");
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (byId.size !== rows.length) fail("duplicate PLAN leaf id");
  for (const row of rows) for (const dep of row.needs) {
    if (!byId.has(dep)) fail("unknown dependency " + dep);
    if (dep === row.id) fail("self dependency " + dep);
  }
  // Kahn traversal detects cycles without recursion or a depth-dependent stack.
  const successors = new Map(rows.map((r) => [r.id, []]));
  const remaining = new Map(rows.map((r) => [r.id, r.needs.length]));
  for (const row of rows) for (const dep of row.needs) successors.get(dep).push(row.id);
  const order = rows.filter((r) => !r.needs.length).map((r) => r.id).sort(compare);
  for (let i = 0; i < order.length; i++) for (const id of successors.get(order[i])) {
    remaining.set(id, remaining.get(id) - 1);
    if (remaining.get(id) === 0) order.push(id);
  }
  if (order.length !== rows.length) fail("dependency cycle in PLAN");
  for (const row of rows) for (const dep of row.needs) {
    if (byId.get(dep).wave >= row.wave) fail("dependency must be in an earlier Planned wave: " + row.id);
  }
  return { revision, rows: rows.sort((a, b) => compare(a.id, b.id)), byId, successors, order };
}

const equalOrdered = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const overlap = (a, b) => a.some((x) => b.some((y) => globsOverlap(x.toLowerCase(), y.toLowerCase())));
const intersects = (a, b) => a.some((x) => b.includes(x));

export function conflicts(a, b) {
  // Case folding is conservative on case-sensitive filesystems as well.
  return overlap(a.owns, b.owns) || overlap(a.owns, b.reads) || overlap(b.owns, a.reads) ||
    intersects(a.resourceWrites, b.resourceWrites) || intersects(a.resourceWrites, b.resourceReads) ||
    intersects(b.resourceWrites, a.resourceReads);
}

export function schedule({ root, scope, slots, details = false }) {
  root = resolve(root);
  if (validateScopeId(scope)) fail("invalid scope");
  if (!Number.isSafeInteger(slots) || slots < 1) fail("slots must be a positive integer (total scope concurrency)");
  const directory = scopeRoot(root, scope);
  const snapshots = new Map();
  const read = (path, optional = false) => {
    let text;
    try { text = readStableRegularFile(path, { root, maxBytes: 8 * 1024 * 1024, label: "scheduler input" }); }
    catch (error) { if (!optional || error.code !== "ENOENT") throw error; text = null; }
    snapshots.set(path, text);
    return text;
  };
  if (read(join(directory, "STRUCTURE.pending.json"), true) !== null) fail("pending structure transaction: recover first");
  const structureText = read(join(directory, "STRUCTURE.json"), true);
  const structureMeta = structureText === null ? null : JSON.parse(structureText);
  const rootLedger = read(join(directory, "GATES.md"), true);
  if (structureText === null && rootLedger !== null && parseGates(rootLedger).gates.some((g) => g.id === "S_STRUCTURE")) fail("structure registry missing: reconcile before scheduling");
  const plan = parsePlan(read(join(directory, "PLAN.md")));
  const leafInventory = () => {
    const target = resolveTarget({ root, scope });
    if (target.error || target.discoveryErrors.length) fail("cannot discover scope ledgers");
    return target.files.map((p) => basename(p)).filter((p) => /^leaf-.*\.md$/.test(p)).sort(compare);
  };
  const ledgerNames = plan.rows.map((r) => "leaf-" + r.id + ".md").sort(compare);
  if (!equal(leafInventory(), ledgerNames)) fail("PLAN leaves must match scope leaf ledgers exactly");
  const access = JSON.parse(read(join(directory, "ACCESS.json")));
  if (!object(access) || access.schema !== 1 || access.contractRevision !== plan.revision || !object(access.leaves)) {
    fail("ACCESS schema/revision must match PLAN");
  }
  if (!equal(Object.keys(access.leaves), plan.rows.map((r) => r.id))) fail("ACCESS leaf ids must match PLAN exactly");
  const attention = [];
  for (const row of plan.rows) {
    const entry = access.leaves[row.id];
    if (!object(entry) || entry.complete !== true) fail("declare complete access information for " + row.id);
    row.reads = paths(entry.reads, row.id + " reads");
    row.resourceReads = uniqueStrings(entry.resourceReads, row.id + " resourceReads");
    row.resourceWrites = uniqueStrings(entry.resourceWrites, row.id + " resourceWrites");
    if ([...row.resourceReads, ...row.resourceWrites].some((s) => !/^[a-z0-9][a-z0-9:._/-]*$/.test(s))) fail("resource ids must be canonical lowercase names");
    row.ledger = read(join(directory, "gates", "leaf-" + row.id + ".md"));
    const doc = parseGates(row.ledger);
    if (doc.errors.length) fail("invalid leaf ledger " + row.id + ": " + doc.errors.join("; "));
    const owns = paths(doc.owns, row.id + " OWNS");
    if (!owns.length || !equal(row.owns, owns)) fail("PLAN Owns must equal ledger OWNS for " + row.id);
    row.owns = owns;
    const states = doc.gates.map((g) => gateState(g, doc.abandoned));
    row.gates = doc.gates.map((g, i) => ({ id: g.id, state: states[i] }));
    if (states.includes("abandoned") || row.state === "ABANDONED") attention.push({ leaf: row.id, reason: "handoff" });
    if (row.state === "VERIFIED" && states.some((s) => s !== "met")) attention.push({ leaf: row.id, reason: "verified-ledger-not-met" });
    if (row.state === "VERIFIED") {
      const stale = managedEvidenceIssue(root, relative(root, join(directory, "gates", "leaf-" + row.id + ".md")));
      if (stale) attention.push({ leaf: row.id, reason: "verification-" + stale });
    }
    if (row.state === "VERIFIED" && row.needs.some((id) => plan.byId.get(id).state !== "VERIFIED")) attention.push({ leaf: row.id, reason: "verified-before-dependency" });
  }

  const ancestors = new Map();
  for (const id of plan.order) {
    const set = new Set();
    for (const dep of plan.byId.get(id).needs) {
      set.add(dep);
      for (const a of ancestors.get(dep)) set.add(a);
    }
    ancestors.set(id, set);
  }
  const independent = (a, b) => !ancestors.get(a.id).has(b.id) && !ancestors.get(b.id).has(a.id) && !conflicts(a, b);
  let hasParallel = false;
  for (let i = 0; i < plan.rows.length && !hasParallel; i++) {
    for (let j = i + 1; j < plan.rows.length; j++) if (independent(plan.rows[i], plan.rows[j])) { hasParallel = true; break; }
  }
  // Maximal single-successor/single-predecessor chains, not an optimal partition.
  const chains = [], assigned = new Set(), chainPredecessor = new Map();
  for (const id of plan.order) {
    if (assigned.has(id)) continue;
    const chain = [];
    let next = id;
    while (next) {
      chain.push(next); assigned.add(next);
      const out = plan.successors.get(next);
      next = out.length === 1 && plan.byId.get(out[0]).needs.length === 1 ? out[0] : null;
    }
    for (let i = 1; i < chain.length; i++) chainPredecessor.set(chain[i], chain[i - 1]);
    chains.push(chain);
  }

  const dispatchText = read(join(directory, "dispatch.json"), true);
  const status = dispatchStatus(root, scope);
  if (status.errors.length) fail("invalid dispatch state");
  const active = new Set(plan.rows.filter((r) => r.state === "IN-FLIGHT").map((r) => r.id));
  const returned = new Set(), lastStarts = new Map();
  const dispatchWaves = dispatchText === null ? {} : JSON.parse(dispatchText).waves;
  if (dispatchText !== null) {
    const dispatch = JSON.parse(dispatchText);
    if (!object(dispatch.waves)) fail("invalid dispatch snapshot");
    for (const [waveId, wave] of Object.entries(dispatch.waves)) {
      if (wave.state === "open" || wave.state === "abandoned") attention.push({ wave: waveId, reason: "resume-" + wave.state + "-wave" });
      for (const fullId of wave.leaves) {
        if (!fullId.startsWith("leaf-") || !plan.byId.has(fullId.slice(5))) fail("dispatch references unknown leaf");
        const id = fullId.slice(5);
        const start = wave.started[fullId];
        if (retiredAttempt(structureMeta, waveId, id, start, wave.returned[fullId])) continue;
        if (start && (!lastStarts.has(id) || Date.parse(start.at) > Date.parse(lastStarts.get(id).at))) lastStarts.set(id, start);
        if (wave.returned[fullId]) {
          if (plan.byId.get(id).state !== "VERIFIED") { returned.add(id); active.add(id); }
        } else if (wave.started[fullId]) {
          if (plan.byId.get(id).state === "VERIFIED") attention.push({ leaf: id, reason: "verified-before-return" });
          active.add(id);
        }
      }
    }
  }
  const leases = readLeases(root);
  const leaseSignature = (items) => JSON.stringify(items.map(({ scope: s, leaf, globs, invalid }) => [s, leaf, globs, !!invalid]));
  if (leases.some((l) => l.invalid || l.scope !== scope)) attention.push({ reason: "external-or-invalid-lease-needs-review" });
  for (const lease of leases.filter((l) => l.scope === scope)) {
    if (!lease.leaf.startsWith("leaf-") || !plan.byId.has(lease.leaf.slice(5))) attention.push({ reason: "unknown-lease-owner" });
    else if (!equal(lease.globs, plan.byId.get(lease.leaf.slice(5)).owns)) attention.push({ leaf: lease.leaf.slice(5), reason: "lease-ownership-mismatch" });
  }
  const ownLease = (id) => leases.some((l) => l.scope === scope && l.leaf === "leaf-" + id);
  let structureModel = null;
  if (structureText !== null) {
    const otherGates = {};
    for (const file of resolveTarget({ root, scope }).files) if (!/^leaf-/.test(basename(file))) {
      const doc = parseGates(read(file));
      if (doc.errors.length) fail("invalid integration ledger");
      otherGates[relative(directory, file).replace(/\\/g, "/")] = doc.gates.map((g) => ({ id: g.id, state: gateState(g, doc.abandoned) }));
    }
    structureModel = { registryInitialized: true, rows: plan.rows, meta: structureMeta, active, leases, scope, dispatch: status, dispatchWaves, otherGates };
    const check = verifyStructure(structureModel);
    if (!check.ok) fail("structure verification failed: " + JSON.stringify(check.errors));
    chains.splice(0, chains.length, ...structureModel.meta.groups);
    chainPredecessor.clear();
    for (const group of chains) for (const id of group) {
      const prior = plan.order.filter((p) => group.includes(p) && ancestors.get(id).has(p) && plan.byId.get(p).state === "VERIFIED");
      if (prior.length) chainPredecessor.set(id, prior[prior.length - 1]);
    }
  }
  const available = Math.max(0, slots - active.size);
  const launch = [], blocked = [];
  for (const row of plan.rows) {
    if (["VERIFIED", "ABANDONED"].includes(row.state) || active.has(row.id)) continue;
    let reason;
    const deps = row.needs.filter((id) => plan.byId.get(id).state !== "VERIFIED" || ownLease(id));
    if (deps.length) reason = "dependencies-or-unreleased-leases";
    else if (leases.some((l) => !(l.scope === scope && l.leaf === "leaf-" + row.id) && overlap(l.globs, [...row.owns, ...row.reads]))) reason = "live-lease-conflict";
    else if ([...active].some((id) => !independent(row, plan.byId.get(id)))) reason = "active-conflict";
    else if (launch.some((id) => !independent(row, plan.byId.get(id)))) reason = "selected-conflict";
    else if (attention.length) reason = "attention-required";
    else if (launch.length >= available) reason = "slots";
    if (reason) blocked.push({ leaf: row.id, reason, ...(deps.length ? { needs: deps } : {}) });
    else launch.push(row.id);
  }
  if (structureModel) {
    const check = verifyStructure(structureModel, { launch, slots });
    if (!check.ok) fail("selection verification failed: " + JSON.stringify(check.errors));
  }
  // These reads are not a global transaction. Detect ordinary concurrent edits;
  // claims and native launch barriers remain authoritative at execution time.
  for (const [path, original] of snapshots) {
    let current;
    try { current = readStableRegularFile(path, { root, maxBytes: 8 * 1024 * 1024, label: "scheduler input" }); }
    catch (error) { if (error.code !== "ENOENT") throw error; current = null; }
    if (current !== original) fail("inputs changed while scheduling; rerun");
  }
  if (leaseSignature(leases) !== leaseSignature(readLeases(root))) fail("leases changed while scheduling; rerun");
  if (!equal(leafInventory(), ledgerNames)) fail("leaf inventory changed while scheduling; rerun");
  const blockedCounts = {};
  for (const item of blocked) blockedCounts[item.reason] = (blockedCounts[item.reason] || 0) + 1;
  const result = {
    schema: 1,
    snapshot: sha256(JSON.stringify([...snapshots].map(([p, s]) => [p.slice(directory.length), s])) + leaseSignature(leases)),
    mode: hasParallel ? "orchestrated" : "solo",
    counts: { tasks: plan.rows.length, sequentialGroups: chains.length, active: active.size, selected: launch.length },
    action: attention.length ? "review" : launch.length ? "dispatch" : active.size ? "wait-or-verify" :
      plan.rows.every((r) => r.state === "VERIFIED") ? "verify-root" : "review",
    launch, promote: launch.filter((id) => plan.byId.get(id).state === "WAITING"),
    continuations: launch.filter((id) => chainPredecessor.has(id) || reportsOf(structureMeta).some((r) => r.parent === id && retiresExecution(r))).map((id) => {
      const handoff = reportsOf(structureMeta).filter((r) => r.parent === id && retiresExecution(r)).sort((a, b) => b.resolvedTurn - a.resolvedTurn)[0];
      if (handoff) return { leaf: id, after: id, handle: handoff.source.handle };
      const after = chainPredecessor.get(id);
      return { leaf: id, after, handle: lastStarts.get(after)?.handle || null };
    }),
    alreadyClaimed: launch.filter(ownLease),
    awaitVerification: [...returned].sort(compare), active: [...active].sort(compare), blocked: blockedCounts, attention,
  };
  if (structureMeta) result.handoffs = {
    turn: turnOf(structureMeta),
    pending: reportsOf(structureMeta).filter((r) => r.state === "pending").map((r) => ({
      id: r.id, parent: r.parent, returned: !!dispatchWaves[r.source.wave]?.returned["leaf-" + r.parent], leaseReleased: !ownLease(r.parent),
    })),
  };
  if (details) result.structure = {
    deferred: blocked,
    sequentialGroups: chains,
    forks: plan.rows.filter((r) => plan.successors.get(r.id).length > 1).map((r) => ({ after: r.id, children: plan.successors.get(r.id) })),
    joins: plan.rows.filter((r) => r.needs.length > 1).map((r) => ({ leaf: r.id, needs: r.needs })),
  };
  return result;
}
