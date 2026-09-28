# Deterministic dispatch advice

Use `scripts/schedule.mjs` at allocation decisions. It reads existing authorities,
calculates an allocation, and returns compact JSON. The host agent still performs
native launches and the existing unlazy verification workflow. No new daemon,
hook, state authority, or agent runtime is installed.

When recursive refinement/accounting is enabled, `references/structure.md` adds
a persistent STRUCTURE registry. The scheduler verifies it and uses its execution
groups instead of the initial maximal-chain partition below. A pending transaction
blocks advice until recovered; incomplete integrations remain explicit tasks.
For next-turn worker handoffs see `handoff.md`. Only the exact accepted old
wave/start/return is excluded from activity; later starts of the same task remain
active normally. `handoffs` lists the logical turn and pending report readiness.
A continuation whose `after` equals `leaf` resumes that parent's integration
context after its children; record a new native wave/start for the resumed work.

## Input

For a task with multiple candidate deliverables, sketch the existing PLAN dispatch
table and leaf ledgers before allocating agents. This is task analysis, not agent
fan-out. Keep a trivially single deliverable on the existing Solo path. For a
candidate graph, use `.unlazy/<scope>/PLAN.md` with the existing six columns,
bare leaf ids (`1.1`, not `leaf-1.1`), comma-separated Owns/Needs, and `-` for no
dependencies. The leaf ledgers remain `gates/leaf-<id>.md`.

Add only the missing access information in `.unlazy/<scope>/ACCESS.json`:

```json
{
  "schema": 1,
  "contractRevision": 1,
  "leaves": {
    "1.1": {
      "complete": true,
      "reads": ["contracts/**"],
      "resourceReads": [],
      "resourceWrites": []
    }
  }
}
```

Include exactly every PLAN leaf. `reads` uses repository-relative path/glob syntax;
file writes come from the ledger OWNS and must equal the normalized PLAN mirror.
Use `[]` only for a known empty set. `complete: true` is the planner's explicit
attestation that accesses are covered; it is not proof extracted from program code.
Include imports, test inputs, generated files, shared configuration, and side effects.
Use stable lowercase resource ids such as `db:test`, `port:3000`, `api:rate-budget`
for non-file shared state. Mutating or exclusively consuming a resource is a write.
Give aliases of one resource the same id. Unknown accesses require investigation,
not an empty array. Increment PLAN contract revision and ACCESS contractRevision
together whenever dependencies or access assumptions change. Keep the existing
contract reconciliation rules and reconsider evidence affected by amendments.

## Calculation

For each pair a,b, accept independence only when neither transitively depends on
the other and all three Bernstein intersections are empty:

```
W(a) intersect R(b) = empty
W(b) intersect R(a) = empty
W(a) intersect W(b) = empty
```

Reads shared by both tasks are allowed. File intersections use the existing
conservative glob overlap logic, case-folded so Windows spelling differences do
not imply independence. Resource intersections use exact canonical ids. This is
a sufficient conservative test within the declared model, not a proof of complete
semantic independence. [Bernstein conditions in the HPF specification](https://hpff.rice.edu/versions/hpf2/hpf-v20/node68.html).

The structure result groups maximal one-successor/one-predecessor chains and names
forks/joins. A structural fork is not automatically safe parallelism: conflicts
still filter actual launches. Reuse one agent across a sequential group where the
host supports it, but retain every leaf's contract, lease, and parent verification
boundary. Do not send the group as one unconditional job that skips these boundaries.

`mode: solo` means no pair was proved independent; `orchestrated` means at least one
independent pair exists. This is allocation policy, not permission to migrate or
delete existing ledgers, dispatch waves, or integration obligations. Single-agent
serial execution remains valid when host capacity is one.

Candidates need VERIFIED dependencies with no remaining exact dependency lease.
Current VERIFIED rows must have met ledger evidence; a wave return alone does not
verify a leaf. The scheduler trusts the existing meaning of VERIFIED: the driver
performed parent --reverify and manual review. It does not establish that history.
IN-FLIGHT and recorded starts/returns awaiting verification suppress duplicate
launches. Greedy selection in stable leaf-id order excludes conflicts and respects
`--slots` (total concurrent leaf capacity for this scope, including current leaves).
It is deterministic, not maximum-cardinality or minimum-time optimization. Adjust
capacity for other host work. Other-scope leases require review because their read
sets are unknown; the initial tool does not coordinate shared resources across scopes.

## Invocation points and output

```text
node <skill-dir>/scripts/schedule.mjs --root . --scope <scope> --slots <capacity> --details
```

Use compact output first, including initial allocation. Use `--details` only when
the returned reasons or a structural amendment require investigation. Normal `blocked` output counts reasons rather than listing every
waiting leaf; detailed `structure.deferred` includes the individual reasons.
Omit details on ordinary returns to avoid repeating the graph. Call after parent verification, manual review,
exact leaf lease release and PLAN update; also call after amendments or resuming a
session/Stop-hook continuation. State lives in existing files, so a restart does
not require reconstructing history in the model context.

- `dispatch`: use only `launch`; apply the `promote` state changes, claim each leaf
  not in `alreadyClaimed`, and use the existing native dispatch contract. Recheck
  on claim refusal or changed state. For a parallel wave open, launch every agent,
  record starts, seal, and only then wait. `continuations` identifies a preceding
  leaf in the same sequential group and its last native handle if recorded. Reuse
  that agent when the host still supports it; a null/unavailable handle requires
  the driver to continue serially or launch a replacement. Do not invent handles.
  A reused handle is recorded in its new wave normally.
- `wait-or-verify`: no new launch. Collect native results; `awaitVerification` lists
  recorded returns whose parent review is outstanding. Preserve manual review and
  approved-check boundaries; do not infer VERIFIED from this output.
- `review`: inspect `attention` or `blocked`. Resume an open wave instead of opening
  another. Resolve missing information, handoffs or inconsistent state via the
  existing workflow, then recalculate. Do not blindly retry unchanged inputs.
- `verify-root`: every leaf is recorded VERIFIED with met evidence. Run the existing
  branch/root integration, final reconciliation, aggregate verification and scope
  release. This output never means ALL MET or bypasses the Stop hook.
- `invalid`: correct malformed input; no launch advice is issued.

Exit 0: normal advice, including wait/root verification. Exit 1: review needed.
Exit 2: invalid or concurrently changed input. `snapshot` identifies the calculation
inputs, not a lease, approval, execution token or content-freshness certificate.
The tool is read-only and repeated calls do not enqueue work. Save actual starts
through existing dispatch commands and promptly update PLAN state. One driver
owns a scope; multiple drivers cannot use read-only advice as a distributed lock.

## Preserved boundaries

All gate checks, command approvals, parent re-verification, manual review, branch
integration, ownership claims and Stop-hook behavior remain in the inherited tools.
The hook is still a scan-only termination backstop, not this scheduler's engine.
The LLM no longer needs to recompute dependency/conflict arithmetic, but still
calls host tools. Token/latency improvements require end-to-end measurement; no
percentage reduction is claimed. No unrestricted natural-language task can have
its full access set or hidden subtasks derived by this script.
