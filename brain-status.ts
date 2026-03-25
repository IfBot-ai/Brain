#!/usr/bin/env bun
/**
 * brain-status.ts — read-only terminal dashboard
 *
 * Usage:
 *   bun run status           # full dashboard
 *   bun run status --tasks   # tasks only
 *   bun run status --log     # recent log entries
 *   bun run status --future  # future log items
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { Memory, Task, InboxItem, FutureItem, WaitingItem, IdeaItem, ReadingItem, ProjectItem } from "./types";

const ROOT = import.meta.dir;

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const c = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  blue:    "\x1b[34m",
  magenta: "\x1b[35m",
  cyan:    "\x1b[36m",
  white:   "\x1b[37m",
  gray:    "\x1b[90m",
  bgRed:   "\x1b[41m",
  bgBlue:  "\x1b[44m",
};

const bold   = (s: string) => `${c.bold}${s}${c.reset}`;
const dim    = (s: string) => `${c.dim}${s}${c.reset}`;
const red    = (s: string) => `${c.red}${s}${c.reset}`;
const yellow = (s: string) => `${c.yellow}${s}${c.reset}`;
const green  = (s: string) => `${c.green}${s}${c.reset}`;
const cyan   = (s: string) => `${c.cyan}${s}${c.reset}`;
const blue   = (s: string) => `${c.blue}${s}${c.reset}`;
const magenta= (s: string) => `${c.magenta}${s}${c.reset}`;
const gray   = (s: string) => `${c.gray}${s}${c.reset}`;

// ─── File helpers ─────────────────────────────────────────────────────────────

function readJSON<T>(path: string, fallback: T): T {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; }
  catch { return fallback; }
}

function memPath(f: string) { return join(ROOT, "memory", f); }

function relativeTime(iso: string): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  <  2) return "just now";
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  <  7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function rule(char = "─", width = 60): string {
  return gray(char.repeat(width));
}

function section(title: string, extra = ""): void {
  console.log();
  console.log(`${bold(title)}${extra ? "  " + dim(extra) : ""}`);
  console.log(rule());
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function printHeader(core: Memory) {
  const pidFile = join(ROOT, ".daemon.pid");
  let daemonStatus = red("● stopped");
  if (existsSync(pidFile)) {
    try {
      const pid = parseInt(readFileSync(pidFile, "utf8").trim());
      process.kill(pid, 0); // throws if not running
      daemonStatus = green(`● running`) + gray(` (PID ${pid})`);
    } catch { /* pid stale */ }
  }

  // Last run from log
  const logPath = join(ROOT, "log.jsonl");
  let lastRun = "never";
  if (existsSync(logPath)) {
    const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
    if (lines.length > 0) {
      try {
        const last = JSON.parse(lines[lines.length - 1]);
        lastRun = relativeTime(last.ts);
      } catch {}
    }
  }

  console.log();
  console.log(bold(`🧠  brain`));
  console.log(rule("─", 60));
  console.log(`  daemon   ${daemonStatus}`);
  console.log(`  last run ${cyan(lastRun)}`);
  if (core.currentFocus) {
    console.log(`  focus    ${bold(core.currentFocus as string)}`);
  }
  if (Array.isArray(core.goals) && core.goals.length > 0) {
    console.log(`  goals    ${dim((core.goals as string[]).slice(0, 2).join("  ·  "))}`);
  }
}

function priorityLabel(p: Task["priority"]): string {
  if (p === "high")   return red("▲ high  ");
  if (p === "medium") return yellow("● med   ");
  return gray("▽ low   ");
}

function statusLabel(s: Task["status"]): string {
  if (s === "in-progress") return cyan("→ ");
  return "  ";
}

function printTasks(tasks: Task[]) {
  const open = tasks.filter(t => t.status === "open" || t.status === "in-progress");

  section("Tasks", `${open.length} open`);

  if (open.length === 0) {
    console.log(dim("  (no open tasks)"));
    return;
  }

  const order: Task["priority"][] = ["high", "medium", "low"];
  for (const priority of order) {
    const group = open.filter(t => t.priority === priority);
    if (group.length === 0) continue;

    for (const t of group) {
      const age = t.updatedAt
        ? relativeTime(t.updatedAt)
        : relativeTime(t.createdAt);
      const stale = !t.updatedAt && daysUntil(t.createdAt) < -14;
      const ageStr = stale ? red(age) : gray(age);
      const linked = t.linkedTo?.length ? dim(` [${t.linkedTo.join(", ")}]`) : "";
      console.log(
        `  ${statusLabel(t.status)}${priorityLabel(t.priority)}` +
        `${truncate(t.title, 44)}${linked}  ${ageStr}`
      );
      if (t.notes) {
        const firstLine = t.notes.split("\n")[0];
        console.log(`         ${dim(truncate(firstLine, 54))}`);
      }
    }
  }

  // Stale warning
  const staleCount = open.filter(t => {
    const ref = t.updatedAt ?? t.createdAt;
    return daysUntil(ref) < -14;
  }).length;
  if (staleCount > 0) {
    console.log();
    console.log(yellow(`  ⚠  ${staleCount} task(s) untouched for 14+ days`));
  }
}

function printIdeas(ideas: IdeaItem[]) {
  if (ideas.length === 0) return;
  const active = ideas.filter(i => i.status !== "shelved" && i.status !== "promoted");
  if (active.length === 0) return;

  section("Ideas", `${active.length} active`);

  for (const idea of active) {
    const statusColor =
      idea.status === "developing" ? cyan(idea.status) :
      idea.status === "raw"        ? gray(idea.status)  : dim(idea.status);
    console.log(`  ${statusColor.padEnd(18)}  ${truncate(idea.content, 50)}`);
  }
}

function printWaiting(waiting: WaitingItem[]) {
  if (waiting.length === 0) return;
  const open = waiting.filter(w => !(w as any).resolved);
  if (open.length === 0) return;

  section("Waiting", `${open.length} items`);

  for (const w of open) {
    const due = w.dueBy ? daysUntil(w.dueBy) : null;
    let dueStr = "";
    if (due !== null) {
      if (due < 0)  dueStr = red(` (overdue ${Math.abs(due)}d)`);
      else if (due <= 3) dueStr = yellow(` (due in ${due}d)`);
      else dueStr = gray(` (due ${new Date(w.dueBy!).toLocaleDateString()})`);
    }
    console.log(`  ${cyan(truncate(w.waitingOn, 14).padEnd(16))}  ${truncate(w.content, 40)}${dueStr}`);
  }
}

function printReading(reading: ReadingItem[]) {
  const unread = reading.filter(r => r.status === "unread" || r.status === "in-progress");
  if (unread.length === 0) return;

  section("Reading", `${unread.length} queued`);

  for (const r of unread) {
    const statusStr = r.status === "in-progress" ? cyan("→ ") : "  ";
    const urlStr = r.url ? dim(` ${truncate(r.url.replace(/^https?:\/\//, ""), 36)}`) : "";
    console.log(`  ${statusStr}${truncate(r.content, 48)}${urlStr}`);
  }
}

function printProjects(projects: ProjectItem[]) {
  const active = projects.filter(p => p.status === "active" || p.status === "paused");
  if (active.length === 0) return;

  section("Projects", `${active.length} active`);

  for (const p of active) {
    const statusStr = p.status === "paused" ? yellow("⏸  ") : green("▶  ");
    const slug = p.slug ? gray(` [${p.slug}]`) : "";
    console.log(`  ${statusStr}${bold(truncate(p.content, 40))}${slug}`);
    if (p.description) {
      console.log(`       ${dim(truncate(p.description, 52))}`);
    }
  }
}

function printFuture(future: FutureItem[]) {
  if (future.length === 0) return;

  // Sort by activeAfter
  const sorted = [...future].sort((a, b) =>
    new Date(a.activeAfter).getTime() - new Date(b.activeAfter).getTime()
  );

  section("Future log", `${future.length} parked`);

  for (const f of sorted) {
    const days = daysUntil(f.activeAfter);
    const dateStr = new Date(f.activeAfter).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const daysStr = days <= 0
      ? red("(ready to surface)")
      : days <= 7
        ? yellow(`in ${days}d`)
        : gray(`in ${days}d`);
    const typeStr = gray(`[${f.type}]`);
    console.log(`  ${blue(dateStr.padEnd(14))}  ${daysStr.padEnd(12)}  ${typeStr.padEnd(12)}  ${truncate(f.content, 36)}`);
  }
}

function printInbox(inbox: InboxItem[]) {
  if (inbox.length === 0) return;

  section("Inbox", `${inbox.length} unprocessed`);

  for (const item of inbox) {
    const typeStr = magenta(`[${item.type}]`.padEnd(10));
    console.log(`  ${typeStr}  ${truncate(item.content, 52)}`);
  }
  console.log();
  console.log(yellow(`  ↑ these will be processed on next loop run`));
}

function printRecentLog(n = 8) {
  const logPath = join(ROOT, "log.jsonl");
  if (!existsSync(logPath)) return;

  const lines = readFileSync(logPath, "utf8")
    .trim().split("\n")
    .filter(Boolean)
    .slice(-n)
    .reverse();

  if (lines.length === 0) return;

  section("Recent runs");

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const ts = relativeTime(entry.ts);
      console.log(`  ${gray(ts.padEnd(12))}  ${truncate(entry.summary ?? "", 52)}`);
    } catch {}
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const flags = new Set(process.argv.slice(2));
const filterTasks   = flags.has("--tasks");
const filterLog     = flags.has("--log");
const filterFuture  = flags.has("--future");
const showAll       = !filterTasks && !filterLog && !filterFuture;

const core     = readJSON<Memory>(memPath("core.json"), {});
const tasks    = readJSON<Task[]>(memPath("tasks.json"), []);
const ideas    = readJSON<IdeaItem[]>(memPath("ideas.json"), []);
const waiting  = readJSON<WaitingItem[]>(memPath("waiting.json"), []);
const reading  = readJSON<ReadingItem[]>(memPath("reading.json"), []);
const projects = readJSON<ProjectItem[]>(memPath("projects.json"), []);
const future   = readJSON<FutureItem[]>(memPath("future.json"), []);
const inbox    = readJSON<InboxItem[]>(memPath("inbox.json"), []);

if (showAll || filterTasks) {
  printHeader(core);
  printTasks(tasks);
}

if (showAll) {
  printProjects(projects);
  printWaiting(waiting);
  printIdeas(ideas);
  printReading(reading);
}

if (showAll || filterFuture) {
  printFuture(future);
}

if (showAll && inbox.length > 0) {
  printInbox(inbox);
}

if (showAll || filterLog) {
  printRecentLog(showAll ? 6 : 20);
}

console.log();
