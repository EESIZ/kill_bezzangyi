#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assertStableStructure, calculateStructure, loadStructure, canonical, clone } from "../scripts/lib/structure.mjs";
import { applyStructure, recoverStructure, materialize } from "../scripts/lib/structure-store.mjs";
import { verifyStructure, verifyTransition } from "../scripts/lib/structure-check.mjs";
import { schedule } from "../scripts/lib/schedule.mjs";
import { claimLeases, releaseLeases } from "../scripts/lib/gates.mjs";

const scripts = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts");
const tests = [], test = (name, fn) => tests.push({ name, fn });
const access = () => ({ complete: true, reads: ["contracts/**"], resourceReads: [], resourceWrites: [] });
const ledger = (owns, met = false) => `OWNS: ${owns}\n- [${met ? "x" : " "}] G1: complete deliverable\n  EVIDENCE: ${met ? "parent reviewed output" : "pending"}\n`;
const child = (id, owns) => ({ id, needs: [], tier: "mechanical", ledger: ledger(owns), access: access() });
const request = (operation = "split-1", revision = 1) => ({ schema: 1, operation, contractRevision: revision,
  refinements: { A: { retainsParentGates: true, children: [child("A.1", "src/a/**"), child("A.2", "src/b/**")] } } });
const event = (operation, revision) => ({ schema: 1, operation, contractRevision: revision, refinements: {} });
function snapshot(dir) {
  const result = {};
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) for (const [k, v] of Object.entries(snapshot(join(dir, e.name)))) result[e.name + "/" + k] = v;
    else result[e.name] = readFileSync(join(dir, e.name), "utf8");
  }
  return result;
}
function clean(root) {
  const target = resolve(root), parent = resolve(tmpdir()) + sep;
  assert(target.startsWith(parent) && target.slice(parent.length).startsWith("kill-structure-test-"));
  rmSync(target, { recursive: true, force: true });
}
function fixture(extra = []) {
  const root = mkdtempSync(join(tmpdir(), "kill-structure-test-")), base = join(root, ".unlazy", "api");
  mkdirSync(join(base, "gates"), { recursive: true });
  const rows = [{ id: "A", needs: [], owns: "src/**", wave: 1 }, ...extra];
  const write = (name, text) => writeFileSync(join(base, name), text);
  write("PLAN.md", "# Plan\nContract revision: 1.\n| Leaf | Owns | Needs | Tier | Planned wave | State |\n|---|---|---|---|---|---|\n" +
    rows.map((r) => `| ${r.id} | ${r.owns} | ${r.needs.join(", ") || "-"} | mechanical | ${r.wave} | ${r.needs.length ? "WAITING" : "READY"} |`).join("\n") + "\n");
  write("ACCESS.json", JSON.stringify({ schema: 1, contractRevision: 1, leaves: Object.fromEntries(rows.map((r) => [r.id, access()])) }));
  for (const r of rows) write("gates/leaf-" + r.id + ".md", ledger(r.owns));
  write("GATES.md", "- [x] ROOT: integrated output\n  EVIDENCE: prior parent review\n");
  const load = () => loadStructure(root, "api");
  const apply = (req = request(), opts = {}) => applyStructure({ root, scope: "api", request: req, ...opts });
  const recover = () => recoverStructure({ root, scope: "api" });
  const run = (file, args = [], opts = {}) => spawnSync(process.execPath, [join(scripts, file), ...args], { cwd: root, encoding: "utf8", ...opts });
  const verify = (id) => {
    const row = load().rows.find((r) => r.id === id);
    write("gates/leaf-" + id + ".md", ledger(row.owns.join(", "), true));
    write("PLAN.md", readFileSync(join(base, "PLAN.md"), "utf8").split(/\r?\n/).map((l) =>
      l.startsWith("| " + id + " |") ? l.replace(/\| (READY|WAITING|IN-FLIGHT) \|$/, "| VERIFIED |") : l).join("\n"));
  };
  return { root, base, write, load, apply, recover, run, verify, schedule: () => schedule({ root, scope: "api", slots: 4, details: true }) };
}
const using = (fn, extra = []) => async () => { const f = fixture(extra); try { await fn(f); } finally { clean(f.root); } };
const has = (result, code) => assert(result.errors.some((e) => e.code === code), JSON.stringify(result));

test("planning is deterministic and read-only", using((f) => {
  const before = snapshot(f.root), a = calculateStructure(f.load(), request()), b = calculateStructure(f.load(), request());
  assert.equal(canonical(a), canonical(b)); assert(a.check.ok); assert.deepEqual(snapshot(f.root), before);
  assert.equal(a.next.rows.find((r) => r.id === "A").ledger, f.load().rows[0].ledger);
  assert.equal(a.complexity.depth, 1);
}));
test("nested independent children retain both integration parents", using(async (f) => {
  const req = request(); req.refinements.A.children[0].refinement = { retainsParentGates: true,
    children: [child("A.1.x", "src/a/x/**"), child("A.1.y", "src/a/y/**")] };
  const result = await f.apply(req); assert.equal(result.complexity.depth, 2);
  const m = f.load(); assert.equal(m.rows.length, 5); assert(verifyStructure(m).ok);
  assert.deepEqual(f.schedule().launch, ["A.1.x", "A.1.y", "A.2"]);
  f.verify("A.1.x"); f.verify("A.1.y"); assert.deepEqual(f.schedule().launch, ["A.1", "A.2"]);
  f.verify("A.1"); f.verify("A.2"); assert.deepEqual(f.schedule().launch, ["A"]);
}));
test("same operation twice makes no durable changes", using(async (f) => {
  assert.equal((await f.apply()).status, "applied"); const before = snapshot(f.root);
  assert.equal((await f.apply()).status, "already-applied"); assert.deepEqual(snapshot(f.root), before);
}));
test("concurrent duplicate request creates children once", using(async (f) => {
  const results = await Promise.all([f.apply(), f.apply()]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["already-applied", "applied"]);
  assert.equal(f.load().rows.length, 3);
}));
test("operation collision and stale contract reject without writes", using(async (f) => {
  await f.apply(); const before = snapshot(f.root), bad = request(); bad.refinements = {};
  await assert.rejects(f.apply(bad), /reused with different/);
  await assert.rejects(f.apply(event("new-event", 1)), /stale/); assert.deepEqual(snapshot(f.root), before);
}));
test("sequential, unsafe and underspecified splits reject", using((f) => {
  const cases = [
    [r => r.refinements.A.children[1].needs.push("A.1"), /no independent/],
    [r => r.refinements.A.children[0].ledger = ledger("outside/**"), /escape/],
    [r => r.refinements.A.children[0].access.complete = false, /complete access/],
    [r => r.refinements.A.children[0].access.reads.push("outside/**"), /escape/],
    [r => r.refinements.A.children[0].access.resourceWrites.push("db:prod"), /escapes/],
    [r => r.refinements.A.children[0].ledger = ledger("src/a/**", true), /pre-certified/],
    [r => r.refinements.A.children[1].id = "A.1", /duplicate child/],
    [r => r.refinements.A.retainsParentGates = false, /retained parent/],
  ];
  for (const [change, pattern] of cases) { const r = request(); change(r); assert.throws(() => calculateStructure(f.load(), r), pattern); }
}));
test("leased parent cannot be split", using(async (f) => {
  await claimLeases(f.root, { scope: "api", leaf: "leaf-A", globs: ["src/**"] });
  await assert.rejects(f.apply(), /safe boundary/);
  await releaseLeases(f.root, { scope: "api", leaf: "leaf-A" });
}));
test("abandoned integration cannot silently resume as success", using(async (f) => {
  f.write("GATES.md", "- [ ] ROOT: integrated output\n  EVIDENCE: pending\nABANDON: ROOT needs a revised contract\n");
  const before = snapshot(f.base); await assert.rejects(f.apply(), /unresolved handoff/); assert.deepEqual(snapshot(f.base), before);
}));
test("unrenderable child ownership is rejected before state writes", using(async (f) => {
  const r = request(); r.refinements.A.children[0].ledger = ledger("src/a/pipe|name/**");
  const before = snapshot(f.base); await assert.rejects(f.apply(r), /PLAN row|invalid or/); assert.deepEqual(snapshot(f.base), before);
}));
test("declared or running parents cannot be split", using((f) => {
  const m = f.load(); m.declared.add("A"); assert.throws(() => calculateStructure(m, request()), /safe boundary/);
  m.declared.clear(); m.active.add("A"); assert.throws(() => calculateStructure(m, request()), /safe boundary|active-accounting-mismatch/);
}));
test("coarsening reaches a stable partition without erasing gates", using(async (f) => {
  const a = await f.apply(event("seed", 1)); assert.equal(a.complexity.groups, 1);
  const before = f.load().meta.groups;
  const b = await f.apply(event("event-2", 2)); assert.deepEqual(f.load().meta.groups, before); assert.deepEqual(b.actions, []);
  assert.equal(f.load().rows.length, 3);
}, [{ id: "B", needs: ["A"], owns: "b/**", wave: 2 }, { id: "C", needs: ["B"], owns: "c/**", wave: 3 }]));
test("after a join, a later task can split again", using(async (f) => {
  await f.apply(); f.verify("A.1"); f.verify("A.2"); f.verify("A");
  const r = request("later", 2); r.refinements = { B: { retainsParentGates: true, children: [child("B.1", "b/x/**"), child("B.2", "b/y/**")] } };
  await f.apply(r); assert.deepEqual(f.schedule().launch, ["B.1", "B.2"]);
}, [{ id: "B", needs: ["A"], owns: "b/**", wave: 2 }]));
test("a child can split in a later event before it starts", using(async (f) => {
  await f.apply(); const r = event("deeper", 2);
  r.refinements["A.1"] = { retainsParentGates: true, children: [child("A.1.x", "src/a/x/**"), child("A.1.y", "src/a/y/**")] };
  await f.apply(r); assert.deepEqual(f.schedule().launch, ["A.1.x", "A.1.y", "A.2"]);
}));
test("independent verifier detects omissions, duplicate assignments and edges", using((f) => {
  const next = calculateStructure(f.load(), request()).next;
  const a = { ...next, rows: next.rows.filter((r) => r.id !== "A.1") }; has(verifyStructure(a), "task-conservation");
  const b = { ...next, meta: clone(next.meta) }; b.meta.groups.push(["A.1"]); has(verifyStructure(b), "duplicate-assignment");
  const c = { ...next, rows: clone(next.rows) }; c.rows.find((r) => r.id === "A").needs = []; has(verifyStructure(c), "orphan-child"); has(verifyStructure(c), "lost-edge");
  const d = { ...next, meta: clone(next.meta) }; d.meta.groups = [next.rows.map((r) => r.id)]; has(verifyStructure(d), "lost-parallelism");
}));
test("transition checker compares original gates and access", using((f) => {
  const before = f.load(), after = calculateStructure(before, request()).next;
  const parent = after.rows.find((r) => r.id === "A"); parent.ledger = parent.ledger.replace("complete deliverable", "weaker deliverable");
  parent.reads = []; const check = verifyTransition(before, after); has(check, "changed-original-gates"); has(check, "changed-original-access");
}));
test("quotient cycles are rejected even for comparable groups", using((f) => {
  const m = f.load(); m.meta.groups = [["A", "C"], ["B"]]; has(verifyStructure(m), "group-cycle");
}, [{ id: "B", needs: ["A"], owns: "b/**", wave: 2 }, { id: "C", needs: ["B"], owns: "c/**", wave: 3 }]));
test("selection checker detects capacity, dependency and resource conflicts", using(async (f) => {
  await f.apply(); let m = f.load(); assert(verifyStructure(m, { launch: ["A.1", "A.2"], slots: 2 }).ok);
  has(verifyStructure(m, { launch: ["A.1", "A.2"], slots: 1 }), "capacity-exceeded");
  has(verifyStructure(m, { launch: ["A"], slots: 2 }), "not-ready");
  m.rows.find((r) => r.id === "A.1").resourceWrites = ["db:test"];
  m.rows.find((r) => r.id === "A.2").resourceReads = ["db:test"];
  has(verifyStructure(m, { launch: ["A.1", "A.2"], slots: 2 }), "parallel-conflict");
}));
test("every partial write recovers and repeated recovery is inert", using(async (f) => {
  const count = Object.keys(materialize(f.load(), calculateStructure(f.load(), request()))).length;
  for (let n = 0; n <= count; n++) {
    const g = fixture(); try {
      await assert.rejects(g.apply(request(), { faultAfter: n }), /injected interruption/);
      assert(existsSync(join(g.base, "STRUCTURE.pending.json")));
      assert.throws(g.load, /pending/); assert.throws(g.schedule, /pending/);
      assert.equal((await g.recover()).status, "applied"); assert(verifyStructure(g.load()).ok); assert.equal(g.load().rows.length, 3);
      const before = snapshot(g.root); assert.equal((await g.recover()).status, "nothing-to-recover");
      assert.equal((await g.apply()).status, "already-applied"); assert.deepEqual(snapshot(g.root), before);
    } finally { clean(g.root); }
  }
}));
test("same apply request automatically resumes a prepared transaction", using(async (f) => {
  await assert.rejects(f.apply(request(), { faultAfter: 2 }), /injected/);
  assert.equal((await f.apply()).status, "already-applied"); assert.equal(f.load().rows.length, 3);
}));
test("unknown edits during recovery are preserved", using(async (f) => {
  await assert.rejects(f.apply(request(), { faultAfter: 0 }), /injected/);
  const edited = readFileSync(join(f.base, "PLAN.md"), "utf8") + "\nUser edited here\n"; f.write("PLAN.md", edited);
  await assert.rejects(f.recover(), /refusing to overwrite/); assert.equal(readFileSync(join(f.base, "PLAN.md"), "utf8"), edited);
}));
test("recovery also protects files outside its write set", using(async (f) => {
  await assert.rejects(f.apply(request(), { faultAfter: 0 }), /injected/);
  const edited = ledger("src/**").replace("complete deliverable", "changed acceptance");
  f.write("gates/leaf-A.md", edited);
  await assert.rejects(f.recover(), /untouched input changed/);
  assert.equal(readFileSync(join(f.base, "gates/leaf-A.md"), "utf8"), edited);
}));
test("a newly introduced ledger and changed dispatch interrupt recovery", using(async (f) => {
  await assert.rejects(f.apply(request(), { faultAfter: 0 }), /injected/);
  f.write("dispatch.json", "{}"); await assert.rejects(f.recover(), /dispatch changed/);
  rmSync(join(f.base, "dispatch.json")); f.write("gates/node-extra.md", "- [ ] X: new integration\n");
  await assert.rejects(f.recover(), /unexpected ledger/);
}));
test("lease changes during recovery and competing operations fail closed", using(async (f) => {
  await assert.rejects(f.apply(request(), { faultAfter: 0 }), /injected/);
  await assert.rejects(f.apply(event("different", 1)), /another operation/);
  await claimLeases(f.root, { scope: "api", leaf: "leaf-A", globs: ["src/**"] });
  await assert.rejects(f.recover(), /leases changed/);
  await releaseLeases(f.root, { scope: "api", leaf: "leaf-A" }); await f.recover();
}));
test("journal digest tampering cannot trigger recovery writes", using(async (f) => {
  await assert.rejects(f.apply(request(), { faultAfter: 0 }), /injected/);
  const j = JSON.parse(readFileSync(join(f.base, "STRUCTURE.pending.json"))); j.after["PLAN.md"] = "bad";
  f.write("STRUCTURE.pending.json", JSON.stringify(j)); const before = snapshot(f.root);
  await assert.rejects(f.recover(), /digest mismatch/); assert.deepEqual(snapshot(f.root), before);
}));
test("root and branch evidence are invalidated without dropping gates", using(async (f) => {
  f.write("gates/node-root.md", "- [x] INTEGRATE: combined behavior\n  EVIDENCE: prior review\n");
  await f.apply(); const m = f.load(); assert.equal(m.otherGates["GATES.md"].length, 2);
  assert(m.otherGates["GATES.md"].every((g) => g.state !== "met"));
  assert.equal(m.otherGates["gates/node-root.md"][0].state, "unmet");
}));
test("false parent completion and stale evidence are never final", using(async (f) => {
  await f.apply(); f.verify("A"); let m = f.load(); has(verifyStructure(m), "premature-verification");
  f.write("gates/leaf-A.md", ledger("src/**")); m = f.load(); has(verifyStructure(m), "stale-verification");
  assert(!verifyStructure(m, null, true).ok); assert.throws(f.schedule, /structure verification/);
}));
test("final checker rejects unfinished integration, abandonment and leases", using(async (f) => {
  await f.apply(); f.verify("A.1"); f.verify("A.2"); f.verify("A");
  let m = f.load(); has(verifyStructure(m, null, true), "unfinished-integration");
  m.otherGates["GATES.md"][0].state = "met"; assert(verifyStructure(m, null, true).ok);
  m.dispatch.abandoned.push("handoff"); has(verifyStructure(m, null, true), "unfinished-dispatch");
  m.leases.push({ scope: "api", leaf: "leaf-A", globs: ["src/**"] }); has(verifyStructure(m, null, true), "remaining-leases");
}));
test("registry and structural Gate removals fail closed", using(async (f) => {
  await f.apply(); const m = f.load(); m.meta.expected = m.meta.expected.filter((id) => id !== "A.2");
  f.write("STRUCTURE.json", JSON.stringify(m.meta)); assert.throws(f.schedule, /structure verification/);
  f.write("STRUCTURE.json", m.files["STRUCTURE.json"]); f.write("GATES.md", "- [ ] ROOT: integrated output\n  EVIDENCE: pending\n");
  has(verifyStructure(f.load()), "missing-structure-gate");
  assert.throws(f.schedule, /structure verification/);
}));
test("missing registry stops scheduling and changed input invalidates snapshot", using(async (f) => {
  await f.apply(); const model = f.load();
  f.write("gates/leaf-A.md", ledger("src/**") + "\nA new note\n");
  assert.throws(() => assertStableStructure(model), /inputs changed/);
  rmSync(join(f.base, "STRUCTURE.json")); assert.throws(f.schedule, /registry missing/);
}));
test("group reuse retains predecessor identity after child verification", using(async (f) => {
  await f.apply(); f.verify("A.1"); f.verify("A.2"); await f.apply(event("join-ready", 2));
  const r = f.schedule(); assert.deepEqual(r.launch, ["A"]);
  assert.equal(r.continuations[0].leaf, "A"); assert(["A.1", "A.2"].includes(r.continuations[0].after));
  assert.equal(r.continuations[0].handle, null);
}));
test("all four-node forward DAGs and valid completion prefixes preserve invariants", using((f) => {
  const base = f.load(), pairs = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
  for (let edges = 0; edges < 64; edges++) for (let done = 0; done < 16; done++) {
    const rows = Array.from({ length: 4 }, (_, i) => ({ ...clone(base.rows[0]), id: String(i), owns: [`src/${i}/**`], needs: [],
      state: done & (1 << i) ? "VERIFIED" : "WAITING", wave: i + 1, ledger: ledger(`src/${i}/**`, !!(done & (1 << i))),
      gates: [{ id: "G1", state: done & (1 << i) ? "met" : "unmet" }] }));
    pairs.forEach(([a,b], bit) => { if (edges & (1 << bit)) rows[b].needs.push(String(a)); });
    if (rows.some((r) => r.state === "VERIFIED" && r.needs.some((p) => rows[Number(p)].state !== "VERIFIED"))) continue;
    const meta = { ...clone(base.meta), initial: rows.map((r) => r.id), expected: rows.map((r) => r.id),
      groups: rows.map((r) => [r.id]), requiredGates: Object.fromEntries(rows.map((r) => [r.id, ["G1"]])),
      requiredEdges: rows.flatMap((r) => r.needs.map((p) => [p, r.id])) };
    const m = { ...base, rows, meta }, a = calculateStructure(m, event("small-graph", 1));
    assert(verifyTransition(m, a.next).ok);
    const b = calculateStructure(a.next, event("fixed-point", 1)); assert.deepEqual(b.next.meta.groups, a.next.meta.groups);
  }
}));
test("fenced examples and user notes survive rendering and later events", using(async (f) => {
  const example = "```text\nContract revision: 99\n| Leaf | Owns | Needs | Tier | Planned wave | State |\n|---|---|---|---|---|---|\n| A | example/** | - | judgment | 1 | READY |\n```\n";
  f.write("PLAN.md", example + readFileSync(join(f.base, "PLAN.md"), "utf8"));
  await f.apply(); f.write("PLAN.md", readFileSync(join(f.base, "PLAN.md"), "utf8") + "\nUser notes after topology\n");
  await f.apply(event("regroup", 2)); const text = readFileSync(join(f.base, "PLAN.md"), "utf8");
  assert(text.startsWith(example)); assert(text.includes("User notes after topology")); assert.equal(f.load().rows[0].tier, "mechanical");
}));
test("CLI plan and check are read-only and reject malformed arguments", using(async (f) => {
  f.write("request.json", JSON.stringify(request())); const before = snapshot(f.root);
  const args = ["--scope", "api", "--request", ".unlazy/api/request.json"];
  const planned = f.run("structure.mjs", ["plan", ...args]); assert.equal(planned.status, 0, planned.stdout + planned.stderr);
  assert.equal(JSON.parse(planned.stdout).actions.expanded, 1);
  assert.deepEqual(snapshot(f.root), before); await f.apply(); const after = snapshot(f.root);
  const check = f.run("structure-check.mjs", ["--scope", "api"]); assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.deepEqual(snapshot(f.root), after);
  assert.equal(f.run("structure-check.mjs", ["--scope", "api", "--final"]).status, 1);
  assert.equal(f.run("structure.mjs", ["plan", "--unknown"]).status, 2);
}));
test("existing Stop hook blocks until the structural Gate is reverified", using(async (f) => {
  await f.apply();
  const hook = () => f.run("stop-hook.mjs", ["--scope", "api"], { input: JSON.stringify({ cwd: f.root, session_id: "structure-test" }) });
  assert.equal(JSON.parse(hook().stdout).decision, "block");
  f.verify("A.1"); f.verify("A.2"); f.verify("A");
  f.write("GATES.md", readFileSync(join(f.base, "GATES.md"), "utf8").replace("- [ ] ROOT", "- [x] ROOT").replace("EVIDENCE: pending", "EVIDENCE: parent reviewed integrated output"));
  assert(verifyStructure(f.load(), null, true).ok);
  const approval = mkdtempSync(join(tmpdir(), "kill-structure-test-approval-"));
  try {
    const checked = f.run("gate-check.mjs", ["--root", f.root, "--approve", "--reverify", join(f.base, "GATES.md")], {
      env: { ...process.env, UNLAZY_APPROVAL_DIR: approval },
    });
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    const ended = hook(); assert.equal(ended.status, 0); assert(!ended.stdout.includes('"decision":"block"'), ended.stdout);
  } finally { clean(approval); }
}));

let failed = 0;
for (const { name, fn } of tests) {
  try { await fn(); console.log("PASS " + name); }
  catch (error) { failed++; console.error("FAIL " + name + "\n" + error.stack); }
}
console.log(`structure tests: ${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
