// Idempotent, roll-forward file application. No CHECK or agent execution.
import { unlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, scopeRoot, validateScopeId, withFileLock, writeAtomic, readLeases, parseGates, resolveTarget } from "./gates.mjs";
import { canonical, calculateStructure, demoteLedger, loadStructure, readInput, requireThat } from "./structure.mjs";
import { verifyStructure } from "./structure-check.mjs";
import { parsePlan } from "./schedule.mjs";
import { verifyArtifacts } from "./handoff.mjs";

const CHECKER = join(dirname(fileURLToPath(import.meta.url)), "..", "structure-check.mjs").replace(/\\/g, "/");
function rootLedger(text, root, scope) {
  const path = root.replace(/\\/g, "/");
  requireThat(!/["$`%!&|<>^\r\n]/.test(CHECKER + path), "path cannot be represented safely in a portable CHECK command");
  const check = 'node "' + CHECKER + '" --root "' + path + '" --scope ' + scope + ' --final';
  const old = parseGates(text).gates.find((g) => g.id === "S_STRUCTURE");
  if (old) requireThat(old.check === check && old.expect === "STRUCTURE_OK", "S_STRUCTURE is reserved; inspect and reconcile its existing command");
  return demoteLedger(text).trimEnd() + (old ? "\n" :
    '\n\n- [ ] S_STRUCTURE: All required work remains accounted for, integrated and settled\n  CHECK: ' + check + '\n  EXPECT: STRUCTURE_OK\n  EVIDENCE: pending\n');
}
function renderPlan(text, rows, revision, splits) {
  const lines = text.split(/\r?\n/);
  let fence = null;
  const live = lines.map((line) => {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (m) { if (!fence) fence = m[1]; else if (m[1][0] === fence[0] && m[1].length >= fence.length) fence = null; return false; }
    return !fence;
  });
  const start = lines.findIndex((l, i) => live[i] && /^\s*\|\s*Leaf\s*\|/.test(l));
  let end = start + 2;
  while (end < lines.length && /^\s*\|.*\|\s*$/.test(lines[end])) end++;
  let inventory = false;
  for (let i = 0; i < lines.length; i++) {
    if (!live[i]) continue;
    lines[i] = lines[i].replace(/^(Contract revision:\s*)[1-9]\d*/, "$1" + revision);
    if (/^## Current contract inventory\s*$/.test(lines[i])) inventory = true;
    else if (/^## /.test(lines[i])) inventory = false;
    if (inventory && /^\s*\|/.test(lines[i])) lines[i] = lines[i].replace(/\|\s*[1-9]\d*\s*\|\s*$/, "| " + revision + " |");
  }
  lines.splice(start + 2, end - start - 2, ...rows.map((r) =>
    `| ${r.id} | ${r.owns.join(", ")} | ${r.needs.join(", ") || "-"} | ${r.tier} | ${r.wave} | ${r.state} |`));
  const marker = "<!-- kill-bezzangyi:expanded-topology -->";
  const endMarker = "<!-- /kill-bezzangyi:expanded-topology -->";
  let output = lines.join("\n");
  if (output.includes(marker)) {
    const from = output.indexOf(marker), to = output.indexOf(endMarker, from);
    requireThat(to >= from && output.indexOf(marker, from + marker.length) < 0, "ambiguous managed topology block");
    output = output.slice(0, from) + output.slice(to + endMarker.length);
  }
  output = output.trimEnd();
  if (splits.length) output += "\n\n" + marker + "\n## Expanded topology\n\n" + splits.map((s) =>
    "- " + s.parent + " integrates " + s.children.join(", ") + "; parent ledger: gates/leaf-" + s.parent + ".md").join("\n") + "\n" + endMarker;
  return output + "\n";
}
export function materialize(model, calculation) {
  const next = calculation.next, revision = model.revision + 1;
  const after = {
    "PLAN.md": renderPlan(model.files["PLAN.md"], next.rows, revision, next.meta.splits),
    "ACCESS.json": JSON.stringify({ schema: 1, contractRevision: revision, leaves: Object.fromEntries(next.rows.map((r) =>
      [r.id, { complete: true, reads: r.reads, resourceReads: r.resourceReads, resourceWrites: r.resourceWrites }])) }, null, 2) + "\n",
    "GATES.md": rootLedger(model.files["GATES.md"], model.root, model.scope),
    "STRUCTURE.json": JSON.stringify(next.meta, null, 2) + "\n",
  };
  for (const row of next.rows) if (model.files["gates/leaf-" + row.id + ".md"] !== row.ledger) after["gates/leaf-" + row.id + ".md"] = row.ledger;
  for (const [name, text] of Object.entries(model.files)) if (/^gates\/node-.*\.md$/.test(name)) after[name] = demoteLedger(text);
  // Check the real serialized table before invalidating any existing evidence.
  const rendered = parsePlan(after["PLAN.md"]);
  const fields = (r) => [r.id, r.owns, r.needs, r.tier, r.wave, r.state];
  requireThat(rendered.revision === revision && canonical(rendered.rows.map(fields)) === canonical(next.rows.map(fields)), "rendered plan differs from verified calculation");
  requireThat(!parseGates(after["GATES.md"]).errors.length, "invalid generated structural Gate");
  for (const text of Object.values(after)) requireThat(Buffer.byteLength(text, "utf8") <= 8 * 1024 * 1024, "materialized state exceeds reader limit");
  return after;
}
const leasesNow = (root) => readLeases(root).map(({ scope, leaf, globs, invalid }) => ({ scope, leaf, globs, invalid: !!invalid }));
function validateJournal(journal) {
  requireThat(journal?.schema === 1 && journal.before && journal.after && journal.observed && typeof journal.operation === "string" && typeof journal.requestHash === "string", "invalid recovery journal");
  requireThat(journal.digest === sha256(canonical({ ...journal, digest: undefined })), "recovery journal digest mismatch");
  const keys = Object.keys(journal.after);
  requireThat(canonical(keys.sort()) === canonical(Object.keys(journal.before).sort()), "recovery file inventory mismatch");
  for (const key of keys) requireThat((/^(PLAN\.md|ACCESS\.json|GATES\.md|STRUCTURE\.json)$/.test(key) || /^gates\/(leaf|node)-[A-Za-z0-9._-]+\.md$/.test(key)) &&
    typeof journal.after[key] === "string" && (journal.before[key] === null || typeof journal.before[key] === "string"), "invalid recovery path/payload");
  requireThat(keys.includes("GATES.md") && keys.includes("STRUCTURE.json"), "incomplete recovery targets");
  for (const [key, value] of Object.entries(journal.observed)) requireThat(
    (/^(PLAN\.md|ACCESS\.json|GATES\.md|STRUCTURE\.json|dispatch\.json)$/.test(key) || /^gates\/(leaf|node)-[A-Za-z0-9._-]+\.md$/.test(key)) &&
    (value === null || typeof value === "string"), "invalid observed path/payload");
}
async function recoverLocked(root, scope, faultAfter = null) {
  const dir = scopeRoot(root, scope), path = join(dir, "STRUCTURE.pending.json"), text = readInput(root, path, true);
  if (text === null) return { status: "nothing-to-recover" };
  const j = JSON.parse(text); validateJournal(j);
  verifyArtifacts(root, j.artifactChecks || []);
  requireThat(canonical(leasesNow(root)) === canonical(j.leases), "leases changed during transaction; manual reconciliation required");
  requireThat(readInput(root, join(dir, "dispatch.json"), true) === j.dispatch, "dispatch changed during transaction; manual reconciliation required");
  for (const [name, before] of Object.entries(j.observed)) if (!Object.prototype.hasOwnProperty.call(j.after, name)) {
    requireThat(readInput(root, join(dir, name), true) === before, "untouched input changed during transaction: " + name);
  }
  const target = resolveTarget({ root, scope });
  requireThat(!target.error && !target.discoveryErrors?.length, "invalid recovery ledger discovery");
  const allowed = new Set([...Object.keys(j.observed), ...Object.keys(j.after)]);
  for (const file of target.files) requireThat(allowed.has(relative(dir, file).replace(/\\/g, "/")), "unexpected ledger during transaction");
  const entries = Object.entries(j.after).sort(([a], [b]) => a === "STRUCTURE.json" ? 1 : b === "STRUCTURE.json" ? -1 : a.localeCompare(b));
  for (const [name, after] of entries) {
    const current = readInput(root, join(dir, name), true);
    requireThat(current === j.before[name] || current === after, "recovery conflict; refusing to overwrite " + name);
  }
  let written = 0;
  for (const [name, after] of entries) {
    const current = readInput(root, join(dir, name), true);
    requireThat(current === j.before[name] || current === after, "recovery conflict; refusing to overwrite " + name);
    if (current !== after) writeAtomic(join(dir, name), after, { root });
    written++;
    if (faultAfter === written) throw new Error("injected interruption after write " + written);
  }
  const check = verifyStructure(loadStructure(root, scope, { allowPending: true }));
  requireThat(check.ok, "materialized structure failed verification: " + canonical(check.errors));
  unlinkSync(path);
  return { status: "applied", operation: j.operation };
}
export async function recoverStructure({ root, scope }) {
  root = resolve(root); requireThat(!validateScopeId(scope), "invalid scope");
  return withFileLock(root, join(scopeRoot(root, scope), "STRUCTURE.transaction"), () => recoverLocked(root, scope));
}
export async function applyStructure({ root, scope, request, faultAfter = null }) {
  root = resolve(root); requireThat(!validateScopeId(scope), "invalid scope");
  return withFileLock(root, join(scopeRoot(root, scope), "STRUCTURE.transaction"), async () => {
    const dir = scopeRoot(root, scope), pending = readInput(root, join(dir, "STRUCTURE.pending.json"), true);
    if (pending !== null) {
      const j = JSON.parse(pending); validateJournal(j);
      requireThat(j.operation === request.operation && j.requestHash === sha256(canonical(request)), "another operation needs recovery first");
      await recoverLocked(root, scope);
    }
    const model = loadStructure(root, scope), calc = calculateStructure(model, request);
    if (calc.alreadyApplied) return { status: "already-applied", operation: calc.operation };
    const after = materialize(model, calc);
    requireThat(loadStructure(root, scope).hash === model.hash, "scope changed while planning; recalculate");
    verifyArtifacts(root, calc.artifactChecks);
    const before = Object.fromEntries(Object.keys(after).map((name) => [name, model.files[name] ?? null]));
    const journal = { schema: 1, operation: calc.operation, requestHash: calc.requestHash, before, after,
      leases: model.leases, dispatch: model.files["dispatch.json"], observed: model.files, artifactChecks: calc.artifactChecks };
    journal.digest = sha256(canonical(journal));
    const journalText = JSON.stringify(journal, null, 2) + "\n";
    requireThat(Buffer.byteLength(journalText, "utf8") <= 8 * 1024 * 1024, "recovery journal exceeds reader limit");
    // First invalidate success. A crash before the journal then leaves an unmet
    // gate but no partially changed task graph, so a fresh retry is safe.
    writeAtomic(join(dir, "GATES.md"), after["GATES.md"], { root });
    writeAtomic(join(dir, "STRUCTURE.pending.json"), journalText, { root });
    if (faultAfter === 0) throw new Error("injected interruption after prepare");
    const result = await recoverLocked(root, scope, faultAfter);
    const actual = loadStructure(root, scope);
    requireThat(actual.rows.length === calc.next.rows.length, "post-apply inventory mismatch");
    return { ...result, turn: calc.next.meta.turn, actions: calc.actions, complexity: calc.complexity };
  });
}
