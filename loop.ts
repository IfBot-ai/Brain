/**
 * loop.ts — single brain loop run.
 * Loads memory and all collections, calls Claude, executes actions, writes back.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import config from "./config";
import { buildSystemPrompt } from "./prompts/system";
import { executeActions } from "./actions/executor";
import { loadAllCollections, writeCollection } from "./collections";
import type { BrainAction, BrainResponse, FutureItem, InboxItem, InboxItemType, Memory, Task } from "./types";

const ROOT = import.meta.dir;
const MEMORY_DIR = join(ROOT, "memory");
const SKILLS_DIR = join(ROOT, "skills");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJSON<T>(path: string, fallback: T): T {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; }
  catch { return fallback; }
}

function writeJSON(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function readSkills(): string {
  if (!existsSync(SKILLS_DIR)) return "";
  const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md"));
  if (files.length === 0) return "";
  return files
    .map((f) => {
      const content = readFileSync(join(SKILLS_DIR, f), "utf8");
      return `### ${f}\n${content}`;
    })
    .join("\n\n");
}

/**
 * Check future.json for items whose activeAfter date has passed.
 * Ripened items are removed from future.json and injected into inbox.json.
 * Returns the count of matured items for logging.
 */
function matureFutureItems(inbox: InboxItem[]): number {
  const now = new Date();
  const future = readJSON<FutureItem[]>(join(MEMORY_DIR, "future.json"), []);
  const ripened: FutureItem[] = [];
  const remaining: FutureItem[] = [];

  for (const item of future) {
    if (new Date(item.activeAfter) <= now) {
      ripened.push(item);
    } else {
      remaining.push(item);
    }
  }

  if (ripened.length === 0) return 0;

  for (const item of ripened) {
    inbox.push({
      id: item.id,
      content: `[from future log] ${item.content}${item.notes ? ` — ${item.notes}` : ""}`,
      type: item.type,
      addedAt: new Date().toISOString(),
    });
    console.log(`  [future] matured → inbox: "${item.content.slice(0, 60)}"`);
  }

  writeJSON(join(MEMORY_DIR, "future.json"), remaining);
  return ripened.length;
}

function clearProcessedInboxItems(processedInbox: InboxItem[]): number {
  const processedIds = new Set(processedInbox.map((item) => item.id));
  const latestInbox = readJSON<InboxItem[]>(join(MEMORY_DIR, "inbox.json"), []);
  const remainingInbox = latestInbox.filter((item) => !processedIds.has(item.id));
  writeJSON(join(MEMORY_DIR, "inbox.json"), remainingInbox);
  return remainingInbox.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPriority(value: unknown): value is Task["priority"] {
  return value === "high" || value === "medium" || value === "low";
}

function isUrgency(value: unknown): value is "low" | "medium" | "high" {
  return value === "low" || value === "medium" || value === "high";
}

function isInboxItemType(value: unknown): value is InboxItemType {
  return value === "task"
    || value === "event"
    || value === "note"
    || value === "idea"
    || value === "waiting"
    || value === "reading";
}

function warnInvalidAction(action: unknown, reason: string) {
  const preview = JSON.stringify(action)?.slice(0, 200) ?? String(action).slice(0, 200);
  console.warn(`[brain] dropping invalid action (${reason}): ${preview}`);
}

function sanitizeActions(actions: unknown): BrainAction[] {
  if (!Array.isArray(actions)) {
    console.warn("[brain] actions payload was not an array; dropping it");
    return [];
  }

  const valid: BrainAction[] = [];

  for (const action of actions) {
    if (!isRecord(action) || typeof action.type !== "string") {
      warnInvalidAction(action, "missing type");
      continue;
    }

    switch (action.type) {
      case "update_memory":
        if (typeof action.key === "string") valid.push(action as BrainAction);
        else warnInvalidAction(action, "update_memory.key");
        break;

      case "add_task":
        if (typeof action.title === "string" && isPriority(action.priority)) valid.push(action as BrainAction);
        else warnInvalidAction(action, "add_task title/priority");
        break;

      case "update_task":
        if (typeof action.id === "string" && isRecord(action.updates)) valid.push(action as BrainAction);
        else warnInvalidAction(action, "update_task id/updates");
        break;

      case "close_task":
        if (typeof action.id === "string") valid.push(action as BrainAction);
        else warnInvalidAction(action, "close_task.id");
        break;

      case "add_to_collection":
        if (typeof action.collection === "string" && isRecord(action.item)) valid.push(action as BrainAction);
        else warnInvalidAction(action, "add_to_collection collection/item");
        break;

      case "update_collection_item":
        if (typeof action.collection === "string" && typeof action.id === "string" && isRecord(action.updates)) {
          valid.push(action as BrainAction);
        } else {
          warnInvalidAction(action, "update_collection_item collection/id/updates");
        }
        break;

      case "move_item":
        if (typeof action.fromCollection === "string" && typeof action.id === "string" && typeof action.toCollection === "string") {
          valid.push(action as BrainAction);
        } else {
          warnInvalidAction(action, "move_item from/id/to");
        }
        break;

      case "remove_from_collection":
        if (typeof action.collection === "string" && typeof action.id === "string") valid.push(action as BrainAction);
        else warnInvalidAction(action, "remove_from_collection collection/id");
        break;

      case "schedule_item":
        if (
          typeof action.content === "string"
          && isInboxItemType(action.itemType)
          && typeof action.activeAfter === "string"
        ) {
          valid.push(action as BrainAction);
        } else {
          warnInvalidAction(action, "schedule_item content/itemType/activeAfter");
        }
        break;

      case "announce":
        if (typeof action.message === "string" && isUrgency(action.urgency)) valid.push(action as BrainAction);
        else warnInvalidAction(action, "announce message/urgency");
        break;

      case "append_log":
        if (typeof action.summary === "string" && action.summary.trim()) valid.push(action as BrainAction);
        else warnInvalidAction(action, "append_log.summary");
        break;

      case "write_skill":
        if (typeof action.filename === "string" && typeof action.content === "string") valid.push(action as BrainAction);
        else warnInvalidAction(action, "write_skill filename/content");
        break;

      default:
        warnInvalidAction(action, `unknown type ${action.type}`);
        break;
    }
  }

  return valid;
}

async function callOpenRouter(systemPrompt: string): Promise<string> {
  const apiKey = process.env.OPEN_ROUTER_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPEN_ROUTER_KEY is not set");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  if (config.openRouterReferer) {
    headers["HTTP-Referer"] = config.openRouterReferer;
  }

  if (config.openRouterTitle) {
    headers["X-OpenRouter-Title"] = config.openRouterTitle;
  }

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: "Run your loop." }],
  };

  if (config.requireAnthropicProvider) {
    body.provider = {
      order: ["anthropic"],
      allow_fallbacks: false,
      data_collection: "deny",
    };
  }

  const response = await fetch(config.openRouterBaseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const rawBody = await response.text();
  let payload: {
    content?: Array<{ type: string; text?: string }>;
    error?: { message?: string } | string;
    message?: string;
  } | null = null;

  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody) as typeof payload;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errorMessage =
      (typeof payload?.error === "string" ? payload.error : payload?.error?.message) ??
      payload?.message ??
      rawBody.trim() ??
      `HTTP ${response.status}`;
    throw new Error(`OpenRouter ${response.status}: ${errorMessage}`);
  }

  const text = (payload?.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");

  if (!text) {
    throw new Error("OpenRouter returned no text blocks");
  }

  return text;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const runStart = new Date().toISOString();
  console.log(`\n[brain] ── run started at ${runStart} ──`);

  // Load core memory
  const core = readJSON<Memory>(join(MEMORY_DIR, "core.json"), {});

  // Load all collections via the index
  const collections = loadAllCollections();
  const tasks = (collections["tasks"]?.items ?? []) as Task[];

  // Load inbox (separate from collections — ephemeral capture queue)
  const inbox = readJSON<InboxItem[]>(join(MEMORY_DIR, "inbox.json"), []);

  // Surface any future log items whose activeAfter date has passed
  const matured = matureFutureItems(inbox);
  if (matured > 0) console.log(`[brain] ${matured} future item(s) matured into inbox`);

  // Load skills
  const skills = readSkills();

  // Log what we loaded
  const openCount = tasks.filter((t) => t.status === "open" || t.status === "in-progress").length;
  const futureCount = readJSON<FutureItem[]>(join(MEMORY_DIR, "future.json"), []).length;
  const collectionCounts = Object.entries(collections)
    .filter(([n]) => n !== "tasks" && n !== "future")
    .map(([n, c]) => `${n}:${c.count}`)
    .join(" ");
  console.log(`[brain] tasks: ${openCount} open | ${collectionCounts} | future: ${futureCount} | inbox: ${inbox.length}`);

  // Build system prompt
  const systemPrompt = buildSystemPrompt(core, collections, inbox, skills);

  // Call model via OpenRouter's Anthropic-compatible Messages endpoint
  let rawText = "";

  try {
    rawText = await callOpenRouter(systemPrompt);
  } catch (err) {
    console.error("[brain] API error:", err);
    process.exit(1);
  }

  // Parse response
  let brain: BrainResponse;
  try {
    const cleaned = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
    brain = JSON.parse(cleaned);
  } catch (err) {
    console.error("[brain] Failed to parse response JSON:", err);
    console.error("[brain] Raw output:\n", rawText);
    process.exit(1);
  }

  // Print thoughts
  if (config.verboseThoughts && brain.thoughts) {
    console.log("\n[brain] thoughts:\n");
    console.log(brain.thoughts.split("\n").map((l) => `  ${l}`).join("\n"));
    console.log();
  }

  // Execute actions — collections write themselves via the collections module.
  // We pass tasks in state so add/update/close task actions can mutate the array
  // before we write tasks.json back at the end.
  const actions = sanitizeActions(brain.actions);
  if (actions.length !== (Array.isArray(brain.actions) ? brain.actions.length : 0)) {
    console.warn(`[brain] kept ${actions.length} valid action(s) after validation`);
  }

  console.log(`[brain] executing ${actions.length} actions...`);
  const state = { core, tasks };
  await executeActions(actions, state);

  // Write back core memory and tasks (collections write themselves in executor)
  writeJSON(join(MEMORY_DIR, "core.json"), state.core);
  writeCollection("tasks", state.tasks);

  // Remove only the items we actually processed so new arrivals survive this run.
  const preservedInboxCount = clearProcessedInboxItems(inbox);
  if (preservedInboxCount > 0) {
    console.log(`[brain] preserved ${preservedInboxCount} inbox item(s) added during run`);
  }

  console.log(`[brain] ── run complete ──\n`);
}

main().catch((err) => {
  console.error("[brain] fatal:", err);
  process.exit(1);
});
