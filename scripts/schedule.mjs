#!/usr/bin/env node
import { schedule } from "./lib/schedule.mjs";

const args = process.argv.slice(2);
if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  console.log("Usage: node scripts/schedule.mjs --scope ID --slots N [--root PATH] [--details]\nRead-only dispatch advice; never executes checks, claims, or agents.");
} else {
  try {
    const options = { root: process.cwd() };
    const seen = new Set();
    while (args.length) {
      const arg = args.shift();
      if (!["--scope", "--slots", "--root", "--details"].includes(arg) || seen.has(arg)) throw new Error("unknown or duplicate option");
      seen.add(arg);
      if (arg === "--details") options.details = true;
      else {
        const value = args.shift();
        if (!value || value.startsWith("--")) throw new Error("missing option value");
        if (arg === "--slots" && !/^[1-9]\d*$/.test(value)) throw new Error("invalid slots");
        options[arg.slice(2)] = arg === "--slots" ? Number(value) : value;
      }
    }
    const result = schedule(options);
    console.log(JSON.stringify(result));
    process.exitCode = result.action === "review" ? 1 : 0;
  } catch (error) {
    console.log(JSON.stringify({ schema: 1, action: "invalid", error: String(error.message).slice(0, 500) }));
    process.exitCode = 2;
  }
}
