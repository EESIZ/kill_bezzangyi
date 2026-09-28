# Gates: <actual integration branch>

Scope: integrate <explicit children> into one observed result

- [ ] N1: all named children have current driver-owned acceptance evidence
  CHECK: node <skill-dir>/scripts/verify-once.mjs audit --root . .unlazy/<scope>/gates/leaf-<a>.md .unlazy/<scope>/gates/leaf-<b>.md
  EXPECT: CURRENT_EVIDENCE
  EVIDENCE: pending

- [ ] N2: joined interfaces and required behavior satisfy the contract
  CHECK: node scripts/verify-integration.mjs
  EXPECT: integration verification passed
  EVIDENCE: pending

- [ ] N3: affected behavior has no regression
  CHECK: node scripts/verify-regressions.mjs
  EXPECT: regression verification passed
  EVIDENCE: pending

- [ ] N4: required consequential manual outcomes were reviewed on this artifact
  EVIDENCE: pending

<!-- Replace placeholders and specify real obligations. Do not drop a requirement
because this template is shorter. Current evidence audit never executes checks.
Refresh stale child evidence through driver acceptance before this branch runs.
Exact leaf lease release and dispatch settlement remain mandatory. If a review
is fully machine-decidable replace it with a meaningful approved CHECK. -->
