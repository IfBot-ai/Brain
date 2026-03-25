import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import type { InboxItem, InboxItemType, FutureItem } from "./types";

const ROOT = import.meta.dir;
const MEMORY_DIR = join(ROOT, "memory");
const INBOX_PATH = join(MEMORY_DIR, "inbox.json");
const FUTURE_PATH = join(MEMORY_DIR, "future.json");
const PID_FILE = join(ROOT, ".daemon.pid");
const LOCK_DIR = join(MEMORY_DIR, ".locks");

export interface ProcessingTriggerResult {
  mode: "daemon-signaled" | "daemon-started";
  pid: number;
}

function readJSON<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(path: string, value: unknown) {
  mkdirSync(LOCK_DIR, { recursive: true });
  const tempPath = join(LOCK_DIR, `${path.split("/").pop()}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n");
  renameSync(tempPath, path);
}

function sleepMs(ms: number) {
  Bun.sleepSync(ms);
}

function withFileLock<T>(path: string, fn: () => T): T {
  mkdirSync(LOCK_DIR, { recursive: true });
  const lockPath = join(LOCK_DIR, `${path.split("/").pop()}.lock`);
  const startedAt = Date.now();

  while (true) {
    try {
      mkdirSync(lockPath);
      break;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
        throw error;
      }

      if (Date.now() - startedAt > 2_000) {
        throw new Error(`Timed out waiting for inbox lock: ${lockPath}`);
      }

      sleepMs(10);
    }
  }

  try {
    return fn();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

function randomId() {
  return Math.random().toString(36).slice(2, 9);
}

export function addInboxItem(content: string, type: InboxItemType = "task"): InboxItem {
  mkdirSync(MEMORY_DIR, { recursive: true });
  return withFileLock(INBOX_PATH, () => {
    const inbox = readJSON<InboxItem[]>(INBOX_PATH, []);
    const item: InboxItem = {
      id: randomId(),
      content,
      type,
      addedAt: new Date().toISOString(),
    };

    inbox.push(item);
    writeJSON(INBOX_PATH, inbox);
    return item;
  });
}

export function addFutureItem(
  content: string,
  type: InboxItemType,
  activeAfter: string,
  notes?: string
): FutureItem {
  mkdirSync(MEMORY_DIR, { recursive: true });
  return withFileLock(FUTURE_PATH, () => {
    const future = readJSON<FutureItem[]>(FUTURE_PATH, []);
    const item: FutureItem = {
      id: randomId(),
      content,
      type,
      activeAfter,
      notes,
      createdAt: new Date().toISOString(),
    };

    future.push(item);
    writeJSON(FUTURE_PATH, future);
    return item;
  });
}

export function signalDaemonIfRunning(): number | null {
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
    if (!pid) return null;
    process.kill(pid, 0);
    process.kill(pid, "SIGUSR1");
    return pid;
  } catch {
    return null;
  }
}

export function ensureBrainProcessingNow(): ProcessingTriggerResult {
  const runningPid = signalDaemonIfRunning();
  if (runningPid) {
    return {
      mode: "daemon-signaled",
      pid: runningPid,
    };
  }

  const proc = Bun.spawn([process.execPath, "run", join(ROOT, "daemon.ts")], {
    cwd: ROOT,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    detached: true,
  });

  return {
    mode: "daemon-started",
    pid: proc.pid,
  };
}
