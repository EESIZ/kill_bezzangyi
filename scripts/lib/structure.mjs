import { basename, join, relative, resolve } from "node:path";
import { readStableRegularFile, resolveTarget, scopeRoot, parseGates, gateState, readLeases, sha256, normalizeOwnsGlob, validateScopeId } from "./gates.mjs";
import { parsePlan, conflicts } from "./schedule.mjs";
import { dispatchStatus } from "./dispatch.mjs";
import { verifyStructure, verifyTransition } from "./structure-check.mjs";
import { reportsOf, turnOf, gateDefinitions, attemptsFor, retiredAttempt, validateCheckpoint, verifyArtifacts, parentContract } from "./handoff.mjs";

export const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const canonical = (value) => JSON.stringify(sortObject(value));
function sortObject(v) {
  if (Array.isArray(v)) return v.map(sortObject);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort(cmp).map((k) => [k, sortObject(v[k])]));
  return v;
}
export const clone = (v) => JSON.parse(JSON.stringify(v));
export const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
export function assertStableStructure(model) {
  requireThat(loadStructure(model.root, model.scope).hash === model.hash, "inputs changed while checking; retry");
}
export function readInput(root, file, optional = false) {
  try { return readStableRegularFile(file, { root, label: "structure input", maxBytes: 8 * 1024 * 1024 }); }
  catch (e) { if (optional && e.code === "ENOENT") return null; throw e; }
}
export function demoteLedger(text) {
  const doc = parseGates(text);
  requireThat(!doc.errors.length, "invalid ledger while invalidating evidence");
  for (const gate of doc.gates) {
    doc.lines[gate.line] = doc.lines[gate.line].replace(/\[[xX]\]/, "[ ]");
    if (gate.evidenceLine >= 0) doc.lines[gate.evidenceLine] = "  EVIDENCE: pending";
  }
  return doc.lines.join(doc.eol);
}
export function loadStructure(root, scope, { allowPending = false } = {}) {
  root = resolve(root);
  requireThat(!validateScopeId(scope), "invalid scope");
  const dir = scopeRoot(root, scope);
  requireThat(allowPending || readInput(root, join(dir, "STRUCTURE.pending.json"), true) === null, "pending structure transaction: recover first");
  const files = {};
  const read = (name, optional = false) => { const v = readInput(root, join(dir, name), optional); files[name] = v; return v; };
  const plan = parsePlan(read("PLAN.md"));
  const access = JSON.parse(read("ACCESS.json"));
  requireThat(access.schema === 1 && access.contractRevision === plan.revision && access.leaves, "ACCESS revision/schema mismatch");
  requireThat(canonical(Object.keys(access.leaves).sort(cmp)) === canonical(plan.rows.map((r) => r.id).sort(cmp)), "ACCESS inventory mismatch");
  const target = resolveTarget({ root, scope });
  requireThat(!target.error && !target.discoveryErrors?.length, "invalid scope ledger discovery");
  for (const file of target.files) read(relative(dir, file).replace(/\\/g, "/"));
  requireThat(typeof files["GATES.md"] === "string", "root GATES.md required");
  const leafNames = Object.keys(files).filter((n) => /^gates\/leaf-.*\.md$/.test(n)).sort(cmp);
  requireThat(canonical(leafNames) === canonical(plan.rows.map((r) => "gates/leaf-" + r.id + ".md").sort(cmp)), "leaf inventory mismatch");
  const rows = plan.rows.map((r) => {
    const ledger = files["gates/leaf-" + r.id + ".md"], doc = parseGates(ledger);
    requireThat(!doc.errors.length, "invalid leaf ledger " + r.id);
    requireThat(canonical([...doc.owns].sort(cmp)) === canonical([...r.owns].sort(cmp)), "OWNS mirror mismatch " + r.id);
    const entry = validateAccess(access.leaves[r.id]);
    return { ...r, ...entry, ledger, gates: doc.gates.map((g) => ({ id: g.id, state: gateState(g, doc.abandoned) })) };
  });
  const otherGates = {};
  for (const [file, text] of Object.entries(files)) if (file.endsWith(".md") && file !== "PLAN.md" && !file.startsWith("gates/leaf-")) {
    const doc = parseGates(text); requireThat(!doc.errors.length, "invalid integration ledger " + file);
    otherGates[file] = doc.gates.map((g) => ({ id: g.id, state: gateState(g, doc.abandoned) }));
  }
  const dispatchText = read("dispatch.json", true), dispatch = dispatchStatus(root, scope);
  requireThat(!dispatch.errors.length, "invalid dispatch");
  const metaText = read("STRUCTURE.json", true), savedMeta = metaText === null ? null : JSON.parse(metaText);
  const dispatchWaves = dispatchText === null ? {} : JSON.parse(dispatchText).waves;
  const active = new Set(rows.filter((r) => r.state === "IN-FLIGHT").map((r) => r.id)), started = new Set(), declared = new Set();
  for (const [waveId, wave] of Object.entries(dispatchWaves)) for (const fullId of wave.leaves) {
    const id = fullId.slice(5);
    requireThat(fullId === "leaf-" + id && rows.some((r) => r.id === id), "orphan dispatch leaf");
    declared.add(id);
    if (wave.started[fullId]) {
      started.add(id);
      if ((!wave.returned[fullId] || rows.find((r) => r.id === id).state !== "VERIFIED") &&
          !retiredAttempt(savedMeta, waveId, id, wave.started[fullId], wave.returned[fullId])) active.add(id);
    }
  }
  const leases = readLeases(root).map(({ scope: s, leaf, globs, invalid }) => ({ scope: s, leaf, globs, invalid: !!invalid }));
  requireThat(!leases.some((l) => l.invalid), "invalid lease");
  for (const l of leases.filter((v) => v.scope === scope)) requireThat(rows.some((r) => "leaf-" + r.id === l.leaf), "orphan lease");
  const meta = metaText === null ? {
    schema: 1, initial: rows.map((r) => r.id), expected: rows.map((r) => r.id),
    requiredEdges: rows.flatMap((r) => r.needs.map((p) => [p, r.id])),
    requiredGates: Object.fromEntries(rows.map((r) => [r.id, r.gates.map((g) => g.id)])),
    requiredIntegrations: Object.fromEntries(Object.entries(otherGates).map(([file, gates]) => [file, gates.map((g) => g.id)])),
    splits: [], groups: rows.map((r) => [r.id]), operations: [], turn: 0, reports: [],
  } : savedMeta;
  return { root, scope, dir, files, rows, revision: plan.revision, access, meta, active, started, declared, leases, dispatch, dispatchWaves, otherGates,
    hash: sha256(canonical({ files, leases })) };
}
export function validateAccess(entry) {
  requireThat(entry && entry.complete === true, "complete access declaration required");
  const strings = (a) => Array.isArray(a) && a.every((s) => typeof s === "string" && s.trim() && !/[\x00-\x1f\x7f]/.test(s)) && new Set(a).size === a.length;
  requireThat(strings(entry.reads) && strings(entry.resourceReads) && strings(entry.resourceWrites), "invalid access sets");
  const reads = entry.reads.map((s) => { const n = normalizeOwnsGlob(s); requireThat(!n.error && !/[<>|]/.test(s), "invalid read path"); return n.value; });
  requireThat([...entry.resourceReads, ...entry.resourceWrites].every((s) => /^[a-z0-9][a-z0-9:._/-]*$/.test(s)), "invalid resource id");
  return { complete: true, reads, resourceReads: [...entry.resourceReads], resourceWrites: [...entry.resourceWrites] };
}

export function graph(rows) {
  const byId = new Map(rows.map((r) => [r.id, r])), left = new Map(rows.map((r) => [r.id, r.needs.length]));
  const out = new Map(rows.map((r) => [r.id, []]));
  for (const row of rows) for (const dep of row.needs) { requireThat(out.has(dep), "unknown dependency"); out.get(dep).push(row.id); }
  const order = rows.filter((r) => !r.needs.length).map((r) => r.id).sort(cmp), ancestors = new Map();
  for (let i = 0; i < order.length; i++) {
    const id = order[i], set = new Set();
    for (const dep of byId.get(id).needs) { set.add(dep); for (const a of ancestors.get(dep)) set.add(a); }
    ancestors.set(id, set);
    for (const to of out.get(id).sort(cmp)) { left.set(to, left.get(to) - 1); if (!left.get(to)) order.push(to); }
  }
  requireThat(order.length === rows.length, "dependency cycle");
  return { byId, out, order, ancestors };
}
const comparable = (g, a, b) => g.ancestors.get(a).has(b) || g.ancestors.get(b).has(a);
const sortedGroups = (groups) => groups.map((g) => [...g].sort(cmp)).sort((a, b) => cmp(a.join("\0"), b.join("\0")));
const contains = (pattern, value) => {
  const p = pattern.toLowerCase(), v = value.toLowerCase();
  return p === "**" || p === v || (p.endsWith("/**") && !/[*?[{]/.test(p.slice(0, -3)) && (v === p.slice(0, -3) || v.startsWith(p.slice(0, -2))));
};
function quotientAcyclic(rows, groups) {
  const owner = new Map(groups.flatMap((g, i) => g.map((id) => [id, String(i)])));
  const coarse = groups.map((_, i) => ({ id: String(i), needs: [] }));
  for (const row of rows) for (const dep of row.needs) if (owner.get(dep) !== owner.get(row.id)) coarse[Number(owner.get(row.id))].needs.push(owner.get(dep));
  for (const row of coarse) row.needs = [...new Set(row.needs)];
  try { graph(coarse); return true; } catch { return false; }
}

export function calculateStructure(model, request) {
  requireThat(request && request.schema === 1 && typeof request.operation === "string" && !validateScopeId(request.operation, "operation") &&
    request.refinements && typeof request.refinements === "object" && !Array.isArray(request.refinements), "invalid structure request");
  const requestHash = sha256(canonical(request));
  const originalCheck = verifyStructure(model);
  requireThat(originalCheck.ok, "base structure invalid: " + canonical(originalCheck.errors));
  const receipt = model.meta.operations.find((r) => r.id === request.operation);
  if (receipt) { requireThat(receipt.requestHash === requestHash, "operation id reused with different request"); return { alreadyApplied: true, requestHash, operation: request.operation }; }
  requireThat(request.contractRevision === model.revision, "stale request contractRevision");
  requireThat(!model.dispatch.abandoned.length && !Object.values(model.otherGates).some((gs) => gs.some((g) => g.state === "abandoned")) &&
    !model.rows.some((r) => r.state === "ABANDONED" || r.gates.some((g) => g.state === "abandoned")), "unresolved handoff");
  requireThat(!model.leases.some((l) => l.scope !== model.scope), "external lease requires review");
  requireThat(!model.dispatch.blocking.some((s) => s.includes(" open ")), "open launch wave: finish or review it first");
  const next = { ...model, rows: clone(model.rows), meta: clone(model.meta), active: new Set(model.active) }, actions = [], artifactChecks = [];
  next.meta.turn = turnOf(model.meta) + 1;
  requireThat(Number.isSafeInteger(next.meta.turn), "turn counter overflow");
  next.meta.reports = clone(reportsOf(model.meta));
  const acceptedParents = new Set(), acceptedRefinements = new Map();
  for (const name of ["reports", "acceptReports", "rejectReports", "resumeReports"]) requireThat(request[name] === undefined || Array.isArray(request[name]), "invalid " + name);
  for (const proposal of request.reports || []) {
    requireThat(proposal && typeof proposal.id === "string" && !validateScopeId(proposal.id) && !next.meta.reports.some((r) => r.id === proposal.id), "invalid or reused report id");
    const parent = next.rows.find((r) => r.id === proposal.parent);
    requireThat(parent && ["READY", "WAITING", "IN-FLIGHT"].includes(parent.state), "report requires unfinished parent");
    requireThat(!next.meta.reports.some((r) => r.parent === parent.id && r.state === "pending"), "parent already has a pending report");
    const source = attemptsFor(model.dispatchWaves, parent.id).find((a) => a.wave === proposal.source?.wave && a.handle === proposal.source?.handle);
    requireThat(source?.startAt && ["sealed", "complete"].includes(source.state) && !retiredAttempt(model.meta, source.wave, parent.id,
      { at: source.startAt, handle: source.handle }, source.returnedAt ? { at: source.returnedAt } : null), "report source must be a current sealed execution attempt");
    requireThat(proposal.refinement?.retainsParentGates === true && Array.isArray(proposal.refinement.children) && proposal.refinement.children.length >= 2, "report needs explicit refinement candidates");
    validateCheckpoint(parent, proposal.checkpoint); verifyArtifacts(model.root, proposal.checkpoint.artifacts);
    artifactChecks.push(...proposal.checkpoint.artifacts);
    next.meta.reports.push({ id: proposal.id, parent: parent.id, source: { wave: source.wave, handle: source.handle, startAt: source.startAt },
      checkpoint: clone(proposal.checkpoint), ledger: parent.ledger, contract: clone(parentContract(parent)), refinement: clone(proposal.refinement),
      reportedTurn: next.meta.turn, operation: request.operation, state: "pending" });
    actions.push({ action: "report", id: proposal.id, parent: parent.id });
  }
  const resolved = new Set();
  for (const [kind, resolutions] of [["applied", request.acceptReports || []], ["resumed", request.resumeReports || []], ["rejected", request.rejectReports || []]]) for (const resolution of resolutions) {
    const previous = reportsOf(model.meta).find((r) => r.id === resolution.id);
    requireThat(previous?.state === "pending" && !resolved.has(previous.id) && previous.reportedTurn < next.meta.turn, "resolve one existing pending report in a later turn");
    resolved.add(previous.id);
    const report = next.meta.reports.find((r) => r.id === previous.id);
    if (kind === "rejected") {
      requireThat(typeof resolution.reason === "string" && resolution.reason.trim(), "report rejection needs a reason");
      Object.assign(report, { state: kind, resolvedTurn: next.meta.turn, resolutionOperation: request.operation, reason: resolution.reason });
      actions.push({ action: "reject-report", id: report.id }); continue;
    }
    requireThat(resolution.stopped === true && resolution.reviewed === true &&
      typeof resolution.stopEvidence === "string" && resolution.stopEvidence.trim() &&
      typeof resolution.reviewEvidence === "string" && resolution.reviewEvidence.trim(), "explicit stop and parent review evidence required");
    const parent = next.rows.find((r) => r.id === report.parent), source = attemptsFor(model.dispatchWaves, report.parent).find((a) => a.wave === report.source.wave);
    requireThat(parent && ["READY", "WAITING", "IN-FLIGHT"].includes(parent.state) && source?.returnedAt &&
      source.handle === report.source.handle && source.startAt === report.source.startAt, "reported execution must have returned before handoff");
    requireThat(!model.leases.some((l) => l.scope === model.scope && l.leaf === "leaf-" + parent.id), "parent lease must be released before handoff");
    requireThat(attemptsFor(model.dispatchWaves, parent.id).every((a) => a.wave === source.wave ||
      retiredAttempt(model.meta, a.wave, parent.id, { at: a.startAt, handle: a.handle }, a.returnedAt ? { at: a.returnedAt } : null)), "another execution attempt needs reconciliation");
    requireThat(canonical(gateDefinitions(parent.ledger)) === canonical(gateDefinitions(report.ledger)), "parent Gate definitions changed since report");
    requireThat(canonical(parentContract(parent)) === canonical(report.contract), "parent contract changed since report");
    validateCheckpoint(parent, report.checkpoint); verifyArtifacts(model.root, report.checkpoint.artifacts); artifactChecks.push(...report.checkpoint.artifacts);
    requireThat(!Object.prototype.hasOwnProperty.call(request.refinements, parent.id), "reported refinement cannot be overridden");
    Object.assign(report, { state: kind, resolvedTurn: next.meta.turn, resolutionOperation: request.operation, returnedAt: source.returnedAt,
      stopped: true, reviewed: true, stopEvidence: resolution.stopEvidence, reviewEvidence: resolution.reviewEvidence });
    if (kind === "applied") { acceptedParents.add(parent.id); acceptedRefinements.set(parent.id, report.refinement); }
    next.active.delete(parent.id); parent.state = "WAITING";
    actions.push({ action: kind === "applied" ? "accept-report" : "resume-report", id: report.id, parent: parent.id });
  }
  const busy = (id) => next.active.has(id) || model.leases.some((l) => l.scope === model.scope && l.leaf === "leaf-" + id);
  function expand(parentId, refinement) {
    requireThat(refinement && Array.isArray(refinement.children) && refinement.children.length >= 2 && refinement.retainsParentGates === true, "refinement requires children and retained parent gates");
    const definitionHash = sha256(canonical(refinement));
    const prior = next.meta.splits.find((s) => s.parent === parentId);
    if (prior && !acceptedParents.has(parentId)) { requireThat(prior.definitionHash === definitionHash, "parent already expanded differently"); return; }
    const parent = next.rows.find((r) => r.id === parentId);
    requireThat(parent, "unknown refinement parent");
    requireThat(!next.meta.reports.some((r) => r.parent === parentId && r.state === "pending"), "pending report must be resolved first");
    requireThat(["READY", "WAITING"].includes(parent.state) && (!model.declared.has(parentId) || acceptedParents.has(parentId)) && !busy(parentId), "parent is not an unstarted safe boundary or accepted handoff");
    const oldGroup = next.meta.groups.find((g) => g.includes(parentId));
    requireThat(oldGroup && !oldGroup.some(busy), "parent group has active ownership");
    const children = refinement.children.map((c) => {
      requireThat(typeof c.id === "string" && c.id.startsWith(parentId + ".") && !validateScopeId(c.id) && !next.rows.some((r) => r.id === c.id), "invalid or reused child id");
      requireThat(Array.isArray(c.needs) && new Set(c.needs).size === c.needs.length && c.needs.every((id) => typeof id === "string" && id !== c.id && refinement.children.some((s) => s.id === id)), "child needs must reference siblings");
      requireThat(typeof c.ledger === "string", "child ledger required");
      const doc = parseGates(c.ledger);
      requireThat(!doc.errors.length && doc.owns.length && !doc.abandoned.size && doc.gates.every((g) => !g.checked), "invalid or pre-certified child ledger");
      const access = validateAccess(c.access);
      requireThat(doc.owns.every((p) => parent.owns.some((q) => contains(q, p))), "child writes escape parent ownership");
      requireThat(access.reads.every((p) => [...parent.owns, ...parent.reads].some((q) => contains(q, p))), "child reads escape parent declaration");
      requireThat(access.resourceWrites.every((r) => parent.resourceWrites.includes(r)) && access.resourceReads.every((r) => [...parent.resourceReads, ...parent.resourceWrites].includes(r)), "child resource access escapes parent declaration");
      requireThat(["mechanical", "judgment"].includes(c.tier), "child tier required");
      return { id: c.id, needs: [...c.needs], tier: c.tier, owns: doc.owns, ...access, ledger: c.ledger,
        gates: doc.gates.map((g) => ({ id: g.id, state: gateState(g, doc.abandoned) })), state: "WAITING", wave: 1 };
    });
    requireThat(new Set(children.map((c) => c.id)).size === children.length, "duplicate child id");
    const g = graph(children);
    requireThat(children.some((a, i) => children.slice(i + 1).some((b) => !comparable(g, a.id, b.id) && !conflicts(a, b))), "no independent child pair; keep sequential work together");
    for (const child of children) child.needs = [...new Set([...parent.needs, ...child.needs])].sort(cmp);
    next.meta.groups = next.meta.groups.filter((g) => g !== oldGroup).concat(oldGroup.map((id) => [id]), children.map((c) => [c.id]));
    parent.needs = [...new Set([...parent.needs, ...children.map((c) => c.id)])].sort(cmp);
    parent.state = "WAITING"; parent.ledger = demoteLedger(parent.ledger);
    parent.gates = parent.gates.map((v) => ({ ...v, state: "unmet" }));
    next.rows.push(...children);
    next.meta.expected.push(...children.map((c) => c.id));
    for (const c of children) next.meta.requiredGates[c.id] = c.gates.map((g) => g.id);
    if (prior) { prior.children.push(...children.map((c) => c.id)); prior.children.sort(cmp); prior.definitionHash = definitionHash; }
    else next.meta.splits.push({ parent: parentId, children: children.map((c) => c.id).sort(cmp), definitionHash });
    actions.push({ action: "expand", parent: parentId, children: children.map((c) => c.id).sort(cmp) });
    for (const child of [...refinement.children].sort((a, b) => cmp(a.id, b.id))) if (child.refinement) expand(child.id, child.refinement);
  }
  for (const id of Object.keys(request.refinements).sort(cmp)) expand(id, request.refinements[id]);
  for (const [id, refinement] of [...acceptedRefinements].sort(([a], [b]) => cmp(a, b))) expand(id, refinement);
  next.rows.sort((a, b) => cmp(a.id, b.id));
  const g = graph(next.rows);
  for (const id of g.order) {
    const row = g.byId.get(id);
    row.wave = 1 + Math.max(0, ...row.needs.map((p) => g.byId.get(p).wave));
    if (["READY", "WAITING"].includes(row.state)) row.state = row.needs.every((p) => g.byId.get(p).state === "VERIFIED" && !busy(p)) ? "READY" : "WAITING";
  }
  let groups = sortedGroups(next.meta.groups), changed = true;
  while (changed) {
    changed = false;
    outer: for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) {
      const merged = [...groups[a], ...groups[b]].sort(cmp);
      if (merged.some(busy)) continue;
      const unfinished = merged.filter((id) => g.byId.get(id).state !== "VERIFIED");
      if (unfinished.some((x, i) => unfinished.slice(i + 1).some((y) => !comparable(g, x, y)))) continue;
      const candidate = sortedGroups(groups.filter((_, i) => i !== a && i !== b).concat([merged]));
      if (!quotientAcyclic(next.rows, candidate)) continue;
      actions.push({ action: "group", members: merged }); groups = candidate; changed = true; break outer;
    }
  }
  next.meta.groups = groups;
  next.meta.expected.sort(cmp);
  next.meta.requiredEdges = next.rows.flatMap((r) => r.needs.map((p) => [p, r.id]));
  next.meta.operations.push({ id: request.operation, requestHash, turn: next.meta.turn });
  const check = verifyTransition(model, next);
  requireThat(check.ok, "calculated structure failed independent check: " + canonical(check.errors));
  const depth = (id) => { const s = next.meta.splits.find((v) => v.parent === id); return s ? 1 + Math.max(...s.children.map(depth)) : 0; };
  const owner = new Map(groups.flatMap((gr, i) => gr.map((id) => [id, i]))), edges = new Set();
  for (const r of next.rows) for (const p of r.needs) if (owner.get(p) !== owner.get(r.id)) edges.add(owner.get(p) + ":" + owner.get(r.id));
  return { alreadyApplied: false, requestHash, operation: request.operation, baseHash: model.hash, next, actions, check, artifactChecks,
    complexity: { groups: groups.length, boundaryEdges: edges.size, depth: Math.max(...next.meta.initial.map(depth)) } };
}
