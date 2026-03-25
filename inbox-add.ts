#!/usr/bin/env bun
/**
 * inbox-add.ts — drop a typed item into the brain inbox
 *
 * Usage:
 *   bun run inbox-add.ts "Follow up with Alex about contract"
 *   bun run inbox-add.ts --type idea "Gamify the Dubsado onboarding"
 *   bun run inbox-add.ts --type waiting "Waiting on legal to review the NDA"
 *   bun run inbox-add.ts --type note "Had a good call with Sarah today"
 *   bun run inbox-add.ts --type reading "https://example.com/great-article"
 *
 * Types: task (default) | idea | waiting | note | reading
 *
 * It triggers immediate brain processing. If the daemon is not running yet,
 * one is started automatically.
 */

import { addFutureItem, addInboxItem, ensureBrainProcessingNow } from "./inbox";
import type { InboxItemType } from "./types";

const VALID_TYPES: InboxItemType[] = ["task", "idea", "waiting", "note", "reading"];

// ─── Parse args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let type: InboxItemType = "task";
let activeAfter: string | null = null;
const contentParts: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--type" || args[i] === "-t") {
    const val = args[++i] as InboxItemType;
    if (!VALID_TYPES.includes(val)) {
      console.error(`Invalid type "${val}". Valid: ${VALID_TYPES.join(", ")}`);
      process.exit(1);
    }
    type = val;
  } else if (args[i] === "--after" || args[i] === "-a") {
    activeAfter = args[++i];
    if (!activeAfter || !/^\d{4}-\d{2}-\d{2}/.test(activeAfter)) {
      console.error(`--after requires a date in YYYY-MM-DD format`);
      process.exit(1);
    }
  } else {
    contentParts.push(args[i]);
  }
}

const content = contentParts.join(" ").trim();
if (!content) {
  console.error(`Usage: bun run inbox-add.ts [--type task|idea|waiting|note|reading] [--after YYYY-MM-DD] <message>`);
  process.exit(1);
}

// ─── Write to future log or inbox ────────────────────────────────────────────

if (activeAfter) {
  addFutureItem(content, type, activeAfter);
  console.log(`[future] +${type} (active ${activeAfter}): "${content}"`);
  console.log("[future] item parked — will surface automatically when date arrives");
  process.exit(0);
}

addInboxItem(content, type);
console.log(`[inbox] +${type}: "${content}"`);

// ─── Trigger immediate processing ─────────────────────────────────────────────

const processing = ensureBrainProcessingNow();
if (processing.mode === "daemon-signaled") {
  console.log(`[inbox] triggered immediate run (daemon PID ${processing.pid})`);
} else {
  console.log(`[inbox] started daemon and kicked off immediate processing (PID ${processing.pid})`);
}
