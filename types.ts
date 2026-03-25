// ─── Core memory ──────────────────────────────────────────────────────────────

export interface Memory {
  identity?: string;
  goals?: string[];
  currentFocus?: string;
  principles?: string[];
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export interface Task {
  id: string;
  title: string;
  priority: "high" | "medium" | "low";
  status: "open" | "in-progress" | "done" | "cancelled";
  notes?: string;
  linkedTo?: string[]; // e.g. ["projects:kaizen", "ideas:abc1234"]
  createdAt: string;
  updatedAt?: string;
}

// ─── Inbox ────────────────────────────────────────────────────────────────────

export type InboxItemType = "task" | "event" | "note" | "idea" | "waiting" | "reading";

export interface InboxItem {
  id: string;
  content: string;
  type: InboxItemType;
  addedAt: string;
}

// ─── Collections ──────────────────────────────────────────────────────────────

/** Base shape every collection item must have */
export interface CollectionItem {
  id: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  tags?: string[];
  linkedTo?: string[]; // cross-refs: "tasks:id" | "projects:slug" | "ideas:id"
}

export interface IdeaItem extends CollectionItem {
  status: "raw" | "developing" | "shelved" | "promoted";
  // "promoted" = moved into tasks or projects
}

export interface WaitingItem extends CollectionItem {
  waitingOn: string; // person or entity name
  dueBy?: string;    // ISO date — brain will announce when approaching
}

export interface ReadingItem extends CollectionItem {
  url?: string;
  status: "unread" | "in-progress" | "done" | "abandoned";
  notes?: string;
}

export interface ProjectItem extends CollectionItem {
  slug: string;       // short identifier used in linkedTo refs, e.g. "kaizen"
  status: "active" | "paused" | "done" | "cancelled";
  description?: string;
  goals?: string[];
}

export type AnyCollectionItem = IdeaItem | WaitingItem | ReadingItem | ProjectItem;

// ─── Future log ───────────────────────────────────────────────────────────────

/**
 * A parked item that becomes visible only when activeAfter <= now.
 * On each loop run, matured items are injected into the inbox automatically.
 * Future items are NOT shown to Claude in normal context — they're invisible
 * until they ripen.
 */
export interface FutureItem {
  id: string;
  content: string;
  type: InboxItemType;    // what it becomes when it surfaces
  activeAfter: string;    // ISO date string — surfaces when this date passes
  notes?: string;
  createdAt: string;
}

// ─── Index ────────────────────────────────────────────────────────────────────

export interface CollectionMeta {
  file: string;        // path relative to brain root, e.g. "memory/ideas.json"
  description: string;
  count: number;
  lastUpdated: string;
}

export interface BrainIndex {
  collections: Record<string, CollectionMeta>;
  lastUpdated: string;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export interface UpdateMemoryAction {
  type: "update_memory";
  key: string;
  value: unknown;
}

export interface AddTaskAction {
  type: "add_task";
  title: string;
  priority: Task["priority"];
  notes?: string;
  linkedTo?: string[];
}

export interface UpdateTaskAction {
  type: "update_task";
  id: string;
  updates: Partial<Pick<Task, "title" | "priority" | "status" | "notes" | "linkedTo">>;
}

export interface CloseTaskAction {
  type: "close_task";
  id: string;
  resolution?: string;
}

export interface AddToCollectionAction {
  type: "add_to_collection";
  collection: string;                              // "ideas" | "waiting" | "reading" | "projects"
  item: Omit<AnyCollectionItem, "id" | "createdAt">;
}

export interface UpdateCollectionItemAction {
  type: "update_collection_item";
  collection: string;
  id: string;
  updates: Partial<AnyCollectionItem>;
}

export interface MoveItemAction {
  type: "move_item";
  fromCollection: string;
  id: string;
  toCollection: string;
  transform?: Partial<AnyCollectionItem>; // optional field overrides after move
}

export interface RemoveFromCollectionAction {
  type: "remove_from_collection";
  collection: string;
  id: string;
  reason?: string;
}

export interface ScheduleItemAction {
  type: "schedule_item";
  content: string;
  itemType: InboxItemType; // what it becomes when it surfaces
  activeAfter: string;     // ISO date string: "2026-05-01"
  notes?: string;
}

export interface AnnounceAction {
  type: "announce";
  message: string;
  urgency: "low" | "medium" | "high";
}

export interface AppendLogAction {
  type: "append_log";
  summary: string;
}

export interface WriteSkillAction {
  type: "write_skill";
  filename: string;
  content: string;
}

export type BrainAction =
  | UpdateMemoryAction
  | AddTaskAction
  | UpdateTaskAction
  | CloseTaskAction
  | AddToCollectionAction
  | UpdateCollectionItemAction
  | MoveItemAction
  | RemoveFromCollectionAction
  | ScheduleItemAction
  | AnnounceAction
  | AppendLogAction
  | WriteSkillAction;

// ─── Response ─────────────────────────────────────────────────────────────────

export interface BrainResponse {
  thoughts: string;
  actions: BrainAction[];
}
