#!/usr/bin/env node
import { resolve } from "node:path";
import { assertStableStructure, loadStructure, readInput } from "./lib/structure.mjs";
import { verifyStructure } from "./lib/structure-check.mjs";

try {
  const args = process.argv.slice(2), opt = { root: process.cwd() }, seen = new Set();
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: structure-check.mjs --root PATH --scope ID [--selection FILE] [--final]\nRead-only invariant verification; never executes gate commands.");
  } else {
    while (args.length) {
      const key = args.shift();
      if (!["--root", "--scope", "--selection", "--final"].includes(key) || seen.has(key)) throw new Error("unknown or duplicate option");
      seen.add(key);
      if (key === "--final") opt.final = true;
      else { const value = args.shift(); if (!value || value.startsWith("--")) throw new Error("missing option value"); opt[key.slice(2)] = value; }
    }
    opt.root = resolve(opt.root);
    const model = loadStructure(opt.root, opt.scope);
    if (model.files["STRUCTURE.json"] === null) throw new Error("STRUCTURE registry is not initialized");
    const selection = opt.selection ? JSON.parse(readInput(opt.root, resolve(opt.root, opt.selection))) : null;
    const result = verifyStructure(model, selection, !!opt.final);
    assertStableStructure(model);
    console.log(JSON.stringify({ marker: result.ok ? "STRUCTURE_OK" : "STRUCTURE_UNMET", ...result }));
    process.exitCode = result.ok ? 0 : 1;
  }
} catch (error) {
  console.log(JSON.stringify({ marker: "STRUCTURE_INVALID", error: String(error.message).slice(0, 800) })); process.exitCode = 2;
}
