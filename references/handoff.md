# Next-turn repartition after a worker report

Use the existing `structure.mjs plan/apply/recover` commands. Record a worker's
proposal, confirm it has stopped writing and returned, then accept the proposal
in a later logical turn. Preserve native execution history and the parent's
integration responsibility. No unfinished task becomes VERIFIED through handoff.

## Formulas and state

S contains the DAG G=(V,E), group partition, Gates, native attempts, leases,
reports and operation receipts. A logical turn is a committed event-processing
step, not an LLM message, clock interval or global barrier:

```text
t = number of successfully committed distinct structure operations
t(T_e(S)) = t(S)+1 for a new valid operation, t(S) for an identical retry
T_e(T_e(S)) = T_e(S)
```

Read-only plan/check/schedule does not advance t. A report and its resolution
must be separate committed operations. Persist one operation ID per observed
event and reuse the original request on retry.

```text
q = (id, parent, source, checkpoint, originalLedger, originalContract,
     refinement, reportedTurn, state)
source = (wave, task ID, host handle, startedAt)
state ∈ {pending, applied, resumed, rejected}

GateIDs(parent) = Completed(q) ⊎ Remaining(q)
Completed(q) ⊆ currently met gates; Remaining(q) ≠ ∅
```

The completed/remaining sets must be an exact disjoint partition. The earlier
ledger and evidence remain in report history. Every original parent Gate is
retained and invalidated on repartition for later integration re-verification.

```text
Eligible(q,t) = Pending(q) ∧ reportedTurn(q)<t
  ∧ exact source dispatch return exists
  ∧ explicit stopped confirmation with evidence
  ∧ explicit parent review with evidence
  ∧ no parent lease ∧ no other unresolved parent attempt
  ∧ original parent contract/Gate definitions still match
  ∧ checkpoint artifacts/completed-gate evidence still match
```

A native return and stopped-writer confirmation are separate requirements. The
host/parent supplies the stop fact after checking its runtime. The script does
not prove OS-level process quiescence or the truth of a manual review.

For parent p and fresh children C:

```text
V' = V ∪ C, C ∩ V = ∅
Pred'(p) = Pred(p) ∪ C
Pred'(c) = Pred(p) ∪ siblingPrerequisites(c), for every c in C
GateDefinitions'(v) = GateDefinitions(v), for every original v
```

Children remain inside the original parent's access boundaries. At least two
must satisfy dependency independence and the Bernstein conditions in
`scheduling.md`. The independent checker rechecks conservation, acyclicity and
group eligibility. An invalid proposal stays pending without creating children.

Only the exact accepted native attempt is retired from activity accounting:

```text
Retired(a) ⇔ some applied/resumed q has source(q)=identity(a)
              and returnedAt(q)=dispatchReturn(a)
Active(v) ⇔ PLAN(v)=IN-FLIGHT
           or some started a of v has ¬Retired(a)
              and (notReturned(a) or PLAN(v)≠VERIFIED)
r_t(v) = |Pred(v) \ Verified_t|
Ready_t(v) ⇒ r_t(v)=0 ∧ no predecessor leases ∧ ¬Active(v)
```

The existing wave still tracks its ordinary returns; unrelated workers can
continue. A new wave/start for the same parent is active again even if its host
handle is reused. Conflict and slot constraints still apply. Group coarsening
retains individual verification boundaries; it is not result integration.

The independent verifier reports `R = violated invariant count`, passing only
at `R=0`. Final verification also requires no pending reports, active attempts,
remaining scope leases or unresolved dispatch, and all required Gates met.

## Report request

Save the worker's outputs and report its completed/remaining obligations and
child contracts. Example for task A owning `src/a/**`, with G1 met and G2 pending:

```json
{
  "schema": 1,
  "operation": "report-A-1",
  "contractRevision": 4,
  "refinements": {},
  "reports": [{
    "id": "A-report-1", "parent": "A",
    "source": {"wave": "w1", "handle": "actual-host-handle"},
    "checkpoint": {
      "summary": "Foundation saved; two independent modules remain.",
      "completed": ["G1"], "remaining": ["G2"], "artifacts": []
    },
    "refinement": {
      "retainsParentGates": true,
      "children": [
        {
          "id": "A.x", "needs": [], "tier": "mechanical",
          "ledger": "OWNS: src/a/x/**\n- [ ] X: reviewed module X\n  EVIDENCE: pending\n",
          "access": {"complete": true, "reads": [], "resourceReads": [], "resourceWrites": []}
        },
        {
          "id": "A.y", "needs": [], "tier": "mechanical",
          "ledger": "OWNS: src/a/y/**\n- [ ] Y: reviewed module Y\n  EVIDENCE: pending\n",
          "access": {"complete": true, "reads": [], "resourceReads": [], "resourceWrites": []}
        }
      ]
    }
  }]
}
```

Replace examples with real ledgers and complete accesses, including shared
outputs/imports. For checkpointed text outputs, artifacts contains entries of
the form `{"path":"src/a/foundation.ts","sha256":"<64 lowercase hex>"}`.
The hash is SHA-256 of stable-reader UTF-8 text without newline normalization;
this feature is for text artifacts, not arbitrary binaries. Paths must be
literal root-relative files within the parent's ownership. Links, traversal
and wildcard artifact paths are rejected. An empty array explicitly declares
no checkpointed text artifact. The script cannot infer omitted files or work.

The report captures the real native start time, original parent ledger and
dependency/access contract. The source must have started in a sealed/complete
wave. One pending report per parent is allowed. Reporting creates no children
and grants no completion credit. A bad candidate may be recorded for review,
but acceptance will fail. Reject it explicitly and submit a corrected new
report ID; never overwrite pending history.

## Parent acceptance in a later turn

1. Confirm the worker stopped all writers and saved its checkpoint.
2. Record its actual native return using the existing dispatch-check command.
3. Review the checkpoint and remaining obligations.
4. Release its exact lease after this handoff review. This is a handoff boundary,
   not successful parent verification; do not mark the task VERIFIED.
5. Persist acceptance with the current contract revision:

```json
{
  "schema": 1, "operation": "accept-A-1", "contractRevision": 5,
  "refinements": {},
  "acceptReports": [{
    "id": "A-report-1", "stopped": true, "reviewed": true,
    "stopEvidence": "Actual host observation confirming writers stopped.",
    "reviewEvidence": "Parent inspected outputs and remaining child contracts."
  }]
}
```

Use the ordinary structure plan/apply commands with the persisted report or
acceptance JSON, followed by schedule. The parent becomes WAITING on children.
Start children only through the existing claims and native launch-wave protocol.
Inspect/approve CHECK commands normally; acceptance never marks children VERIFIED.

After child verification and exact lease release, schedule can offer the old
parent handle as a continuation (`after` is that same parent ID). Resume only
if the host supports it; otherwise use a replacement with the saved checkpoint.
Record a fresh native wave/start. These scripts do not start or stop agents.

An already split parent can report additional remaining work during integration.
A new accepted report appends fresh child IDs while preserving earlier children
and prerequisites. Running descendants use the same protocol recursively.

## Reject, retry and recover

If the worker has stopped and the parent chooses to continue the original task
without splitting, use `resumeReports` instead of `acceptReports`, with the same
id/stopped/reviewed/stopEvidence/reviewEvidence fields and a new operation ID.
It enforces the same return/stop/review/release/checkpoint boundary, retires the
old attempt, and makes the original task schedulable without creating children.
`resumed` records this allocation decision; the host must still perform a new
native start. A serial or otherwise unsuitable split candidate can use this path.

To decline a pending proposal in a later turn, include
`"rejectReports":[{"id":"A-report-1","reason":"Specific parent decision and continuation plan."}]`
with the usual schema, new operation ID, current revision and `refinements: {}`.
Rejection preserves original work and execution status. It does not stop, retire,
verify or automatically resume the worker. If it has already returned, reconcile
how original work will finish through the host; normally choose resumeReports
while the report is still pending instead. Never fabricate completion.
If a report was already rejected before its worker stopped, submit a fresh report
ID for that still-unretired source and resolve it with resumeReports after the
confirmed return. Keep the rejected record unchanged.

Report/accept/resume/reject all share the existing receipt and recovery journal.
Identical retries do not add a turn, reports or children. ID/content collisions
and stale new requests fail. Recovery rechecks captured artifact hashes too.
Unknown edits, changed dispatch or leases stop recovery without overwriting them.
Report payloads, terminal resolutions and retired attempts remain recorded.

`schedule` exposes `handoffs.turn` and pending report IDs with source-return and
lease-release state. Resolve them while other branches proceed. Pending journals
block allocation; pending reports block successful final completion through
S_STRUCTURE. The existing scan-only Stop hook retains its no-progress escape
and abandonment handoff. Its stale-filelock and fresh --reverify boundaries
still apply. This is deterministic bookkeeping around host attestations, not
a guarantee that arbitrary agents stop/finish or a token-savings benchmark.
