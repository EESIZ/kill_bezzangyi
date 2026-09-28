# Orchestrated mode

Use orchestrated mode when one context cannot hold the task and its verification at full attention. Keep the driver responsible for planning, dispatch, independent verification, integration, and the root report.

## Declare states and paths

Use these leaf states only:

- `WAITING`: one or more ids in `Needs` are not yet `VERIFIED`
- `READY`: dependencies are verified and ownership is available
- `IN-FLIGHT`: dispatched and not yet independently verified
- `VERIFIED`: parent re-verification passed and manual gates were reviewed
- `ABANDONED`: at least one required gate has a recorded handoff; never treat this as full completion

Use `OPEN`, `VERIFIED`, or `ABANDONED` for branches. Store leaf ledgers as `gates/leaf-<id>.md` and integration ledgers as `gates/node-<id>.md`. Do not label a branch path as `leaf-*`.

## Driver loop

1. **Plan before fan-out.** Reread the original request and current amendments. Create `.unlazy/<scope>/PLAN.md`, `.unlazy/<scope>/GATES.md`, and one ledger per leaf and branch from the templates. Inventory every independently omittable outcome and acceptance-changing constraint with a stable id, owner, observing gate or manual review, disposition, and revision. Fix interfaces, naming, toolchain, dependencies, and exact ownership before dispatch.
2. **Inspect and approve checks.** Run `gate-check --status` on every inherited ledger. Review each `CHECK:`, `EXPECT:`, and `CWD:`, including called scripts. Determine the shell and inherited `PATH`; a new oracle with no exact approval prints its resolved values during a normal run without executing. Use `--approve` only after inspection, and do not treat normal mode as a dry run once approval exists.
3. **Claim every concurrent leaf.** Run:

   ```text
   node <skill-dir>/scripts/gate-check.mjs --scope <scope> --leaf leaf-1.2.1 --claim
   ```

   A refused claim means the split is not safe for concurrent dispatch. Change the plan or run the work sequentially; never bypass the refusal.
4. **Launch each ready wave.** Give each leaf only its shared interface contract, exact ownership/dependencies and deliverable requirements. Workers run needed development tests and return artifacts; the driver owns the official acceptance ledger. Open a dispatch wave, call native nonblocking launch once per leaf, record handles and seal before waiting. Follow [dispatch.md](dispatch.md).
5. **Verify each return independently.** Record the native return, confirm writers stopped, review required manual outcomes, and perform driver-owned acceptance. For new minimal-profile ledgers follow [minimal-verification.md](minimal-verification.md). With complete stable inputs, `verify-once.mjs run` performs the necessary independent command execution once and records current evidence. It may reuse its own current receipt, never an unchecked worker claim. Legacy or volatile checks retain the fresh command below:

   ```text
   node <skill-dir>/scripts/gate-check.mjs --root . --cwd . --reverify .unlazy/<scope>/gates/leaf-1.2.1.md
   ```

   `--status` alone is not re-verification or receipt audit. Inspect changed oracles and called scripts before reapproval. Review manual gates directly when required. Test the oracle's negative controls when introducing or changing the oracle, rather than reflexively repeating the same semantic investigation after every unchanged return.
6. **Append status and roll forward.** Record the result without rewriting history:

   ```text
   node <skill-dir>/scripts/gate-check.mjs --scope <scope> --log "leaf-1.2.1 verified"
   ```

   Mark the leaf `VERIFIED`, release that exact leaf lease, and record the release before promotion:

   ```text
   node <skill-dir>/scripts/gate-check.mjs --scope <scope> --leaf leaf-1.2.1 --release
   node <skill-dir>/scripts/gate-check.mjs --scope <scope> --log "leaf-1.2.1 lease released"
   ```

   Only then promote newly unblocked leaves from `WAITING` to `READY` and dispatch them without waiting for unrelated in-flight leaves.
7. **Integrate bottom-up.** At each actual artifact integration, audit current child receipts and refresh stale child acceptance, then execute that integration's interface/E2E/affected-regression checks. Use `templates/gates-node-minimal.md`. For legacy children without reusable receipts keep fresh re-verification. Grouping alone is not a new integration obligation.
8. **Reconcile, release, and report.** Reread the request and review every current contract row. Missing/stale evidence, abandonment, deferment and owner decisions are non-completion. Audit receipt-backed child evidence, execute branch/root integration and structural checks fresh, and confirm every wave/leaf is settled before scope release. Keep final aggregate verification. Do not recursively execute unchanged child commands merely because this is the root.

## Check concurrency

Gate checks run sequentially by default (`--jobs 1`). This is the easiest transcript to debug and is the compatibility behavior.

Use `--jobs <N>` only when runnable gates are independent and parallel execution reduces wall-clock time:

```text
node <skill-dir>/scripts/gate-check.mjs --root . --cwd . --reverify --jobs 4 .unlazy/<scope>/gates/leaf-1.1.1.md .unlazy/<scope>/gates/leaf-1.1.2.md
```

The limit is rolling: start another check when one finishes instead of waiting for a fixed batch. Output and file updates remain deterministic in ledger order. `--jobs` controls command execution, not subagent dispatch and not dependency readiness. Use [dispatch waves](dispatch.md) for native agent concurrency.

## Rolling dispatch

When using the allocation helper, call `schedule.mjs` as described in
[scheduling.md](scheduling.md) to calculate each ready set. Apply its suggested
promotions only after the existing verification/release sequence. Preserve the
loop below; the helper replaces dependency/conflict selection, not verification.

Treat dispatch as a loop:

```text
while an unverified leaf remains:
  collect the independent READY leaves up to the host concurrency limit
  open a dispatch wave for that exact set
  launch every native agent and record every returned host handle
  seal the wave before the first wait
  wait for the next leaf to return
  record that return in its dispatch wave
  accept that leaf through the driver-owned verifier and review required manual evidence
  append status and mark it VERIFIED
  release that exact leaf lease and record the release
  promote each WAITING leaf whose Needs are all VERIFIED
```

Do not invent a dependency during dispatch. Add it to `PLAN.md`, correct the affected states, and record the change. A user amendment increments the contract revision and must be reconciled before more completion credit. Prefer independent leaves, but do not force independence where an interface must be established first.

## Verification hierarchy

For managed recursive refinements, follow `structure.md` at these boundaries.
After parent review and exact lease release, apply one persisted empty-refinement
event to recompute groups, then schedule. For newly discovered children during
execution, follow `handoff.md`: persist the report, confirm the stopped worker's
native return, review its checkpoint, release its exact lease and accept it in a
later logical turn. This handoff never marks the original task VERIFIED. Retained
parents execute their original integration Gates after child verification.
On resume, recover any pending structural journal before issuing new launches.
Final S_STRUCTURE verification requires all pending reports to be resolved too.

1. **Leaf self-check:** catches ordinary incompleteness but remains self-certification.
2. **Parent `--reverify`:** executes each runnable oracle again instead of trusting old or manually written evidence.
3. **Branch integration:** catches locally correct children that do not compose.
4. **Optional Stop hook:** blocks the driver from ending while its resolved pipeline has unmet ledgers or incomplete dispatch waves. It does not execute checks or validate their meaning.

The parent must use the same required toolchain and declared shell. If the environment differs, record and resolve the mismatch instead of accepting old evidence.

## Manual gates

Automation cannot prove every user-facing or judgment-heavy outcome. For each manual gate:

- cite the exact artifact, location, measurement, or reviewer decision
- review consequences, not only visual polish
- obtain independent review for high-risk outcomes when feasible
- keep the gate unmet if evidence is ambiguous

Do not call a leaf `VERIFIED` merely because every runnable gate passed.

## When not to orchestrate

Stay solo when one focused context can implement and verify the task without hiding independent deliverables. Orchestration has planning and integration overhead; use it for attention isolation, not ceremony.
