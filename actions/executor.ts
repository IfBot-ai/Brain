import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { BrainAction, FutureItem, Memory, Task } from "../types";
import {
  addItem,
  ensureScaffold,
  moveItem,
  nanoid,
  readCollection,
  removeItem,
  updateItem,
  writeCollection,
} from "../collections";
import config from "../config";

const ROOT = join(import.meta.dir, "..");
const SKILLS_DIR = join(ROOT, "skills");

async function notify(message: string, urgency: string) {
  const prefix = urgency === "high" ? "HIGH" : urgency === "medium" ? "MED" : "LOW";
  console.log(`\n[announce:${prefix}] ${message}\n`);

  if (!config.useSystemNotifications) return;

  try {
    const proc = Bun.spawn([
      "osascript",
      "-e",
      `display notification "${message.replace(/"/g, '\\"')}" with title "Brain" subtitle "${urgency.toUpperCase()}" sound name "Glass"`,
    ]);
    await proc.exited;
  } catch {
    process.stdout.write("\x07");
  }
}

export async function executeActions(
  actions: BrainAction[],
  state: { core: Memory; tasks: Task[] }
) {
  ensureScaffold();

  for (const action of actions) {
    switch (action.type) {
      case "update_memory": {
        state.core[action.key] = action.value;
        console.log(`  [update_memory] ${action.key} = ${JSON.stringify(action.value).slice(0, 80)}`);
        break;
      }

      case "add_task": {
        const task: Task = {
          id: nanoid(),
          title: action.title,
          priority: action.priority,
          status: "open",
          notes: action.notes,
          linkedTo: action.linkedTo,
          createdAt: new Date().toISOString(),
        };
        state.tasks.push(task);
        console.log(`  [add_task] [${task.id}] (${task.priority}) ${task.title}`);
        break;
      }

      case "update_task": {
        const idx = state.tasks.findIndex((task) => task.id === action.id);
        if (idx === -1) {
          console.warn(`  [update_task] WARN: task ${action.id} not found`);
          break;
        }
        Object.assign(state.tasks[idx], { ...action.updates, updatedAt: new Date().toISOString() });
        console.log(`  [update_task] [${action.id}] updated: ${Object.keys(action.updates).join(", ")}`);
        break;
      }

      case "close_task": {
        const idx = state.tasks.findIndex((task) => task.id === action.id);
        if (idx === -1) {
          console.warn(`  [close_task] WARN: task ${action.id} not found`);
          break;
        }
        state.tasks[idx].status = "done";
        state.tasks[idx].updatedAt = new Date().toISOString();
        if (action.resolution) {
          state.tasks[idx].notes = [state.tasks[idx].notes, `Resolution: ${action.resolution}`]
            .filter(Boolean)
            .join("\n");
        }
        console.log(`  [close_task] [${action.id}] "${state.tasks[idx].title}"`);
        break;
      }

      case "add_to_collection": {
        const added = addItem(action.collection as Parameters<typeof addItem>[0], action.item);
        console.log(`  [add_to_collection] ${action.collection} <- [${(added as { id: string }).id}]`);
        break;
      }

      case "update_collection_item": {
        const ok = updateItem(action.collection as Parameters<typeof updateItem>[0], action.id, action.updates);
        if (!ok) console.warn(`  [update_collection_item] WARN: [${action.id}] not found in ${action.collection}`);
        else console.log(`  [update_collection_item] ${action.collection}:[${action.id}] updated`);
        break;
      }

      case "move_item": {
        const moved = moveItem(
          action.fromCollection as Parameters<typeof moveItem>[0],
          action.id,
          action.toCollection as Parameters<typeof moveItem>[2],
          action.transform
        );
        if (!moved) console.warn(`  [move_item] WARN: [${action.id}] not found in ${action.fromCollection}`);
        else console.log(`  [move_item] [${action.id}] ${action.fromCollection} -> ${action.toCollection}`);
        break;
      }

      case "remove_from_collection": {
        const removed = removeItem(action.collection as Parameters<typeof removeItem>[0], action.id);
        if (!removed) console.warn(`  [remove_from_collection] WARN: [${action.id}] not found in ${action.collection}`);
        else console.log(`  [remove_from_collection] ${action.collection}:[${action.id}] removed`);
        break;
      }

      case "schedule_item": {
        const future = readCollection<FutureItem>("future");
        const item: FutureItem = {
          id: nanoid(),
          content: action.content,
          type: action.itemType,
          activeAfter: action.activeAfter,
          notes: action.notes,
          createdAt: new Date().toISOString(),
        };
        future.push(item);
        writeCollection("future", future);
        console.log(`  [schedule_item] "${action.content.slice(0, 60)}" -> active after ${action.activeAfter}`);
        break;
      }

      case "announce": {
        await notify(action.message, action.urgency);
        break;
      }

      case "append_log": {
        const entry = JSON.stringify({ ts: new Date().toISOString(), summary: action.summary });
        appendFileSync(join(ROOT, "log.jsonl"), entry + "\n");
        console.log(`  [append_log] ${action.summary}`);
        break;
      }

      case "write_skill": {
        if (!existsSync(SKILLS_DIR)) mkdirSync(SKILLS_DIR, { recursive: true });
        writeFileSync(join(SKILLS_DIR, action.filename), action.content);
        console.log(`  [write_skill] skills/${action.filename}`);
        break;
      }

      default: {
        console.warn("  [unknown action]", action);
      }
    }
  }
}
