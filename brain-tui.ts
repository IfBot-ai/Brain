#!/usr/bin/env bun

import blessed from "blessed";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { addFutureItem, addInboxItem, ensureBrainProcessingNow } from "./inbox";
import { readDaemonState, type DaemonState } from "./daemon-state";
import type { InboxItem, InboxItemType, Memory } from "./types";

const ROOT = import.meta.dir;
const MEMORY_DIR = join(ROOT, "memory");
const PID_FILE = join(ROOT, ".daemon.pid");
const LOG_PATH = join(ROOT, "log.jsonl");

type SubmissionMode = "process-now" | "queue-only" | "schedule";
type FeedbackLevel = "info" | "success" | "warn" | "error";

interface FeedbackMessage {
  level: FeedbackLevel;
  message: string;
  expiresAt: number;
}

interface LogEntry {
  ts?: string;
  summary?: string;
}

const TYPE_OPTIONS: InboxItemType[] = ["task", "event", "note", "idea", "waiting", "reading"];
const MODE_OPTIONS: Array<{ label: string; value: SubmissionMode }> = [
  { label: "Process now", value: "process-now" },
  { label: "Queue only", value: "queue-only" },
  { label: "Schedule", value: "schedule" },
];

function readJSON<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;

  try {
    const pid = Number(readFileSync(PID_FILE, "utf8").trim());
    return pid || null;
  } catch {
    return null;
  }
}

function isPidRunning(pid: number | null): boolean {
  if (!pid) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getDaemonState(): DaemonState {
  const state = readDaemonState();
  const pid = readPid() ?? state.pid;
  if (!isPidRunning(pid)) {
    return {
      ...state,
      pid: null,
      status: "stopped",
      message: state.status === "stopped" ? state.message : "daemon not running",
      runReason: null,
      queuedRerun: false,
    };
  }

  return {
    ...state,
    pid,
  };
}

function ensureDaemonStartedOnLaunch() {
  const pid = readPid();
  if (isPidRunning(pid)) return;

  const processing = ensureBrainProcessingNow();
  setFeedback(`Started daemon PID ${processing.pid}.`, "success", 4000);
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";

  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);

  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleString();
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString();
}

function loadInboxCount(): number {
  return readJSON<InboxItem[]>(join(MEMORY_DIR, "inbox.json"), []).length;
}

function loadCore(): Memory {
  return readJSON<Memory>(join(MEMORY_DIR, "core.json"), {});
}

function loadLogEntries(limit = 150): LogEntry[] {
  if (!existsSync(LOG_PATH)) return [];

  const lines = readFileSync(LOG_PATH, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line) as LogEntry;
      } catch {
        return { summary: line };
      }
    });
}

function styleStatus(state: DaemonState): string {
  switch (state.status) {
    case "running":
      return `{yellow-fg}RUNNING{/yellow-fg}`;
    case "idle":
      return `{green-fg}IDLE{/green-fg}`;
    case "starting":
      return `{cyan-fg}STARTING{/cyan-fg}`;
    case "error":
      return `{red-fg}ERROR{/red-fg}`;
    default:
      return `{red-fg}STOPPED{/red-fg}`;
  }
}

function styleFeedback(level: FeedbackLevel, message: string): string {
  if (level === "success") return `{green-fg}${message}{/green-fg}`;
  if (level === "warn") return `{yellow-fg}${message}{/yellow-fg}`;
  if (level === "error") return `{red-fg}${message}{/red-fg}`;
  return `{cyan-fg}${message}{/cyan-fg}`;
}

if (process.argv.includes("--help")) {
  console.log("Usage: bun run tui");
  console.log("Keys: tab to move, ctrl+s submit, ctrl+r run, ctrl+d start/stop daemon, q to quit.");
  process.exit(0);
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("brain-tui requires an interactive terminal.");
  process.exit(1);
}

const screen = blessed.screen({
  smartCSR: true,
  fullUnicode: true,
  dockBorders: true,
  title: "brain daemon",
});

let feedback: FeedbackMessage | null = null;
let lastLogSignature = "";

const statusBox = blessed.box({
  parent: screen,
  top: 0,
  left: 0,
  width: "100%",
  height: 5,
  border: "line",
  tags: true,
  label: " Daemon ",
  style: {
    border: { fg: "cyan" },
  },
});

const composeBox = blessed.box({
  parent: screen,
  top: 5,
  left: 0,
  width: "60%",
  height: 15,
  border: "line",
  tags: true,
  label: " Input ",
  style: {
    border: { fg: "white" },
  },
});

const input = blessed.textarea({
  parent: composeBox,
  top: 0,
  left: 0,
  width: "100%-2",
  height: "100%-2",
  inputOnFocus: true,
  keys: true,
  mouse: true,
  vi: true,
  padding: {
    left: 1,
    right: 1,
  },
  scrollbar: {
    ch: " ",
    inverse: true,
  },
});

input.key("enter", () => {
  void submitEntry();
  return false;
});

const controlsBox = blessed.box({
  parent: screen,
  top: 5,
  left: "60%",
  width: "40%",
  height: 15,
  border: "line",
  tags: true,
  label: " Controls ",
  style: {
    border: { fg: "magenta" },
  },
});

blessed.box({
  parent: controlsBox,
  top: 0,
  left: 1,
  width: "48%",
  height: 1,
  content: "Type",
  style: { fg: "cyan" },
});

const typeList = blessed.list({
  parent: controlsBox,
  top: 1,
  left: 1,
  width: "48%",
  height: 7,
  keys: true,
  mouse: true,
  vi: true,
  border: "line",
  items: TYPE_OPTIONS,
  style: {
    selected: { bg: "cyan", fg: "black" },
    border: { fg: "cyan" },
  },
});
typeList.select(0);

blessed.box({
  parent: controlsBox,
  top: 0,
  left: "52%",
  width: "46%",
  height: 1,
  content: "Mode",
  style: { fg: "magenta" },
});

const modeList = blessed.list({
  parent: controlsBox,
  top: 1,
  left: "52%",
  width: "46%",
  height: 5,
  keys: true,
  mouse: true,
  vi: true,
  border: "line",
  items: MODE_OPTIONS.map((option) => option.label),
  style: {
    selected: { bg: "magenta", fg: "black" },
    border: { fg: "magenta" },
  },
});
modeList.select(0);

const dateLabel = blessed.box({
  parent: controlsBox,
  top: 6,
  left: "52%",
  width: "46%",
  height: 1,
  content: "Active after (YYYY-MM-DD)",
  style: { fg: "yellow" },
});

const dateInput = blessed.textbox({
  parent: controlsBox,
  top: 7,
  left: "52%",
  width: "46%",
  height: 3,
  inputOnFocus: true,
  keys: true,
  mouse: true,
  border: "line",
  style: {
    border: { fg: "yellow" },
  },
});

const submitButton = blessed.button({
  parent: controlsBox,
  top: 10,
  left: 1,
  width: "31%",
  height: 3,
  mouse: true,
  keys: true,
  align: "center",
  valign: "middle",
  content: "Submit",
  border: "line",
  style: {
    focus: { bg: "green", fg: "black" },
    hover: { bg: "green", fg: "black" },
    border: { fg: "green" },
  },
});

const runButton = blessed.button({
  parent: controlsBox,
  top: 10,
  left: "34%",
  width: "31%",
  height: 3,
  mouse: true,
  keys: true,
  align: "center",
  valign: "middle",
  content: "Run now",
  border: "line",
  style: {
    focus: { bg: "blue", fg: "white" },
    hover: { bg: "blue", fg: "white" },
    border: { fg: "blue" },
  },
});

const daemonButton = blessed.button({
  parent: controlsBox,
  top: 10,
  left: "67%",
  width: "31%",
  height: 3,
  mouse: true,
  keys: true,
  align: "center",
  valign: "middle",
  content: "Daemon",
  border: "line",
  style: {
    focus: { bg: "red", fg: "white" },
    hover: { bg: "red", fg: "white" },
    border: { fg: "red" },
  },
});

const logBox = blessed.box({
  parent: screen,
  top: 20,
  left: 0,
  width: "100%",
  height: "100%-20",
  border: "line",
  scrollable: true,
  alwaysScroll: true,
  keys: true,
  mouse: true,
  vi: true,
  tags: true,
  label: " Run Log ",
  scrollbar: {
    ch: " ",
    inverse: true,
  },
  style: {
    border: { fg: "green" },
  },
});

const focusables = [input, typeList, modeList, dateInput, submitButton, runButton, daemonButton];
let focusIndex = 0;

function setFeedback(message: string, level: FeedbackLevel = "info", ttlMs = 5000) {
  feedback = {
    level,
    message,
    expiresAt: Date.now() + ttlMs,
  };
}

function getSelectedType(): InboxItemType {
  return TYPE_OPTIONS[typeList.selected] ?? "task";
}

function getSelectedMode(): SubmissionMode {
  return MODE_OPTIONS[modeList.selected]?.value ?? "process-now";
}

function updateDateInputState() {
  const scheduled = getSelectedMode() === "schedule";
  dateLabel.style.fg = scheduled ? "yellow" : "gray";
  dateInput.style.border = { fg: scheduled ? "yellow" : "gray" };
}

function renderLog() {
  const entries = loadLogEntries();
  const signature = entries.map((entry) => `${entry.ts ?? ""}|${entry.summary ?? ""}`).join("\n");
  if (signature === lastLogSignature) {
    if (logBox.getScrollPerc() > 95) {
      logBox.setScrollPerc(100);
    }
    return;
  }

  lastLogSignature = signature;
  const lines = entries.map((entry) => {
    const stamp = entry.ts ? new Date(entry.ts).toLocaleString() : "no timestamp";
    const summary = entry.summary?.trim() || "(no summary recorded)";
    return `{gray-fg}${stamp}{/gray-fg}\n${summary}`;
  });

  logBox.setContent(lines.join("\n\n"));
  logBox.setScrollPerc(100);
}

function renderStatus() {
  const core = loadCore();
  const daemonState = getDaemonState();
  const inboxCount = loadInboxCount();
  const statusLine = `status ${styleStatus(daemonState)}   pid ${daemonState.pid ?? "none"}   inbox ${inboxCount}`;
  const focusLine = `focus ${core.currentFocus ? `{bold}${core.currentFocus as string}{/bold}` : "{gray-fg}none{/gray-fg}"}`;
  const lastRunLine = `last run ${formatTimestamp(daemonState.lastRunCompletedAt)}   started ${relativeTime(daemonState.startedAt)}`;

  let banner = daemonState.message;
  let bannerLevel: FeedbackLevel = daemonState.status === "error" ? "error" : "info";

  if (daemonState.status === "running") {
    banner = `daemon working: ${daemonState.message}`;
    bannerLevel = "warn";
  } else if (feedback && feedback.expiresAt > Date.now()) {
    banner = feedback.message;
    bannerLevel = feedback.level;
  } else if (daemonState.status === "idle") {
    banner = daemonState.lastExitCode === 0
      ? "daemon idle and ready"
      : daemonState.message || "daemon idle";
    bannerLevel = daemonState.lastExitCode === 0 ? "success" : "warn";
  } else if (daemonState.status === "stopped") {
    banner = "daemon stopped";
    bannerLevel = "warn";
  }

  statusBox.setContent([
    statusLine,
    focusLine,
    lastRunLine,
    styleFeedback(bannerLevel, banner),
  ].join("\n"));

  daemonButton.setContent(daemonState.status === "stopped" ? "Start daemon" : "Stop daemon");
}

async function submitEntry() {
  const content = input.getValue().trim();
  if (!content) {
    setFeedback("Enter text before submitting.", "error");
    render();
    return;
  }

  const type = getSelectedType();
  const mode = getSelectedMode();

  if (mode === "schedule") {
    const activeAfter = dateInput.getValue().trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(activeAfter)) {
      setFeedback("Schedule mode requires YYYY-MM-DD.", "error");
      render();
      return;
    }

    addFutureItem(content, type, activeAfter);
    input.setValue("");
    setFeedback(`Parked ${type} for ${activeAfter}.`, "success");
    render();
    return;
  }

  addInboxItem(content, type);

  if (mode === "queue-only") {
    input.setValue("");
    setFeedback(`Queued ${type} without waking the daemon.`, "success");
    render();
    return;
  }

  const processing = ensureBrainProcessingNow();
  input.setValue("");
  setFeedback(
    processing.mode === "daemon-signaled"
      ? `Queued ${type}; signaled daemon PID ${processing.pid}.`
      : `Queued ${type}; started daemon PID ${processing.pid}.`,
    "success"
  );
  render();
}

function runNow() {
  const processing = ensureBrainProcessingNow();
  setFeedback(
    processing.mode === "daemon-signaled"
      ? `Signaled daemon PID ${processing.pid} to run now.`
      : `Started daemon PID ${processing.pid} and triggered a run.`,
    "success"
  );
  render();
}

function toggleDaemon() {
  const pid = readPid();
  if (isPidRunning(pid)) {
    process.kill(pid!, "SIGTERM");
    setFeedback(`Sent SIGTERM to daemon PID ${pid}.`, "warn");
    render();
    return;
  }

  const processing = ensureBrainProcessingNow();
  setFeedback(`Started daemon PID ${processing.pid}.`, "success");
  render();
}

function render() {
  if (feedback && feedback.expiresAt <= Date.now()) {
    feedback = null;
  }

  updateDateInputState();
  renderStatus();
  renderLog();
  screen.render();
}

screen.key(["q", "C-c"], () => {
  screen.destroy();
  process.exit(0);
});

screen.key(["tab"], () => {
  focusIndex = (focusIndex + 1) % focusables.length;
  focusables[focusIndex].focus();
});

screen.key(["S-tab"], () => {
  focusIndex = (focusIndex - 1 + focusables.length) % focusables.length;
  focusables[focusIndex].focus();
});

screen.key(["C-s"], () => {
  void submitEntry();
});

screen.key(["C-r"], () => {
  runNow();
});

screen.key(["C-d"], () => {
  toggleDaemon();
});

modeList.on("select", () => {
  updateDateInputState();
  render();
});

submitButton.on("press", () => {
  void submitEntry();
});

runButton.on("press", () => {
  runNow();
});

daemonButton.on("press", () => {
  toggleDaemon();
});

input.focus();
ensureDaemonStartedOnLaunch();
render();
setInterval(render, 1_000);
