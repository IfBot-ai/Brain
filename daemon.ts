#!/usr/bin/env bun

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { createInterface, type Interface } from "readline";
import config from "./config";
import { addInboxItem } from "./inbox";
import { readDaemonState, resetDaemonState, updateDaemonState, writeDaemonState } from "./daemon-state";

const ROOT = import.meta.dir;
const PID_FILE = join(ROOT, ".daemon.pid");

let running = false;
let rerunRequested = false;
let timer: ReturnType<typeof setInterval> | null = null;
let rl: Interface | null = null;

function claimPidFile() {
  if (!existsSync(PID_FILE)) {
    writeFileSync(PID_FILE, `${process.pid}\n`);
    return;
  }

  try {
    const existingPid = Number(readFileSync(PID_FILE, "utf8").trim());
    if (existingPid && existingPid !== process.pid) {
      process.kill(existingPid, 0);
      console.error(`[daemon] another daemon is already running (PID ${existingPid})`);
      process.exit(1);
    }
  } catch {
    // stale or unreadable PID file; overwrite it below
  }

  writeFileSync(PID_FILE, `${process.pid}\n`);
}

function cleanup() {
  if (!existsSync(PID_FILE)) return;

  try {
    const pid = Number(readFileSync(PID_FILE, "utf8").trim());
    if (!pid || pid === process.pid) {
      resetDaemonState("daemon stopped");
      unlinkSync(PID_FILE);
    }
  } catch {
    resetDaemonState("daemon stopped");
    unlinkSync(PID_FILE);
  }
}

function canPromptForInbox(): boolean {
  const disablePrompt = process.env.BRAIN_DAEMON_NO_PROMPT?.trim().toLowerCase();
  if (disablePrompt && ["1", "true", "yes", "on"].includes(disablePrompt)) return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function showPrompt() {
  rl?.prompt();
}

function queueInboxItem(content: string) {
  addInboxItem(content, "task");
  console.log(`[daemon] queued inbox item: "${content}"`);
}

function requestRerun(reason: string) {
  rerunRequested = true;
  updateDaemonState({
    pid: process.pid,
    status: "running",
    message: `queued ${reason}; loop already running`,
    queuedRerun: true,
  });
  console.log(`[daemon] queued ${reason}; loop already running`);
}

function startInteractiveInbox() {
  if (!canPromptForInbox()) {
    console.log("[daemon] non-interactive session; live inbox prompt disabled");
    return;
  }

  rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "[daemon] > ",
  });

  rl.on("line", (line) => {
    const content = line.trim();
    if (!content) {
      showPrompt();
      return;
    }

    queueInboxItem(content);
    if (running) {
      requestRerun("interactive input");
      showPrompt();
      return;
    }

    void runLoop("interactive input");
    showPrompt();
  });

  rl.on("close", () => {
    rl = null;
  });

  console.log("[daemon] interactive inbox ready; type a line and press Enter to queue it");
  showPrompt();
}

async function runLoop(reason: string) {
  if (running) {
    requestRerun(reason);
    return;
  }

  running = true;
  let nextReason = reason;

  try {
    do {
      rerunRequested = false;
      updateDaemonState({
        pid: process.pid,
        status: "running",
        message: `running loop (${nextReason})`,
        runReason: nextReason,
        queuedRerun: false,
        lastRunStartedAt: new Date().toISOString(),
      });
      console.log(`[daemon] running loop (${nextReason})`);
      const proc = Bun.spawn([process.execPath, "run", join(ROOT, "loop.ts")], {
        cwd: ROOT,
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await proc.exited;
      updateDaemonState({
        pid: process.pid,
        status: exitCode === 0 ? "idle" : "error",
        message: `loop finished with exit code ${exitCode}`,
        runReason: null,
        queuedRerun: rerunRequested,
        lastRunCompletedAt: new Date().toISOString(),
        lastExitCode: exitCode,
      });
      console.log(`[daemon] loop finished with exit code ${exitCode}`);
      nextReason = "queued";
    } while (rerunRequested);
  } catch (error) {
    updateDaemonState({
      pid: process.pid,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      runReason: nextReason,
      queuedRerun: rerunRequested,
      lastRunCompletedAt: new Date().toISOString(),
    });
    throw error;
  } finally {
    running = false;
    if (rerunRequested) {
      updateDaemonState({
        pid: process.pid,
        status: "running",
        message: "queued follow-up run",
        runReason: "queued",
        queuedRerun: true,
      });
    } else {
      const lastExitCode = readDaemonState().lastExitCode;
      updateDaemonState({
        pid: process.pid,
        status: lastExitCode === 0 ? "idle" : "error",
        runReason: null,
        queuedRerun: false,
      });
    }
    showPrompt();
  }
}

function shutdown(signal: string) {
  resetDaemonState(`daemon shutting down on ${signal}`);
  console.log(`[daemon] shutting down on ${signal}`);
  if (timer) clearInterval(timer);
  rl?.close();
  cleanup();
  process.exit(0);
}

process.on("SIGUSR1", () => {
  console.log("[daemon] received SIGUSR1");
  void runLoop("signal");
});

process.on("exit", cleanup);
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

claimPidFile();
writeDaemonState({
  pid: process.pid,
  status: "starting",
  message: "daemon booting",
  runReason: null,
  queuedRerun: false,
  startedAt: new Date().toISOString(),
  lastRunStartedAt: null,
  lastRunCompletedAt: null,
  lastExitCode: null,
  updatedAt: new Date().toISOString(),
});

console.log(`[daemon] started with PID ${process.pid}`);
console.log(`[daemon] interval ${config.intervalMinutes} minute(s)`);
startInteractiveInbox();

timer = setInterval(() => {
  void runLoop("interval");
}, config.intervalMinutes * 60_000);

void runLoop("startup");
