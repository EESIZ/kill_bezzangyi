#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parsePlan, schedule } from "../scripts/lib/schedule.mjs";
import { claimLeases, releaseLeases, gateDefinitionDigest, automaticEvidencePrefix } from "../scripts/lib/gates.mjs";
import { updateDispatch } from "../scripts/lib/dispatch.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "../scripts/schedule.mjs");
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const leaf = (id, needs = [], extra = {}) => ({ id, needs, wave: Number(id), state: needs.length ? "WAITING" : "READY", owns: ["src/" + id + "/**"], ...extra });

function fixture(rows) {
  const root = mkdtempSync(join(tmpdir(), "kill-schedule-test-"));
  const base = join(root, ".unlazy", "api");
  mkdirSync(join(base, "gates"), { recursive: true });
  const access = { schema: 1, contractRevision: 1, leaves: {} };
  for (const r of rows) access.leaves[r.id] = { complete: true, reads: ["contracts/**"], resourceReads: [], resourceWrites: [] };
  const write = (name, text) => writeFileSync(join(base, name), text);
  const savePlan = () => write("PLAN.md", "# Plan\nContract revision: 1.\n" +
    "| Leaf | Owns | Needs | Tier | Planned wave | State |\n|---|---|---|---|---|---|\n" +
    rows.map((r) => `| ${r.id} | ${r.owns.join(", ")} | ${r.needs.join(", ") || "-"} | mechanical | ${r.wave} | ${r.state} |`).join("\n") + "\n");
  const saveAccess = () => write("ACCESS.json", JSON.stringify(access));
  const ledger = (id, met) => write("gates/leaf-" + id + ".md", "OWNS: " + rows.find((r) => r.id === id).owns.join(", ") +
    `\n\n- [${met ? "x" : " "}] G1: review deliverable\n  EVIDENCE: ${met ? "parent reviewed the artifact" : "pending"}\n`);
  const verify = (id) => { rows.find((r) => r.id === id).state = "VERIFIED"; ledger(id, true); savePlan(); };
  savePlan(); saveAccess();
  for (const r of rows) ledger(r.id, r.state === "VERIFIED");
  return { root, base, rows, access, write, savePlan, saveAccess, verify,
    run: (extra = {}) => schedule({ root, scope: "api", slots: 4, ...extra }),
    cleanup() {
      const target = resolve(root), parent = resolve(tmpdir()) + sep;
      assert(target.startsWith(parent) && target.slice(parent.length).startsWith("kill-schedule-test-"));
      rmSync(target, { recursive: true, force: true });
    },
  };
}
const withFixture = (rows, fn) => async () => { const f = fixture(rows); try { await fn(f); } finally { f.cleanup(); } };

test("chain stays solo and never starts a dependent early", withFixture([leaf("1"), leaf("2", ["1"]), leaf("3", ["2"])], (f) => {
  let r = f.run({ details: true });
  assert.equal(r.mode, "solo"); assert.deepEqual(r.launch, ["1"]);
  assert.deepEqual(r.structure.sequentialGroups, [["1", "2", "3"]]);
  assert.equal(r.blocked["dependencies-or-unreleased-leases"], 2);
  assert.equal(r.structure.deferred.length, 2);
  f.verify("1"); r = f.run(); assert.deepEqual(r.launch, ["2"]); assert.deepEqual(r.promote, ["2"]);
  assert.deepEqual(r.continuations, [{ leaf: "2", after: "1", handle: null }]);
}));

test("fork, join and later fork follow verification events", withFixture([
  leaf("1"), leaf("2", ["1"]), leaf("3", ["1"]), leaf("4", ["2", "3"]), leaf("5", ["4"]), leaf("6", ["4"]),
], (f) => {
  assert.equal(f.run().mode, "orchestrated");
  assert.deepEqual(f.run().launch, ["1"]);
  f.verify("1"); assert.deepEqual(f.run().launch, ["2", "3"]);
  f.verify("2"); assert.deepEqual(f.run().launch, ["3"]);
  f.verify("3"); assert.deepEqual(f.run().launch, ["4"]);
  f.verify("4"); assert.deepEqual(f.run().launch, ["5", "6"]);
  f.verify("5"); f.verify("6"); assert.equal(f.run().action, "verify-root");
}));

test("shared reads are safe; each of three Bernstein conflicts serializes", withFixture([leaf("1"), leaf("2")], (f) => {
  assert.deepEqual(f.run().launch, ["1", "2"]);
  f.access.leaves["2"].reads = ["src/1/**"]; f.saveAccess(); assert.deepEqual(f.run().launch, ["1"]);
  f.access.leaves["2"].reads = []; f.access.leaves["1"].reads = ["src/2/**"]; f.saveAccess();
  assert.deepEqual(f.run().launch, ["1"]);
  f.access.leaves["1"].reads = []; f.saveAccess();
  f.rows[1].owns = ["src/1/**"]; f.savePlan();
  f.write("gates/leaf-2.md", "OWNS: src/1/**\n- [ ] G1: output\n");
  assert.deepEqual(f.run().launch, ["1"]); assert.equal(f.run().mode, "solo");
}));

test("shared non-file resources and case aliases conflict", withFixture([leaf("1"), leaf("2")], (f) => {
  f.access.leaves["1"].resourceWrites = ["db:test"];
  f.access.leaves["2"].resourceReads = ["db:test"]; f.saveAccess();
  assert.deepEqual(f.run().launch, ["1"]);
  f.access.leaves["2"].resourceReads = []; f.access.leaves["2"].reads = ["SRC/1/**"]; f.saveAccess();
  assert.deepEqual(f.run().launch, ["1"]);
}));

test("capacity and active read conflicts constrain new launches", withFixture([leaf("1", [], { state: "IN-FLIGHT" }), leaf("2"), leaf("3")], (f) => {
  assert.deepEqual(f.run({ slots: 1 }).launch, []);
  assert.deepEqual(f.run({ slots: 2 }).launch, ["2"]);
  f.access.leaves["1"].reads.push("src/2/**"); f.saveAccess();
  assert.deepEqual(f.run({ slots: 2 }).launch, ["3"]);
}));

test("rolling launch does not wait for an unrelated in-flight sibling", withFixture([
  leaf("1", [], { state: "VERIFIED" }), leaf("2", ["1"], { state: "VERIFIED" }),
  leaf("3", ["1"], { state: "IN-FLIGHT" }), leaf("4", ["2"]),
], (f) => {
  assert.deepEqual(f.run({ slots: 2 }).launch, ["4"]);
}));

test("extra unplanned leaf ledger cannot disappear from allocation", withFixture([leaf("1")], (f) => {
  f.write("gates/leaf-forgotten.md", "OWNS: other/**\n- [ ] G1: required work\n");
  assert.throws(() => f.run(), /match scope leaf ledgers/);
}));

test("verified dependency lease must be released before promotion", withFixture([leaf("1"), leaf("2", ["1"])], async (f) => {
  await claimLeases(f.root, { scope: "api", leaf: "leaf-1", globs: f.rows[0].owns });
  f.verify("1"); assert.deepEqual(f.run().launch, []);
  await releaseLeases(f.root, { scope: "api", leaf: "leaf-1" });
  assert.deepEqual(f.run().launch, ["2"]);
}));

test("already claimed candidate is identified; ownership amendment invalidates lease", withFixture([leaf("1")], async (f) => {
  await claimLeases(f.root, { scope: "api", leaf: "leaf-1", globs: f.rows[0].owns });
  assert.deepEqual(f.run().alreadyClaimed, ["1"]);
  f.rows[0].owns = ["changed/**"]; f.savePlan();
  f.write("gates/leaf-1.md", "OWNS: changed/**\n- [ ] G1: outcome\n");
  assert.equal(f.run().action, "review"); assert.deepEqual(f.run().launch, []);
}));

test("native dispatch survives restart without duplicate recommendation", withFixture([leaf("1"), leaf("2")], async (f) => {
  const update = (spec) => updateDispatch(f.root, { scope: "api", wave: "w1", ...spec });
  await update({ action: "open", leaves: ["leaf-1"] });
  assert.equal(f.run().action, "review");
  await update({ action: "start", leaf: "leaf-1", handle: "agent-1" });
  await update({ action: "seal" });
  assert.deepEqual(f.run().launch, ["2"]);
  const result = spawnSync(process.execPath, [CLI, "--root", f.root, "--scope", "api", "--slots", "1"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).launch, []);
  await update({ action: "return", leaf: "leaf-1" });
  assert.deepEqual(f.run().awaitVerification, ["1"]);
  assert.deepEqual(f.run().launch, ["2"]);
  f.verify("1"); assert.deepEqual(f.run().awaitVerification, []);
}));

test("sequential continuation returns the recorded agent handle", withFixture([leaf("1"), leaf("2", ["1"])], async (f) => {
  const update = (spec) => updateDispatch(f.root, { scope: "api", wave: "w1", ...spec });
  await update({ action: "open", leaves: ["leaf-1"] });
  await update({ action: "start", leaf: "leaf-1", handle: "reuse-agent" });
  await update({ action: "seal" }); await update({ action: "return", leaf: "leaf-1" });
  f.verify("1");
  assert.deepEqual(f.run().continuations, [{ leaf: "2", after: "1", handle: "reuse-agent" }]);
}));

test("abandoned ledger or dispatch never produces success", withFixture([leaf("1")], async (f) => {
  f.write("gates/leaf-1.md", "OWNS: src/1/**\n- [ ] G1: outcome\nABANDON: G1 unresolved\n");
  assert.equal(f.run().action, "review");
  assert.deepEqual(f.run().launch, []);
}));

test("missing declarations, revision mismatch and ownership mismatch fail closed", withFixture([leaf("1")], (f) => {
  f.access.contractRevision = 2; f.saveAccess(); assert.throws(() => f.run(), /revision/);
  f.access.contractRevision = 1; delete f.access.leaves["1"].reads; f.saveAccess(); assert.throws(() => f.run(), /reads/);
  f.access.leaves["1"].reads = []; f.saveAccess();
  f.write("gates/leaf-1.md", "OWNS: other/**\n- [ ] G1: outcome\n");
  assert.throws(() => f.run(), /OWNS/);
}));

test("cycles, unknown dependencies, duplicate ids and traversal rejected", withFixture([leaf("1"), leaf("2", ["1"])], (f) => {
  f.rows[0].needs = ["2"]; f.savePlan(); assert.throws(() => f.run(), /cycle/);
  f.rows[0].needs = ["missing"]; f.savePlan(); assert.throws(() => f.run(), /unknown dependency/);
  f.rows[0].needs = []; f.rows[1].id = "1"; f.savePlan(); assert.throws(() => f.run(), /duplicate/);
  f.rows[1].id = "2"; f.rows[0].owns = ["../escape"]; f.savePlan(); assert.throws(() => f.run(), /invalid/);
}));

test("stale runnable evidence blocks a purported VERIFIED predecessor", withFixture([leaf("1", [], { state: "VERIFIED" }), leaf("2", ["1"])], (f) => {
  const gate = { check: "node verify.mjs", expect: "OK", cwd: null };
  const evidence = automaticEvidencePrefix(gateDefinitionDigest(gate)) + " exit=0; EXPECT=matched; output-sha256=" + "a".repeat(64) + "; output-bytes=2; shell=sh";
  f.write("gates/leaf-1.md", "OWNS: src/1/**\n- [x] G1: output\n  CHECK: node changed.mjs\n  EXPECT: OK\n  EVIDENCE: " + evidence + "\n");
  assert.equal(f.run().action, "review"); assert.deepEqual(f.run().launch, []);
}));

test("unknown external leases require review instead of pretending read safety", withFixture([leaf("1")], async (f) => {
  await claimLeases(f.root, { scope: "other", leaf: "leaf-x", globs: ["external/**"] });
  assert.equal(f.run().action, "review"); assert.deepEqual(f.run().launch, []);
}));

test("deterministic, read-only and compact across repeated calls", withFixture([leaf("1"), leaf("2")], (f) => {
  const tree = (path) => readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map((e) =>
    [e.name, e.isDirectory() ? tree(join(path, e.name)) : readFileSync(join(path, e.name), "utf8")]);
  const before = tree(f.root), a = f.run(), b = f.run();
  assert.deepEqual(a, b); assert.deepEqual(tree(f.root), before);
  assert.equal(a.structure, undefined); assert(JSON.stringify(a).length < 1000);
}));

test("CLI invalid options return machine-readable failure", withFixture([leaf("1")], (f) => {
  for (const args of [["--slots", "0"], ["--scope", "../x", "--slots", "1"], ["--slots", "1", "--slots", "2"]]) {
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd: f.root, encoding: "utf8" });
    assert.equal(result.status, 2); assert.equal(JSON.parse(result.stdout).action, "invalid");
  }
}));

test("all five-node forward DAGs parse and respect every dependency", () => {
  const pairs = [];
  for (let a = 1; a <= 5; a++) for (let b = a + 1; b <= 5; b++) pairs.push([a, b]);
  for (let mask = 0; mask < 1 << pairs.length; mask++) {
    const rows = Array.from({ length: 5 }, (_, i) => leaf(String(i + 1)));
    pairs.forEach(([a, b], bit) => { if (mask & (1 << bit)) rows[b - 1].needs.push(String(a)); });
    const text = "Contract revision: 1\n| Leaf | Owns | Needs | Tier | Planned wave | State |\n|---|---|---|---|---|---|\n" +
      rows.map((r) => `| ${r.id} | src/${r.id}/** | ${r.needs.join(",") || "-"} | mechanical | ${r.wave} | WAITING |`).join("\n");
    const plan = parsePlan(text);
    for (const row of rows) for (const dep of row.needs) assert(plan.order.indexOf(dep) < plan.order.indexOf(row.id));
  }
});

let failed = 0;
for (const { name, fn } of tests) {
  try { await fn(); console.log("PASS " + name); }
  catch (error) { failed++; console.error("FAIL " + name + "\n" + error.stack); }
}
console.log(`schedule tests: ${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
