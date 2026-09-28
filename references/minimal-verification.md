# One official acceptance per current input context

The driver owns acceptance, including Solo work. Workers may test while developing but need not run the whole official suite before returning. An unchanged accepted artifact does not need the same official check again solely because it reached an ancestor. Required semantic/manual review, command inspection, negative controls and actual integration remain.

## Commands

```text
node <skill-dir>/scripts/verify-once.mjs run --root . --inputs src,tests,scripts,package.json --closed --approve GATES.md
node <skill-dir>/scripts/verify-once.mjs audit --root . GATES.md
```

Inspect CHECK and every called project script before authorizing `--approve`, as with gate-check. Use literal relative input files/directories, comma-separated. Include every artifact, called check, fixture, imported module, relevant configuration and dependency that can affect the result. Missing literal paths are fingerprinted too. Optional `--env NAME,NAME` names relevant environmental inputs; Node identity, PATH, ComSpec, UNLAZY_SHELL and NODE_OPTIONS are always bound.

`--closed` attests that this observation set is complete and deterministic, its relevant writers have stopped, and checks are read-only or safely repeatable. File globs and binary inputs are deliberately unsupported. This declaration is not inferred from ACCESS and is not a semantic proof. If a test reads undeclared files, uses uncontrolled external state or may change while observed, do not assert closure. Without `--closed`, run always executes fresh and audit never certifies reuse. Use an appropriate explicit fresh boundary for volatile checks. Do not widen the declaration merely to hide missing facts.

The wrapper fingerprints selected text trees, Gate definitions, manual evidence, the checker package and runtime inputs. It runs the inherited approved `gate-check --reverify` when needed. Ledgers with manual gates additionally require `--reviewed` after the driver actually re-examines those outcomes for this input context and records their evidence. A stale context cannot inherit manual approval merely from a checked box. A durable pending record invalidates previous reusable success before execution. Only an actually successful stable check creates a receipt. Failure, concurrent input change or missing manual evidence cannot produce accepted evidence. Receipt and ledger updates are conservative: a crash between them leaves unusable evidence and permits a safe fresh retry, not guessed success.

Receipts are stored in `.unlazy/verification-receipts.json`, not in a new scope directory. They are cooperative workflow evidence, not signed attestations or a defense against a worker deliberately forging repository state. Before/after snapshots detect ordinary drift, not arbitrary concurrent ABA writes; the host still must ensure quiescent inputs. Native agent starts/stops and approvals are not automated by this wrapper.

Use narrow complete inputs for a leaf or a Solo artifact. For a branch that audits child receipts or structural metadata, execute its integration ledger fresh through inherited `gate-check --reverify`; its child audit avoids repeating child commands. Do not wrap receipt-reading checks in a reusable receipt, since they would depend on the receipt store being updated by that same wrapper. Do not include a ledger or its containing directory among its own inputs. Never claim all workspace or external dependencies were tracked if they were not.

For normal successful calls, read the compact result only. Do not reread helper internals or manually reproduce graph arithmetic. Investigate a failure, stale receipt, changed helper or semantically questionable CHECK. No receipt bypasses the original oracle approval boundary.

## Dispatch and integration

Scoped receipts bind PLAN's contract revision. Contract amendments or structural
revision changes invalidate them. Ordinary returns can schedule directly; do not
force a new coarsening revision after every return. Regroup when structurally
needed, then refresh evidence affected by that revision before promotion.

On a real native return, the driver confirms it and writers, performs required manual review, and runs official acceptance for that exact ledger. Only then mark VERIFIED, release the exact lease and calculate the next ready set. Scheduler and structural verifier refuse stale reusable receipts. Accepted non-closed executions retain the inherited fresh-verification semantics and must be re-executed at a later verification boundary; they never satisfy receipt audit. Existing supplied snapshots without receipts retain the inherited path; never claim those legacy records gained artifact freshness.

Branch N1 audits named child receipts. If stale, the driver refreshes affected child acceptance before integration. It does not let the branch CHECK launch new workers or silently approve new checks. Integration has its own interface/E2E/regression oracles, placed where the combined outcome is observed, rather than copied into every leaf.

Before final reporting audit receipt-backed ledgers, run outstanding actual integration and structural checks, reconcile the original request and inspect residual work. A fresh gate-check success for volatile structural metadata remains necessary and is not a reusable artifact receipt. The Stop hook stays scan-only; it does not detect arbitrary external artifact edits in real time. A hook release is not completion proof.

The full proposed `advance` command and OS writer-stop automation are not implemented. Host calls and the existing report/return/lease protocol remain. Savings, behavior adoption and quality must be measured.
