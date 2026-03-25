# Brain Loop

An autonomous thinking process that runs on a schedule. Claude processes your inbox, grooms your task queue, manages collections of ideas/reading/waiting/projects, surfaces future log items when their date arrives, and pings you when something needs attention. Inbox submissions from the CLI or web UI are handed to the brain loop immediately.

## Setup

```bash
cd brain
npm i
export OPEN_ROUTER_KEY=sk-or-v1-...
export OPEN_ROUTER_MODEL=anthropic/claude-sonnet-4.6
```

On first run, missing runtime files in `memory/` are bootstrapped automatically. If `templates/memory/` exists, those templates are copied into place; otherwise the app falls back to built-in defaults and empty arrays.

## Usage

```bash
bun run status                           # full dashboard
bun run status --tasks                   # tasks only
bun run status --future                  # future log only
bun run status --log                     # recent run history

bun run loop                             # single run (test)
bun run start                            # launch the daemon TUI; starts daemon automatically if needed
bun run tui                              # same TUI entrypoint
bun run daemon                           # start the daemon directly without the TUI
bun run web                              # start static inbox capture UI on http://localhost:3030
nohup bun run daemon > brain.log 2>&1 &  # start headless in background; live prompt is disabled when non-interactive

bun run inbox "Ship the referral feature"  # queue input anytime; starts/signals immediate processing
bun run inbox --type idea "Gamify onboarding"
bun run inbox --type waiting "Waiting on Alex to review contract"
bun run inbox --type reading "https://example.com/article"
bun run inbox --after 2026-09-01 "Renew innbox domain"   # future log

kill -USR1 $(cat .daemon.pid)            # trigger immediate run
kill $(cat .daemon.pid)                  # stop daemon
```

## File structure

```
brain/
├── daemon.ts               ← long-running scheduler
├── loop.ts                 ← single run (loads context → Claude → execute → write)
├── collections.ts          ← all collection I/O, index sync
├── brain-status.ts         ← terminal dashboard (read-only)
├── inbox-add.ts            ← CLI to capture into inbox or future log
├── inbox-web.ts            ← Bun server for static inbox capture UI
├── config.ts               ← model, interval, notification settings
├── types.ts                ← all TypeScript types
├── web/
│   └── inbox.html          ← animated static capture UI
├── prompts/
│   └── system.ts           ← builds Claude's system prompt from live state
├── actions/
│   └── executor.ts         ← executes all action types
├── memory/
│   ├── core.json           ← identity, goals, principles, currentFocus
│   ├── index.json          ← collection manifest with counts
│   ├── tasks.json          ← active work items
│   ├── ideas.json          ← raw ideas and developing thoughts
│   ├── waiting.json        ← items blocked on someone else
│   ├── reading.json        ← articles, links, books
│   ├── projects.json       ← project contexts (tasks link here)
│   ├── future.json         ← parked items with activeAfter date
│   └── inbox.json          ← ephemeral capture queue (cleared each run)
├── skills/
│   ├── migration.md        ← BuJo migration ritual (auto-triggers on conditions)
│   ├── reflection.md       ← monthly reflection procedure
│   └── _reflection_*.md   ← generated monthly archives (Claude writes these)
└── log.jsonl               ← append-only run history
```

## Collections

| Collection | Purpose |
|---|---|
| `tasks`    | Active work items. Always loaded in full. |
| `ideas`    | Raw / developing thoughts. Status: raw → developing → promoted / shelved. |
| `waiting`  | Blocked on a person or event. Announces when overdue. |
| `reading`  | Links and books. Status: unread → in-progress → done. |
| `projects` | Project contexts. Tasks link to these via `linkedTo`. |
| `future`   | Parked items, invisible until `activeAfter` arrives. |

## Future log

Items scheduled with `--after` are invisible to Claude until their date. On the run on or after that date, they surface into the inbox automatically.

```bash
bun run inbox --after 2026-06-01 "Q2 review — what shipped?"
bun run inbox --after 2026-09-15 --type task "Renew innbox domain"
```

## Skills

Skills in `skills/` are markdown files loaded into Claude's context on every run. They describe reusable procedures. Claude follows them when conditions match, and can write new ones.

**Built-in skills:**
- `content-planning.md` — expands vague content tasks into briefs, scripts, shot lists, and honest production tasks.
- `migration.md` — BuJo migration ritual. Auto-triggers when tasks are stale or Monday + 5d since last run.
- `reflection.md` — Monthly reflection. Writes a timestamped `_reflection_YYYY-MM.md` archive.
- `side-quests.md` — turns blocked or vague parent tasks into small linked child tasks that actually unblock them.

**To disable a skill:** move or delete the file from `skills/`.

## Customising

Edit `memory/core.json` to reflect who you actually are and what you're actually focused on — the more honest this is, the more useful the loop becomes. The checked-in `templates/memory/core.json` file is the seed used for fresh clones.

Edit `config.ts` to change the run interval, model, or notification settings.
