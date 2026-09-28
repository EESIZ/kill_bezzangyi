#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { calculateStructure, loadStructure, clone } from "../scripts/lib/structure.mjs";
import { applyStructure, recoverStructure, materialize } from "../scripts/lib/structure-store.mjs";
import { verifyStructure, verifyTransition } from "../scripts/lib/structure-check.mjs";
import { schedule } from "../scripts/lib/schedule.mjs";
import { claimLeases, releaseLeases, sha256, parseGates, gateState } from "../scripts/lib/gates.mjs";
import { updateDispatch } from "../scripts/lib/dispatch.mjs";

const tests = [], test = (name, fn) => tests.push({ name, fn });
const access = () => ({ complete: true, reads: [], resourceReads: [], resourceWrites: [] });
const child = (id, owns) => ({ id, needs: [], tier: "mechanical", ledger: `OWNS: ${owns}\n- [ ] G1: child deliverable\n  EVIDENCE: pending\n`, access: access() });
const refinement = (parent = "A", prefix = "src/a", names = ["x", "y"]) => ({ retainsParentGates: true, children: names.map((n) => child(parent + "." + n, prefix + "/" + n + "/**")) });
function snapshot(dir) {
  return Object.fromEntries(readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ?
    Object.entries(snapshot(join(dir, e.name))).map(([k, v]) => [e.name + "/" + k, v]) : [[e.name, readFileSync(join(dir, e.name), "utf8")]]));
}
function clean(root) {
  const target = resolve(root), parent = resolve(tmpdir()) + sep;
  assert(target.startsWith(parent) && target.slice(parent.length).startsWith("kill-handoff-test-")); rmSync(target, { recursive: true, force: true });
}
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "kill-handoff-test-")), base = join(root, ".unlazy", "api");
  mkdirSync(join(base, "gates"), { recursive: true }); mkdirSync(join(root, "src", "a"), { recursive: true });
  const write = (file, text) => writeFileSync(join(base, file), text);
  write("PLAN.md", "Contract revision: 1\n| Leaf | Owns | Needs | Tier | Planned wave | State |\n|---|---|---|---|---|---|\n" +
    "| A | src/a/** | - | mechanical | 1 | IN-FLIGHT |\n| B | src/b/** | - | mechanical | 1 | IN-FLIGHT |\n| C | src/c/** | B | mechanical | 2 | WAITING |\n");
  write("ACCESS.json", JSON.stringify({ schema: 1, contractRevision: 1, leaves: { A: access(), B: access(), C: access() } }));
  write("gates/leaf-A.md", "OWNS: src/a/**\n- [x] G1: saved foundation\n  EVIDENCE: parent reviewed foundation\n- [ ] G2: remaining behavior\n  EVIDENCE: pending\n");
  for (const id of ["B", "C"]) write("gates/leaf-" + id + ".md", child(id, "src/" + id.toLowerCase() + "/**").ledger);
  write("GATES.md", "- [ ] ROOT: integrated scope\n  EVIDENCE: pending\n");
  writeFileSync(join(root, "src/a/draft.txt"), "saved foundation\n");
  const load = () => loadStructure(root, "api"), dispatch = (action, wave, opts = {}) => updateDispatch(root, { scope: "api", action, wave, ...opts });
  const setState = (id, state) => write("PLAN.md", readFileSync(join(base, "PLAN.md"), "utf8").split(/\r?\n/).map((l) =>
    l.startsWith("| " + id + " |") ? l.replace(/\| (READY|WAITING|IN-FLIGHT|VERIFIED) \|$/, "| " + state + " |") : l).join("\n"));
  const verify = (id) => {
    const text = readFileSync(join(base, "gates/leaf-" + id + ".md"), "utf8").replace(/- \[ \]/g, "- [x]").replace(/EVIDENCE: pending/g, "EVIDENCE: parent reviewed output");
    write("gates/leaf-" + id + ".md", text); setState(id, "VERIFIED");
  };
  const launch = async (wave, ids) => {
    await dispatch("open", wave, { leaves: ids.map((id) => "leaf-" + id) });
    for (const id of ids) { await dispatch("start", wave, { leaf: "leaf-" + id, handle: "host-" + wave + "-" + id }); setState(id, "IN-FLIGHT"); }
    await dispatch("seal", wave);
  };
  await launch("w1", ["A", "B"]);
  const event = (operation, extra = {}) => ({ schema: 1, operation, contractRevision: load().revision, refinements: {}, ...extra });
  const report = (id = "r1", parent = "A", wave = "w1", ref = refinement()) => {
    const row = load().rows.find((r) => r.id === parent), doc = parseGates(row.ledger);
    return event("report-" + id, { reports: [{ id, parent, source: { wave, handle: "host-" + wave + "-" + parent }, refinement: ref,
      checkpoint: { summary: "Saved existing work; remaining branches need independent implementation.",
        completed: doc.gates.filter((g) => gateState(g, doc.abandoned) === "met").map((g) => g.id),
        remaining: doc.gates.filter((g) => gateState(g, doc.abandoned) !== "met").map((g) => g.id),
        artifacts: parent === "A" ? [{ path: "src/a/draft.txt", sha256: sha256("saved foundation\n") }] : [] } }] });
  };
  const accept = (id = "r1") => event("accept-" + id, { acceptReports: [{ id, stopped: true, reviewed: true,
    stopEvidence: "Host confirmed this worker ended its turn and will not mutate until resumed.", reviewEvidence: "Parent inspected checkpoint and remaining obligations." }] });
  const apply = (request, faultAfter = null) => applyStructure({ root, scope: "api", request, faultAfter });
  return { root, base, write, load, dispatch, launch, setState, verify, event, report, accept, apply,
    returned: (id = "A", wave = "w1") => dispatch("return", wave, { leaf: "leaf-" + id }),
    claim: (id = "A") => claimLeases(root, { scope: "api", leaf: "leaf-" + id, globs: load().rows.find((r) => r.id === id).owns }),
    release: (id = "A") => releaseLeases(root, { scope: "api", leaf: "leaf-" + id }),
    recover: () => recoverStructure({ root, scope: "api" }),
    schedule: () => schedule({ root, scope: "api", slots: 4, details: true }),
  };
}
const using = (fn) => async () => { const f = await fixture(); try { await fn(f); } finally { clean(f.root); } };
const has = (check, code) => assert(check.errors.some((e) => e.code === code), JSON.stringify(check));

test("report is a persisted pending obligation, never task completion", using(async (f) => {
  const req = f.report(); await f.apply(req); const m = f.load();
  assert.equal(m.meta.turn, 1); assert.equal(m.meta.reports[0].state, "pending"); assert(m.active.has("A"));
  assert.equal(m.rows.length, 3); assert.equal(m.rows.find((r) => r.id === "A").state, "IN-FLIGHT");
  has(verifyStructure(m, null, true), "pending-refinement-report");
  const before = snapshot(f.root); assert.equal((await f.apply(req)).status, "already-applied"); assert.deepEqual(snapshot(f.root), before);
}));
test("report and acceptance cannot happen in the same logical turn", using(async (f) => {
  const req = f.report(); req.acceptReports = f.accept().acceptReports; const before = snapshot(f.base);
  await assert.rejects(f.apply(req), /later turn/); assert.deepEqual(snapshot(f.base), before);
}));
test("returned, stopped, reviewed and released are separate prerequisites", using(async (f) => {
  await f.claim(); await f.apply(f.report());
  await assert.rejects(f.apply(f.accept()), /must have returned/);
  await f.returned(); await assert.rejects(f.apply(f.accept()), /lease must be released/);
  await f.release();
  for (const field of ["stopped", "reviewed", "stopEvidence", "reviewEvidence"]) {
    const bad = f.accept(); bad.acceptReports[0][field] = false; await assert.rejects(f.apply(bad), /explicit stop/);
  }
  await f.apply(f.accept()); assert.equal(f.load().meta.turn, 2);
}));
test("next-turn split preserves source history, checkpoint and unrelated running work", using(async (f) => {
  await f.claim(); await f.claim("B"); await f.apply(f.report()); await f.returned(); await f.release();
  const dispatchBefore = readFileSync(join(f.base, "dispatch.json"), "utf8"); await f.apply(f.accept());
  const m = f.load(); assert.equal(readFileSync(join(f.base, "dispatch.json"), "utf8"), dispatchBefore);
  assert.equal(m.meta.reports[0].state, "applied"); assert(m.meta.reports[0].ledger.includes("[x] G1"));
  assert.equal(readFileSync(join(f.root, "src/a/draft.txt"), "utf8"), "saved foundation\n");
  assert(!m.active.has("A")); assert(m.active.has("B")); assert.deepEqual(f.schedule().launch, ["A.x", "A.y"]);
  assert(m.rows.find((r) => r.id === "A").gates.every((g) => g.state === "unmet"));
}));
test("accepted request retries are byte-identical and source-scoped", using(async (f) => {
  await f.apply(f.report()); await f.returned(); const req = f.accept();
  const results = await Promise.all([f.apply(req), f.apply(req)]); assert.deepEqual(results.map((r) => r.status).sort(), ["already-applied", "applied"]);
  const before = snapshot(f.root); await f.apply(req); assert.deepEqual(snapshot(f.root), before);
  const collision = clone(req); collision.acceptReports[0].reviewEvidence = "different"; await assert.rejects(f.apply(collision), /reused/);
}));
test("the integration parent can resume and its new attempt is active", using(async (f) => {
  await f.apply(f.report()); await f.returned(); await f.apply(f.accept());
  await f.launch("children", ["A.x", "A.y"]);
  for (const id of ["A.x", "A.y"]) { await f.returned(id, "children"); f.verify(id); }
  assert.deepEqual(f.schedule().launch, ["A"]);
  assert.deepEqual(f.schedule().continuations, [{ leaf: "A", after: "A", handle: "host-w1-A" }]);
  await f.launch("integration", ["A"]); assert(f.load().active.has("A")); assert(!f.schedule().launch.includes("A"));
  await f.returned("A", "integration"); assert(f.load().active.has("A")); assert(f.schedule().awaitVerification.includes("A"));
  f.verify("A"); assert(!f.load().active.has("A"));
}));
test("a running child can itself report a further split", using(async (f) => {
  await f.apply(f.report()); await f.returned(); await f.apply(f.accept()); await f.launch("children", ["A.x", "A.y"]);
  await f.apply(f.report("r2", "A.x", "children", refinement("A.x", "src/a/x")));
  await f.returned("A.x", "children"); await f.apply(f.accept("r2"));
  assert.deepEqual(f.schedule().launch, ["A.x.x", "A.x.y"]); assert(f.load().active.has("A.y")); assert(verifyStructure(f.load()).ok);
}));
test("an integration parent can hand off a second disjoint set of remaining tasks", using(async (f) => {
  await f.apply(f.report()); await f.returned(); await f.apply(f.accept());
  f.verify("A.x"); f.verify("A.y"); await f.launch("integration", ["A"]);
  await f.apply(f.report("r2", "A", "integration", refinement("A", "src/a", ["z", "w"])));
  await f.returned("A", "integration"); await f.apply(f.accept("r2"));
  assert.deepEqual(f.load().meta.splits.find((s) => s.parent === "A").children, ["A.w", "A.x", "A.y", "A.z"]);
  assert.deepEqual(f.schedule().launch, ["A.w", "A.z"]); assert(verifyStructure(f.load()).ok);
}));
test("unrelated dependency chain advances while a split report is pending", using(async (f) => {
  await f.apply(f.report()); await f.returned("B"); f.verify("B");
  assert.deepEqual(f.schedule().launch, ["C"]); assert.equal(f.schedule().handoffs.pending[0].id, "r1");
}));
test("explicit rejection keeps original work and does not retire a worker", using(async (f) => {
  await f.apply(f.report()); const req = f.event("reject-r1", { rejectReports: [{ id: "r1", reason: "Parent will finish the sequential work." }] });
  await f.apply(req); assert.equal(f.load().meta.reports[0].state, "rejected"); assert(f.load().active.has("A"));
  const before = snapshot(f.root); await f.apply(req); assert.deepEqual(snapshot(f.root), before);
  await assert.rejects(f.apply(f.accept()), /pending report/);
  await f.returned(); await f.apply(f.report("r2"));
  await f.apply(f.event("resume-r2", { resumeReports: f.accept("r2").acceptReports }));
  assert.deepEqual(f.schedule().launch, ["A"]);
}));
test("checkpoint coverage is exact and completed obligations require evidence", using(async (f) => {
  for (const change of [cp => cp.remaining = [], cp => cp.completed.push("G2"), cp => cp.remaining.push("unknown"), cp => { cp.completed = ["G2"]; cp.remaining = ["G1"]; }]) {
    const r = f.report(); change(r.reports[0].checkpoint); await assert.rejects(f.apply(r), /checkpoint|evidence/);
  }
}));
test("parent can resume original work instead of splitting without a stranded attempt", using(async (f) => {
  const r = f.report(); r.reports[0].refinement.children[1].needs = ["A.x"]; await f.apply(r); await f.returned();
  const req = f.event("resume-r1", { resumeReports: f.accept().acceptReports });
  await f.apply(req); assert.equal(f.load().meta.reports[0].state, "resumed"); assert.equal(f.load().rows.length, 3);
  assert.deepEqual(f.schedule().launch, ["A"]); assert.equal(f.schedule().continuations[0].handle, "host-w1-A");
  const before = snapshot(f.root); await f.apply(req); assert.deepEqual(snapshot(f.root), before);
  await f.launch("resumed", ["A"]); assert(f.load().active.has("A"));
  await f.apply(f.report("r2", "A", "resumed")); await f.returned("A", "resumed"); await f.apply(f.accept("r2"));
  assert.deepEqual(f.schedule().launch, ["A.x", "A.y"]);
}));
test("resume also requires confirmed return, review and lease release", using(async (f) => {
  await f.claim(); await f.apply(f.report()); const req = f.event("resume-r1", { resumeReports: f.accept().acceptReports });
  await assert.rejects(f.apply(req), /must have returned/); await f.returned(); await assert.rejects(f.apply(req), /lease must be released/);
  await f.release(); await assert.rejects(f.apply(req, 0), /injected/); await f.apply(req);
  assert.deepEqual(f.schedule().launch, ["A"]); assert.equal(f.load().meta.turn, 2);
}));
test("changed checkpoint artifacts cannot be silently redistributed", using(async (f) => {
  await f.apply(f.report()); await f.returned(); writeFileSync(join(f.root, "src/a/draft.txt"), "later worker edit\n");
  const before = snapshot(f.base); await assert.rejects(f.apply(f.accept()), /artifact changed/); assert.deepEqual(snapshot(f.base), before);
}));
test("different live attempt and source-handle mismatch reject acceptance", using(async (f) => {
  const wrong = f.report(); wrong.reports[0].source.handle = "wrong"; await assert.rejects(f.apply(wrong), /source/);
  await f.apply(f.report()); await f.returned(); await f.launch("duplicate", ["A"]);
  await assert.rejects(f.apply(f.accept()), /another execution attempt/);
}));
test("nonparallel proposals remain pending until explicit resolution", using(async (f) => {
  const req = f.report(); req.reports[0].refinement.children[1].needs = ["A.x"];
  await f.apply(req); await f.returned(); const before = snapshot(f.root);
  await assert.rejects(f.apply(f.accept()), /no independent/); assert.deepEqual(snapshot(f.root), before);
  assert.equal(f.load().meta.reports[0].state, "pending");
}));
test("checkpoint evidence and parent contract must still match at acceptance", using(async (f) => {
  await f.apply(f.report()); await f.returned(); const old = readFileSync(join(f.base, "gates/leaf-A.md"), "utf8");
  f.write("gates/leaf-A.md", old.replace("[x] G1", "[ ] G1")); await assert.rejects(f.apply(f.accept()), /current met evidence/);
  f.write("gates/leaf-A.md", old); const a = JSON.parse(readFileSync(join(f.base, "ACCESS.json"), "utf8"));
  a.leaves.A.reads = ["src/b/**"]; f.write("ACCESS.json", JSON.stringify(a)); await assert.rejects(f.apply(f.accept()), /contract changed/);
}));
test("multiple independent reports can be accepted together after both handoffs", using(async (f) => {
  const r = f.report(); r.reports.push(f.report("rB", "B", "w1", refinement("B", "src/b")).reports[0]);
  await f.apply(r); await f.returned(); await f.returned("B");
  const a = f.accept(); a.acceptReports.push(f.accept("rB").acceptReports[0]); await f.apply(a);
  assert.deepEqual(f.schedule().launch, ["A.x", "A.y", "B.x", "B.y"]);
  assert.equal(f.load().meta.reports.filter((q) => q.state === "applied").length, 2);
}));
test("a previously retired source cannot submit another report", using(async (f) => {
  await f.apply(f.report()); await f.returned(); await f.apply(f.accept());
  await assert.rejects(f.apply(f.report("r-again")), /current sealed execution attempt/);
}));
test("a report cannot be overwritten or resolved twice in one event", using(async (f) => {
  await f.apply(f.report()); await f.returned();
  const repeat = f.report(); repeat.operation = "new-report-op"; await assert.rejects(f.apply(repeat), /reused report/);
  const bad = f.accept(); bad.acceptReports.push(clone(bad.acceptReports[0])); await assert.rejects(f.apply(bad), /resolve one/);
  const override = f.accept(); override.refinements.A = refinement(); await assert.rejects(f.apply(override), /overridden/);
}));
test("every acceptance write boundary recovers without duplicate children or retirement", using(async (f) => {
  await f.apply(f.report()); await f.returned(); const req = f.accept();
  const count = Object.keys(materialize(f.load(), calculateStructure(f.load(), req))).length;
  for (let n = 0; n <= count; n++) {
    const g = await fixture(); try {
      await g.apply(g.report()); await g.returned(); const r = g.accept();
      await assert.rejects(g.apply(r, n), /injected/); assert.throws(g.schedule, /pending/);
      await g.recover(); assert.equal(g.load().meta.turn, 2); assert.equal(g.load().meta.reports.filter((q) => q.state === "applied").length, 1);
      assert.deepEqual(g.schedule().launch, ["A.x", "A.y"]); const before = snapshot(g.root);
      await g.apply(r); await g.recover(); assert.deepEqual(snapshot(g.root), before);
    } finally { clean(g.root); }
  }
}));
test("report interruption recovers its original logical turn", using(async (f) => {
  const req = f.report(); await assert.rejects(f.apply(req, 1), /injected/); await f.apply(req);
  assert.equal(f.load().meta.turn, 1); assert.equal(f.load().meta.reports.length, 1); assert.equal(f.load().rows.length, 3);
}));
test("checkpoint change during recovery is preserved and blocks roll-forward", using(async (f) => {
  await f.apply(f.report()); await f.returned(); await assert.rejects(f.apply(f.accept(), 0), /injected/);
  writeFileSync(join(f.root, "src/a/draft.txt"), "changed during recovery");
  const before = snapshot(f.root); await assert.rejects(f.recover(), /artifact changed/); assert.deepEqual(snapshot(f.root), before);
}));
test("independent checker rejects forged turns, lost children and retired attempt edits", using(async (f) => {
  await f.apply(f.report()); await f.returned(); await f.apply(f.accept());
  const m = f.load(); m.meta.reports[0].resolvedTurn = m.meta.reports[0].reportedTurn;
  has(verifyStructure(m), "resolution-turn-mismatch");
  m.meta.operations[0].turn = 2; has(verifyStructure(m), "invalid-operation-turn");
  m.meta.reports[0].returnedAt = "wrong"; has(verifyStructure(m), "unconfirmed-handoff");
  m.rows.find((r) => r.id === "A").needs = []; has(verifyStructure(m), "lost-reported-child");
}));
test("transition checker rejects deleting report history or unsafe retirement", using(async (f) => {
  await f.apply(f.report()); await f.returned(); const before = f.load(), after = calculateStructure(before, f.accept()).next;
  const removed = { ...after, meta: clone(after.meta) }; removed.meta.reports = []; has(verifyTransition(before, removed), "changed-handoff-history");
  before.leases.push({ scope: "api", leaf: "leaf-A", globs: ["src/a/**"] }); has(verifyTransition(before, after), "unsafe-handoff-boundary");
}));
test("independent checker detects worker-accounting omissions and false pending completion", using(async (f) => {
  await f.apply(f.report()); const m = f.load(); m.active.delete("A"); has(verifyStructure(m), "active-accounting-mismatch");
  m.rows.find((r) => r.id === "A").state = "VERIFIED"; has(verifyStructure(m), "pending-parent-verified");
}));
test("final success requires resumed parent integration and no pending reports", using(async (f) => {
  await f.apply(f.report()); await f.returned(); await f.apply(f.accept()); f.verify("A.x"); f.verify("A.y");
  has(verifyStructure(f.load(), null, true), "unfinished-task"); f.verify("A"); await f.returned("B"); f.verify("B"); f.verify("C");
  f.write("GATES.md", readFileSync(join(f.base, "GATES.md"), "utf8").replace("- [ ] ROOT", "- [x] ROOT").replace("EVIDENCE: pending", "EVIDENCE: parent reviewed integration"));
  assert(verifyStructure(f.load(), null, true).ok);
}));

let failed = 0;
for (const { name, fn } of tests) {
  try { await fn(); console.log("PASS " + name); }
  catch (error) { failed++; console.error("FAIL " + name + "\n" + error.stack); }
}
console.log(`handoff tests: ${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
