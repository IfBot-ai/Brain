#!/usr/bin/env bun

import { join } from "path";
import { addInboxItem, ensureBrainProcessingNow } from "./inbox";

const ROOT = import.meta.dir;
const HTML_PATH = join(ROOT, "web", "inbox.html");
const DEFAULT_PORT = 3030;
const ME_PIN = "11235";

function normalizePort(value: string | undefined): number {
  const port = Number(value ?? DEFAULT_PORT);
  if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  return DEFAULT_PORT;
}

function slugifyName(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "guest";
}

function normalizeSender(rawName: string) {
  const trimmed = rawName.trim();
  if (trimmed.toLowerCase() === "me") {
    return {
      senderId: "me:jake",
      senderName: "Jake",
    };
  }

  return {
    senderId: `person:${slugifyName(trimmed)}`,
    senderName: trimmed,
  };
}

function formatWebMessage(name: string, message: string) {
  const sender = normalizeSender(name);
  return [
    "[web message]",
    "source: inbox-web",
    `senderId: ${sender.senderId}`,
    `senderName: ${sender.senderName}`,
    "message:",
    message.trim(),
  ].join("\n");
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

const port = normalizePort(process.env.BRAIN_WEB_PORT);

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/") {
      return new Response(Bun.file(HTML_PATH), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return json({ ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/inbox") {
      let payload: { name?: string; message?: string; pin?: string } | null = null;

      try {
        payload = await req.json();
      } catch {
        return json({ error: "Request body must be valid JSON." }, 400);
      }

      const name = payload?.name?.trim() ?? "";
      const message = payload?.message?.trim() ?? "";

      if (!name) return json({ error: "Name is required." }, 400);
      if (!message) return json({ error: "Message is required." }, 400);
      if (name.toLowerCase() === "me" && (payload?.pin?.trim() ?? "") !== ME_PIN) {
        return json({ error: "Invalid PIN." }, 403);
      }

      const item = addInboxItem(formatWebMessage(name, message), "note");
      const processing = ensureBrainProcessingNow();

      return json({
        ok: true,
        id: item.id,
        processingMode: processing.mode,
        processingPid: processing.pid,
        senderId: normalizeSender(name).senderId,
      });
    }

    return new Response("Not found", { status: 404 });
  },
  error(error) {
    console.error("[web] request error", error);
    return json({ error: "Server error." }, 500);
  },
});

console.log(`[web] inbox capture server listening on http://localhost:${server.port}`);
