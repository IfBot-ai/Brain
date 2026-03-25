import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import type {
  AnyCollectionItem,
  BrainIndex,
  CollectionMeta,
  FutureItem,
  InboxItem,
  Memory,
  Task,
} from "./types";

export type CollectionName = "tasks" | "ideas" | "waiting" | "reading" | "projects" | "future";
type StoredValue = Task | AnyCollectionItem | FutureItem;
type StoredMap = Record<CollectionName, StoredValue[]>;
type LooseRecord = Record<string, unknown>;

export interface LoadedCollection<T = StoredValue> extends CollectionMeta {
  items: T[];
}

const ROOT = import.meta.dir;
export const MEMORY_DIR = join(ROOT, "memory");
const INDEX_PATH = join(MEMORY_DIR, "index.json");
const CORE_PATH = join(MEMORY_DIR, "core.json");
const INBOX_PATH = join(MEMORY_DIR, "inbox.json");
const LOG_PATH = join(ROOT, "log.jsonl");
const TEMPLATE_DIR = join(ROOT, "templates");
const MEMORY_TEMPLATE_DIR = join(TEMPLATE_DIR, "memory");

const COLLECTION_SPECS: Record<CollectionName, { file: string; description: string }> = {
  tasks: {
    file: "tasks.json",
    description: "Active work items.",
  },
  ideas: {
    file: "ideas.json",
    description: "Raw ideas and developing thoughts.",
  },
  waiting: {
    file: "waiting.json",
    description: "Items blocked on other people or events.",
  },
  reading: {
    file: "reading.json",
    description: "Reading queue and notes.",
  },
  projects: {
    file: "projects.json",
    description: "Project contexts linked to work.",
  },
  future: {
    file: "future.json",
    description: "Future log items that surface later.",
  },
};

const DEFAULT_CORE: Memory = {
  identity: "Owner of this brain loop.",
  goals: [],
  principles: [
    "Prefer clear, concrete actions over vague intentions.",
    "Keep the system honest and current.",
  ],
  context: {},
};

function readJSON<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function writeIfMissingFromTemplate(path: string, templatePath: string, fallback: unknown) {
  if (existsSync(path)) return;
  if (existsSync(templatePath)) {
    writeFileSync(path, readFileSync(templatePath, "utf8"));
    return;
  }
  writeJSON(path, fallback);
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function taskPriority(value: unknown): Task["priority"] {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function taskStatus(value: unknown): Task["status"] {
  return value === "open" || value === "in-progress" || value === "done" || value === "cancelled"
    ? value
    : "open";
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || nanoid();
}

function withBase(item: LooseRecord, now: string): LooseRecord {
  return {
    ...item,
    id: toOptionalString(item.id) ?? nanoid(),
    createdAt: toOptionalString(item.createdAt) ?? now,
    updatedAt: toOptionalString(item.updatedAt),
    linkedTo: toStringArray(item.linkedTo),
    tags: toStringArray(item.tags),
  };
}

function toTask(item: LooseRecord, now = new Date().toISOString()): Task {
  return {
    id: toOptionalString(item.id) ?? nanoid(),
    title: toOptionalString(item.title) ?? toOptionalString(item.content) ?? "Untitled task",
    priority: taskPriority(item.priority),
    status: taskStatus(item.status),
    notes: toOptionalString(item.notes),
    linkedTo: toStringArray(item.linkedTo),
    createdAt: toOptionalString(item.createdAt) ?? now,
    updatedAt: toOptionalString(item.updatedAt),
  };
}

function toIdea(item: LooseRecord, now = new Date().toISOString()) {
  const base = withBase(item, now);
  return {
    ...base,
    content: toOptionalString(item.content) ?? toOptionalString(item.title) ?? "Untitled idea",
    status: item.status === "developing" || item.status === "shelved" || item.status === "promoted"
      ? item.status
      : "raw",
  };
}

function toWaiting(item: LooseRecord, now = new Date().toISOString()) {
  const base = withBase(item, now);
  return {
    ...base,
    content: toOptionalString(item.content) ?? toOptionalString(item.title) ?? "Untitled waiting item",
    waitingOn: toOptionalString(item.waitingOn) ?? "unknown",
    dueBy: toOptionalString(item.dueBy),
  };
}

function toReading(item: LooseRecord, now = new Date().toISOString()) {
  const base = withBase(item, now);
  const url = toOptionalString(item.url);
  return {
    ...base,
    content: toOptionalString(item.content) ?? url ?? "Untitled reading item",
    url,
    status: item.status === "in-progress" || item.status === "done" || item.status === "abandoned"
      ? item.status
      : "unread",
    notes: toOptionalString(item.notes),
  };
}

function toProject(item: LooseRecord, now = new Date().toISOString()) {
  const base = withBase(item, now);
  const content = toOptionalString(item.content) ?? toOptionalString(item.title) ?? "Untitled project";
  return {
    ...base,
    content,
    slug: toOptionalString(item.slug) ?? slugify(content),
    status: item.status === "paused" || item.status === "done" || item.status === "cancelled"
      ? item.status
      : "active",
    description: toOptionalString(item.description),
    goals: Array.isArray(item.goals)
      ? item.goals.filter((goal): goal is string => typeof goal === "string" && goal.trim().length > 0)
      : undefined,
  };
}

function toFuture(item: LooseRecord, now = new Date().toISOString()): FutureItem {
  return {
    id: toOptionalString(item.id) ?? nanoid(),
    content: toOptionalString(item.content) ?? toOptionalString(item.title) ?? "Untitled future item",
    type: item.type === "reading" || item.type === "task" || item.type === "event" || item.type === "note" || item.type === "idea" || item.type === "waiting"
      ? item.type
      : "task",
    activeAfter: toOptionalString(item.activeAfter) ?? now.slice(0, 10),
    notes: toOptionalString(item.notes),
    createdAt: toOptionalString(item.createdAt) ?? now,
  };
}

function normalizeCollectionValue(name: CollectionName, item: LooseRecord, now = new Date().toISOString()): StoredValue {
  switch (name) {
    case "tasks":
      return toTask(item, now);
    case "ideas":
      return toIdea(item, now);
    case "waiting":
      return toWaiting(item, now);
    case "reading":
      return toReading(item, now);
    case "projects":
      return toProject(item, now);
    case "future":
      return toFuture(item, now);
  }
}

function pathFor(name: CollectionName): string {
  return join(MEMORY_DIR, COLLECTION_SPECS[name].file);
}

function defaultIndex(collections: StoredMap): BrainIndex {
  const now = new Date().toISOString();
  return {
    collections: Object.fromEntries(
      (Object.keys(COLLECTION_SPECS) as CollectionName[]).map((name) => {
        const items = collections[name] ?? [];
        const path = pathFor(name);
        const lastUpdated = items.length > 0
          ? items
              .map((item) => {
                const record = item as LooseRecord;
                return toOptionalString(record.updatedAt) ?? toOptionalString(record.createdAt) ?? now;
              })
              .sort()
              .at(-1) ?? now
          : (existsSync(path) ? statSync(path).mtime.toISOString() : now);

        return [
          name,
          {
            file: `memory/${COLLECTION_SPECS[name].file}`,
            description: COLLECTION_SPECS[name].description,
            count: items.length,
            lastUpdated,
          },
        ];
      })
    ) as BrainIndex["collections"],
    lastUpdated: now,
  };
}

function syncIndex() {
  const collections = {} as StoredMap;
  for (const name of Object.keys(COLLECTION_SPECS) as CollectionName[]) {
    collections[name] = readJSON<StoredValue[]>(pathFor(name), []);
  }
  writeJSON(INDEX_PATH, defaultIndex(collections));
}

export function ensureScaffold() {
  mkdirSync(MEMORY_DIR, { recursive: true });
  writeIfMissingFromTemplate(CORE_PATH, join(MEMORY_TEMPLATE_DIR, "core.json"), DEFAULT_CORE);
  writeIfMissingFromTemplate(INBOX_PATH, join(MEMORY_TEMPLATE_DIR, "inbox.json"), [] as InboxItem[]);

  for (const name of Object.keys(COLLECTION_SPECS) as CollectionName[]) {
    writeIfMissingFromTemplate(pathFor(name), join(MEMORY_TEMPLATE_DIR, COLLECTION_SPECS[name].file), []);
  }

  if (!existsSync(LOG_PATH)) {
    writeFileSync(LOG_PATH, "");
  }

  if (!existsSync(INDEX_PATH)) {
    writeIfMissingFromTemplate(INDEX_PATH, join(MEMORY_TEMPLATE_DIR, "index.json"), defaultIndex({
      tasks: [],
      ideas: [],
      waiting: [],
      reading: [],
      projects: [],
      future: [],
    }));
  }
}

export function nanoid(): string {
  return Math.random().toString(36).slice(2, 9);
}

export function readCollection<T extends StoredValue = StoredValue>(name: CollectionName): T[] {
  ensureScaffold();
  const items = readJSON<LooseRecord[]>(pathFor(name), []);
  return items.map((item) => normalizeCollectionValue(name, item) as T);
}

export function writeCollection<T extends StoredValue = StoredValue>(name: CollectionName, items: T[]): T[] {
  ensureScaffold();
  const normalized = items.map((item) => normalizeCollectionValue(name, item as LooseRecord));
  writeJSON(pathFor(name), normalized);
  syncIndex();
  return normalized as T[];
}

export function loadAllCollections(): Record<CollectionName, LoadedCollection> {
  ensureScaffold();
  const index = readJSON<BrainIndex>(INDEX_PATH, { collections: {}, lastUpdated: new Date().toISOString() });
  const loaded = {} as Record<CollectionName, LoadedCollection>;

  for (const name of Object.keys(COLLECTION_SPECS) as CollectionName[]) {
    const items = readCollection(name);
    const meta = index.collections[name] ?? {
      file: `memory/${COLLECTION_SPECS[name].file}`,
      description: COLLECTION_SPECS[name].description,
      count: items.length,
      lastUpdated: new Date().toISOString(),
    };
    loaded[name] = { ...meta, count: items.length, items };
  }

  syncIndex();
  return loaded;
}

export function addItem(collection: CollectionName, item: LooseRecord) {
  const items = readCollection(collection);
  const added = normalizeCollectionValue(collection, item);
  items.push(added);
  writeCollection(collection, items);
  return added;
}

export function updateItem(collection: CollectionName, id: string, updates: LooseRecord): boolean {
  const items = readCollection(collection);
  const idx = items.findIndex((item) => (item as LooseRecord).id === id);
  if (idx === -1) return false;

  const current = items[idx] as LooseRecord;
  const now = new Date().toISOString();
  items[idx] = normalizeCollectionValue(collection, {
    ...current,
    ...updates,
    id,
    createdAt: toOptionalString(current.createdAt) ?? now,
    updatedAt: now,
  });
  writeCollection(collection, items);
  return true;
}

export function removeItem(collection: CollectionName, id: string) {
  const items = readCollection(collection);
  const idx = items.findIndex((item) => (item as LooseRecord).id === id);
  if (idx === -1) return null;
  const [removed] = items.splice(idx, 1);
  writeCollection(collection, items);
  return removed;
}

export function moveItem(
  fromCollection: CollectionName,
  id: string,
  toCollection: CollectionName,
  transform: LooseRecord = {}
) {
  const fromItems = readCollection(fromCollection);
  const idx = fromItems.findIndex((item) => (item as LooseRecord).id === id);
  if (idx === -1) return null;

  const [removed] = fromItems.splice(idx, 1);
  writeCollection(fromCollection, fromItems);

  const moved = normalizeCollectionValue(toCollection, {
    ...(removed as LooseRecord),
    ...transform,
    id,
    updatedAt: new Date().toISOString(),
  });

  const toItems = readCollection(toCollection);
  toItems.push(moved);
  writeCollection(toCollection, toItems);
  return moved;
}
