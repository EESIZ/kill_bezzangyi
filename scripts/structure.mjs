#!/usr/bin/env node
import { resolve } from "node:path";
import { assertStableStructure, calculateStructure, loadStructure, readInput } from "./lib/structure.mjs";
import { applyStructure, recoverStructure } from "./lib/structure-store.mjs";

const actionSummary = (actions, details) => details ? actions : {
  expanded: actions.filter((a) => a.action === "expand").length,
  merged: actions.filter((a) => a.action === "group").length,
  reported: actions.filter((a) => a.action === "report").length,
  accepted: actions.filter((a) => a.action === "accept-report").length,
  rejected: actions.filter((a) => a.action === "reject-report").length,
  resumed: actions.filter((a) => a.action === "resume-report").length,
};

try {
  const args = process.argv.slice(2), command = args.shift();
  if (command === "--help") {
    console.log("Usage: structure.mjs plan|apply --root PATH --scope ID --request FILE [--details]\n       structure.mjs recover --root PATH --scope ID\nDoes not run CHECK commands or start agents.");
  } else {
    if (!["plan", "apply", "recover"].includes(command)) throw new Error("expected plan, apply or recover");
    const opt = { root: process.cwd() }, seen = new Set();
    while (args.length) {
      const key = args.shift();
      if (!["--root", "--scope", "--request", "--details"].includes(key) || seen.has(key)) throw new Error("unknown or duplicate option");
      seen.add(key);
      if (key === "--details") opt.details = true;
      else { const value = args.shift(); if (!value || value.startsWith("--")) throw new Error("missing option value"); opt[key.slice(2)] = value; }
    }
    opt.root = resolve(opt.root);
    if (command === "recover") {
      if (opt.request || opt.details) throw new Error("recover takes only root and scope");
      console.log(JSON.stringify(await recoverStructure(opt)));
    } else {
      if (!opt.request) throw new Error("request file required");
      const request = JSON.parse(readInput(opt.root, resolve(opt.root, opt.request)));
      if (command === "apply") {
        const result = await applyStructure({ ...opt, request });
        console.log(JSON.stringify({ ...result, ...(result.actions ? { actions: actionSummary(result.actions, opt.details) } : {}) }));
      }
      else {
        const model = loadStructure(opt.root, opt.scope), result = calculateStructure(model, request);
        assertStableStructure(model);
        console.log(JSON.stringify(result.alreadyApplied ? { status: "already-applied", operation: result.operation } : {
          status: "planned", operation: result.operation, snapshot: result.baseHash, actions: actionSummary(result.actions, opt.details),
          turn: result.next.meta.turn, check: result.check, complexity: result.complexity,
          ...(opt.details ? { groups: result.next.meta.groups, splits: result.next.meta.splits } : {}),
        }));
      }
    }
  }
} catch (error) {
  console.log(JSON.stringify({ status: "invalid", error: String(error.message).slice(0, 800) })); process.exitCode = 2;
}
