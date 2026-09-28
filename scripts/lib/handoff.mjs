// Handoff identities and checkpoint IO. No native agent or CHECK execution.
import { join } from "node:path";
import { parseGates, normalizeOwnsGlob, readStableRegularFile, sha256 } from "./gates.mjs";

export const reportsOf = (meta) => meta?.reports || [];
export const retiresExecution = (r) => r.state === "applied" || r.state === "resumed";
export const turnOf = (meta) => meta.turn ?? meta.operations.length;
export const gateDefinitions = (text) => parseGates(text).gates.map(({ id, title, check, expect, cwd }) => [id, title, check, expect, cwd]);
export const attemptKey = (s, parent) => JSON.stringify([s.wave, parent, s.handle, s.startAt]);
export function attemptsFor(waves, parent) {
  return Object.entries(waves || {}).filter(([, w]) => w.leaves.includes("leaf-" + parent)).map(([wave, w]) => ({
    wave, parent, state: w.state, handle: w.started["leaf-" + parent]?.handle,
    startAt: w.started["leaf-" + parent]?.at, returnedAt: w.returned["leaf-" + parent]?.at,
  }));
}
export function retiredAttempt(meta, wave, parent, start, returned) {
  if (!start || !returned) return false;
  return reportsOf(meta).some((r) => retiresExecution(r) && r.parent === parent &&
    r.source.wave === wave && r.source.handle === start.handle && r.source.startAt === start.at && r.returnedAt === returned.at);
}
export function originalReport(r) {
  return { id: r.id, parent: r.parent, source: r.source, checkpoint: r.checkpoint, ledger: r.ledger,
    contract: r.contract, refinement: r.refinement, reportedTurn: r.reportedTurn, operation: r.operation };
}
export const parentContract = (r) => ({ needs: r.needs, owns: r.owns, reads: r.reads, resourceReads: r.resourceReads, resourceWrites: r.resourceWrites });
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
export function validateCheckpoint(row, cp) {
  const strings = (a) => Array.isArray(a) && a.every((s) => typeof s === "string" && s.length) && new Set(a).size === a.length;
  requireValue(cp && typeof cp.summary === "string" && cp.summary.trim() && cp.summary.length <= 10000 &&
    strings(cp.completed) && strings(cp.remaining) && cp.remaining.length && Array.isArray(cp.artifacts), "invalid checkpoint");
  const ids = row.gates.map((g) => g.id), parts = [...cp.completed, ...cp.remaining];
  requireValue(new Set(parts).size === parts.length && JSON.stringify([...ids].sort()) === JSON.stringify([...parts].sort()), "checkpoint must partition every parent Gate");
  requireValue(cp.completed.every((id) => row.gates.find((g) => g.id === id)?.state === "met"), "completed checkpoint Gates need current met evidence");
  requireValue(new Set(cp.artifacts.map((a) => a.path)).size === cp.artifacts.length, "duplicate checkpoint artifact");
  for (const a of cp.artifacts) {
    const path = typeof a.path === "string" ? normalizeOwnsGlob(a.path) : { error: "missing" };
    requireValue(!path.error && path.value === a.path && !/[*?[{<>|]/.test(a.path) && /^[a-f0-9]{64}$/.test(a.sha256), "invalid checkpoint artifact path/hash");
    requireValue(row.owns.some((glob) => {
      const g = glob.toLowerCase(), p = a.path.toLowerCase();
      return g === "**" || g === p || (g.endsWith("/**") && !/[*?[{]/.test(g.slice(0, -3)) && p.startsWith(g.slice(0, -2)));
    }), "checkpoint artifact outside parent ownership");
  }
}
export function verifyArtifacts(root, artifacts = []) {
  requireValue(Array.isArray(artifacts), "invalid artifact snapshot");
  for (const a of artifacts) {
    const path = typeof a.path === "string" ? normalizeOwnsGlob(a.path) : { error: "missing" };
    requireValue(!path.error && path.value === a.path && !/[*?[{<>|]/.test(a.path) && /^[a-f0-9]{64}$/.test(a.sha256), "invalid artifact snapshot path/hash");
    const text = readStableRegularFile(join(root, a.path), { root, maxBytes: 8 * 1024 * 1024, label: "handoff text artifact" });
    requireValue(sha256(text) === a.sha256, "checkpoint artifact changed: " + a.path);
  }
}
