# Token economy

For new minimal-profile work, avoid duplicate worker/driver/ancestor official
execution. Follow `minimal-verification.md`: driver-owned independent acceptance,
current-receipt audit, and fresh actual integration. This preserves the parent's
responsibility without requiring the worker to pre-run the same full suite.
Normal helper success needs no source-code reread or prose recalculation. Changes,
failures and semantic doubt are investigation triggers. Required manual reviews,
approval and useful negative controls remain.

Spend model attention on implementation and judgment. Move repeated, deterministic verification into commands and keep orchestration context narrow.

## Keep enforcement cheap

- **Use runnable checks.** External command execution does not itself require model inference. The agent still spends context on the command, returned output, failure interpretation, and evidence review.
- **Cap evidence.** Store resolved environment facts plus the automatic output fingerprint, never raw successful output or a full build log.
- **Keep the Stop hook scan-only.** The hook itself does not call a model. A block causes another agent continuation, which does consume model work, so keep the six-block no-progress guard and make each block actionable.
- **Use sequential checks by default.** Raise `--jobs` only for independent checks when wall-clock savings justify harder failure diagnosis.

## Keep contexts focused

- Give a leaf the shared contract and its own ledger, not the driver's transcript or unrelated leaf outputs.
- Keep `SKILL.md` limited to the core workflow. Load method, gate, orchestration, and parallel references only when the selected mode needs them.
- Append events to `status.log`. Do not repeatedly regenerate a large plan when one line records the event.
- Keep failure logs local and summarize only non-sensitive decisive facts when a manual report needs them; automatic success evidence already contains a digest and byte count.

## Mark leaf reasoning needs without inventing host controls

`Tier` is planner metadata for execution leaves, not a model name or a routing
guarantee:

- Use `judgment` when the leaf's own artifact needs design, security or
  compatibility reasoning, consequential manual review, or non-mechanical
  verification.
- Use `mechanical` only when the transformation pattern and acceptance gates are
  already fixed.

If the host exposes a documented model or reasoning control, the driver may map
these tiers through that host-specific control at launch. If no such control is
available, retain the tier as a briefing and review requirement and do not claim
that a particular model or reasoning level was selected.

Driver and branch duties are not leaf tiers. Contract and architecture work,
dispatch decisions, parent re-verification, branch integration, and the final
claim audit remain judgment responsibilities even when every execution leaf is
mechanical.

For declared plans, delegate the mechanical dependency/conflict part of dispatch
to `schedule.mjs` (see scheduling.md). Keep semantic review and exceptional plan
changes with the driver. Request detailed structure only at planning/amendment;
ordinary scheduling replies should stay compact.

For managed refinements, persist the request once, then let structure.mjs handle
split history, grouping and idempotent retries. Use structure-check.mjs for
invariants instead of repeatedly narrating the graph. Run on state events, not
unchanged polling; use detailed output only to inspect an actual structural change.

## Avoid false economy

Do not save time by skipping approval, negative controls, parent re-verification, or integration gates. Those checks exist because a fast false completion costs more than a direct failure.

Do not orchestrate a task that one focused session can implement and verify cleanly. Conversely, do not keep an entire build in one context merely to avoid subagent overhead when independent leaves and contracts are clear.

## Measurement claims

Earlier unlazy documentation gave exact token and effort ratios from a six-run exploratory comparison. The raw prompts, traces, outputs, and scoring records are not present in this repository, so those numbers are not reproducible here. Do not use them as product guarantees. A protocol for a future reproducible rerun is in [../research/validation-protocol.md](../research/validation-protocol.md).
