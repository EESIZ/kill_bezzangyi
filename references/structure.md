# Idempotent refinement, grouping and verification

This extends the existing skill at decision boundaries. It does not start agents,
execute CHECK commands, install hooks, or interpret a natural-language task.
The driver supplies a finite, explicit refinement after analyzing the work.
Existing gate-check, dispatch-check and Stop-hook implementations are unchanged.

## Stored model and safe boundaries

Keep PLAN, ACCESS, leaf/branch ledgers, dispatch and leases as their existing
authorities. `STRUCTURE.json` records original task identities, added children,
required edges/Gate IDs, execution groups and applied operation receipts. It is
an additional accounting registry, not a replacement dispatch authority.

A split retains its parent's task ID, ownership and original Gate definitions.
Every child inherits the parent's prerequisites; the parent additionally needs
every child and becomes the integration task. Downstream tasks still depend on
that parent. Thus parent verification is necessary before downstream work starts.
Existing root/branch evidence is invalidated by every new structural event.

Direct refinement accepts READY/WAITING parents that have never been declared in
a dispatch wave and have no active execution or lease. Their current execution
group must also be quiescent. For an already dispatched worker, use report →
confirmed stop/return → parent review/exact lease release → next-turn acceptance
in `handoff.md`. The exact old attempt remains recorded and is retired only by
that accepted handoff. An unrelated branch may keep running. Never delete launch
records or mark unfinished work VERIFIED to force a split.

Children must include two branches proved independent in the declared model.
Purely sequential subdivisions are rejected. Child writes must stay inside the
parent's writes; reads inside its reads/writes; resources inside its declared
resources. Subset proof conservatively accepts equal globs, `**`, or literal
directory `/**` prefixes. More complex subset relationships require review.
These checks do not prove that an LLM declared all real accesses or requirements.

## Request and commands

Example for an existing parent `1.1` owning `src/**` and reading `contracts/**`:

```json
{
  "schema": 1,
  "operation": "refine-1",
  "contractRevision": 1,
  "refinements": {
    "1.1": {
      "retainsParentGates": true,
      "children": [
        {
          "id": "1.1.a",
          "needs": [],
          "tier": "mechanical",
          "ledger": "OWNS: src/a/**\n- [ ] G1: reviewed A deliverable\n  EVIDENCE: pending\n",
          "access": {"complete": true, "reads": ["contracts/**"], "resourceReads": [], "resourceWrites": []}
        },
        {
          "id": "1.1.b",
          "needs": [],
          "tier": "mechanical",
          "ledger": "OWNS: src/b/**\n- [ ] G1: reviewed B deliverable\n  EVIDENCE: pending\n",
          "access": {"complete": true, "reads": ["contracts/**"], "resourceReads": [], "resourceWrites": []}
        }
      ]
    }
  }
}
```

Replace example outcomes with real acceptance checks. New ledgers cannot carry
checked Gates or abandonment. Existing inspected command approval still applies
before any new CHECK executes. `needs` references siblings; external prerequisites
are inherited automatically. A child may include a nested `refinement` with the
same `retainsParentGates` and `children` structure. Alternatively a later event
can refine an existing, still unstarted child. IDs are stable and never reused.

Store the request inside the work root, then:

```text
node <skill-dir>/scripts/structure.mjs plan --root . --scope api --request .unlazy/api/request.json --details
node <skill-dir>/scripts/structure.mjs apply --root . --scope api --request .unlazy/api/request.json
node <skill-dir>/scripts/structure-check.mjs --root . --scope api
node <skill-dir>/scripts/schedule.mjs --root . --scope api --slots 4
```

`plan` is read-only. `apply` calculates, independently verifies, invalidates prior
integration evidence, writes through a journal, then verifies the materialized
state. Both use stable ID ordering. An applied event increments PLAN and ACCESS
revision together and updates current contract-inventory revision cells. Original
outcome ownership remains with the retained parents; the managed topology block
documents new child relationships without replacing the original contract.
Default output contains action counts; `--details` includes the individual
expansions/merges. Routine events do not need to print every growing group again.

The original Tree describes the initial decomposition. For a managed scope the
dispatch table plus STRUCTURE split records and managed Expanded topology block
describe subsequent expansion; a retained parent is now an integration task.
Do not use the old Tree alone to reconstruct the current runnable work.

Use an empty `refinements: {}` with a new stable event ID and the current revision
to initialize accounting or recalculate grouping after verified returns. Persist
one request per observed event; reuse that file for retries. Do not generate a new
operation ID merely because a previous call's output was lost. Initialization
captures the current declared scope, so perform existing contract reconciliation
first. This is not an unrestricted add/delete/replace-plan migration tool.

## Deterministic calculation and independent verification

For tasks a and b:

```text
Independent(a,b) = no path a→b or b→a
                  AND W(a)∩R(b) = W(b)∩R(a) = W(a)∩W(b) = ∅
```

File intersections are conservative; non-file resources use canonical IDs.
Read/read sharing is allowed. Readiness, leases and available host slots further
restrict actual launches as described in scheduling.md.

Groups partition the full task set V. A merge is eligible only when neither group
is active/leased, unfinished members of the union form a dependency chain, and
the quotient graph is acyclic. A deterministic greedy pass repeats until no
eligible pair remains. Merging groups never deletes tasks, Gates, dependencies or
individual verification boundaries. A verified task may join another group; only
verified ancestors are offered as agent-continuation sources.

Reported complexity is descriptive, not a probability or a cost estimate:

```text
C = (number of groups, number of distinct inter-group edges, split depth)
depth(v) = 0 if unexpanded; otherwise 1 + max depth(child)
```

Within a fixed refinement event, each task expands at most once; each merge
reduces group count by one. Finite supplied candidates therefore reach a fixed
point. This proves termination of the structural calculation, not eventual
completion of arbitrary agent work or infinitely amended requirements.

The separate checker does not call the calculator or trust its verdict. It uses
breadth-first reachability to check preservation, dependencies, partition coverage,
parallel selection and group acyclicity. Transition validation compares original
task/Gate/access definitions to the proposed model. The final verifier reports:

```text
R = number of violated invariants
PASS ⇔ R = 0
```

The invariant inventory includes expected task identities, unique group membership,
retained required edges/Gates, split parent-child links, no premature VERIFIED,
current met evidence, and compatible scope lease ownership. `--selection FILE`
also checks a `{ "launch": ["1.1.a", "1.1.b"], "slots": 4 }` allocation for
readiness, conflicts, duplicate starts and capacity. Set equality checks use IDs;
equal task counts alone are not accepted as conservation.

This is a project-specific conservative algorithm informed by the cited graph
rules in the design record, not a published optimal scheduler. Repeated graph
passes trade speed for simplicity; large graph scalability and actual token
savings have not been benchmarked. The independent verifier uses at most one
graph traversal per task for reachability; it is not an LLM judgment call.

## Idempotence, interruption and recovery

For event e with a fixed request, the application contract is:

```text
T_e(T_e(S)) = T_e(S)
```

Same operation ID plus identical request returns `already-applied` without
rewriting durable state. Reusing that ID with different content is an error.
A new event with a stale revision is an error. The graph partition also reaches
a fixed point independently of the receipt mechanism. A new event still records
a new receipt/revision even if the partition stays the same.

`STRUCTURE.pending.json` contains before/after images, observed untouched inputs,
dispatch/lease snapshots and an integrity digest. Recovery rolls forward; it
does not restore old successful evidence or relaunch an agent. A file must match
its before or after image; unrelated edits, unexpected ledgers, changed dispatch
or changed leases stop recovery without overwriting those changes.

```text
node <skill-dir>/scripts/structure.mjs recover --root . --scope api
```

Recovery is repeatable; reapplying the same request also resumes its journal.
While pending, scheduling and structural verification fail closed. One driver
owns each scope. The structure transaction lock serializes structure writers but
does not lock all existing native tools: pause conflicting launches/check writes
during apply and recover. Snapshot rechecks detect ordinary concurrent changes;
they are not distributed transactions or a hostile-filesystem security boundary.

Tests inject exceptions after preparation and every individual file application.
This covers a surviving, released transaction lock. A forcibly killed process
can leave the inherited `.filelock`; that lock intentionally times out rather
than being stolen. Inspect its owner and clear it only after confirming the owner
is gone, then recover. Power-loss durability and automatic stale-lock takeover are
not claimed. A pre-journal interruption leaves root evidence invalidated; with
the original registry intact (or during first initialization), retry the same
request. Do not reinitialize a previously managed scope from a deleted registry;
restore the registry from trusted history and reconcile it.

## Existing skill loop and final Gate

At initial allocation, after verified returns/exact lease release, on a new
refinement, and after a resumed session:

1. Recover any pending transaction; reconcile inconsistent native records first.
2. For a new event, plan/apply its persisted request. Otherwise use read-only check.
3. Run schedule; the scheduler verifies registered groups and its own selection.
4. The host executes existing claim/dispatch/return/parent-review operations.
5. Repeat on the next event. No polling loop or repeated prose graph reasoning.

Apply adds a runnable root `S_STRUCTURE` Gate. Its `--final` check requires every
task VERIFIED with met Gates, parent/branch/root integrations met, no active work,
no pending transaction, no unresolved dispatch/abandonment and no scope leases.
It also requires every worker refinement report to be resolved; reporting or
accepting a handoff does not itself satisfy the parent's integration Gates.
It excludes its own unchecked state to avoid self-reference, but rejects its own
abandonment. It never performs semantic integration review on the driver's behalf.

After ordinary integration checks and exact lease releases, run the existing
root `gate-check --reverify` workflow, inspecting/approving the new checker command
as usual. The Stop hook sees the unmet S_STRUCTURE Gate until this succeeds.
Its original abandonment handoff and six-block no-progress escape remain intact;
they are not successful completion. The hook itself does not run the checker.

Existing automatic evidence binds CHECK/EXPECT/CWD, not all input files. Managed
events invalidate evidence; external changes still require explicit re-verification
immediately before reporting. A Stop-hook PASS alone is not a fresh-state proof.
