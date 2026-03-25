import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "fs";
import { basename, join } from "path";

const ROOT = import.meta.dir;
const STATE_DIR = join(ROOT, "memory", ".locks");
const STATE_PATH = join(ROOT, ".daemon-state.json");

export type DaemonStatus = "starting" | "idle" | "running" | "error" | "stopped";

export interface DaemonState {
  pid: number | null;
  status: DaemonStatus;
  message: string;
  runReason: string | null;
  queuedRerun: boolean;
  startedAt: string | null;
  lastRunStartedAt: string | null;
  lastRunCompletedAt: string | null;
  lastExitCode: number | null;
  updatedAt: string;
}

export function getDefaultDaemonState(message = "daemon not running"): DaemonState {
  return {
    pid: null,
    status: "stopped",
    message,
    runReason: null,
    queuedRerun: false,
    startedAt: null,
    lastRunStartedAt: null,
    lastRunCompletedAt: null,
    lastExitCode: null,
    updatedAt: new Date().toISOString(),
  };
}

export function readDaemonState(): DaemonState {
  if (!existsSync(STATE_PATH)) return getDefaultDaemonState();

  try {
    const state = JSON.parse(readFileSync(STATE_PATH, "utf8")) as Partial<DaemonState>;
    return {
      ...getDefaultDaemonState(),
      ...state,
      updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : new Date().toISOString(),
    };
  } catch {
    return getDefaultDaemonState("daemon state unreadable");
  }
}

function writeStateFile(state: DaemonState) {
  mkdirSync(STATE_DIR, { recursive: true });
  const tempPath = join(STATE_DIR, `${basename(STATE_PATH)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tempPath, JSON.stringify(state, null, 2) + "\n");
  renameSync(tempPath, STATE_PATH);
}

export function writeDaemonState(state: DaemonState) {
  writeStateFile({
    ...state,
    updatedAt: new Date().toISOString(),
  });
}

export function updateDaemonState(updates: Partial<DaemonState>) {
  writeDaemonState({
    ...readDaemonState(),
    ...updates,
  });
}

export function resetDaemonState(message = "daemon stopped") {
  writeDaemonState(getDefaultDaemonState(message));
}
