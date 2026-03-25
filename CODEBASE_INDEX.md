# Codebase Index

Observed on 2026-03-23 in `/Users/jacobberg/brain`.

## Current status

The missing scaffold has been reconstructed. The repo now contains:

- runtime config in `config.ts`
- collection/index storage helpers in `collections.ts`
- the system prompt builder in `prompts/system.ts`
- the expected executor entrypoint in `actions/executor.ts`
- the scheduler in `daemon.ts`
- initial state under `memory/`
- reusable procedures under `skills/`

The only remaining requirement for a real loop run is OpenRouter configuration.

## How to run it

### One-time setup

```bash
cd /Users/jacobberg/brain
npm i
export OPEN_ROUTER_KEY=sk-or-v1-...
```

Optional environment variables:

```bash
export OPEN_ROUTER_MODEL=anthropic/claude-sonnet-4.6
export OPEN_ROUTER_HTTP_REFERER=https://example.com
export OPEN_ROUTER_TITLE=brain
export OPEN_ROUTER_REQUIRE_ANTHROPIC=true
export BRAIN_INTERVAL_MINUTES=30
export BRAIN_VERBOSE_THOUGHTS=true
export BRAIN_USE_SYSTEM_NOTIFICATIONS=false
```

### Common commands

```bash
bun run status
bun run tasks
bun run future
bun run log

bun run inbox "Ship the referral feature"
bun run inbox --type idea "Gamify onboarding"
bun run inbox --after 2026-09-01 "Renew domain"

bun run loop
bun run start
```

## Verified behavior

| Command | Result |
| --- | --- |
| `bun run status` | Works |
| `bun run inbox "Ship the referral feature"` | Works and writes to `memory/inbox.json` |
| `bun run future` | Works |
| `bun run log` | Works |
| `bun run loop` | Reaches the OpenRouter call and stops only if `OPEN_ROUTER_KEY` is unset |
| `bun run start` | Starts the daemon and shells out to `loop.ts` |

## Runtime flow

1. `inbox-add.ts` captures items into `memory/inbox.json` or `memory/future.json`
2. `loop.ts` loads `memory/`, matures future items, builds the system prompt, calls OpenRouter's Anthropic-compatible Messages endpoint, and parses a JSON response
3. `actions/executor.ts` applies actions to tasks, collections, future items, logs, and skills
4. `brain-status.ts` renders a read-only dashboard from the same `memory/` files
5. `daemon.ts` schedules repeated `loop.ts` runs and responds to `SIGUSR1` for an immediate run

## Important files

| Path | Role |
| --- | --- |
| `package.json` | Bun scripts and dependency declaration |
| `config.ts` | Model and runtime flags |
| `collections.ts` | Collection I/O, manifest sync, and mutation helpers |
| `loop.ts` | Single-run brain loop |
| `actions/executor.ts` | Action execution |
| `prompts/system.ts` | Prompt assembly from live state |
| `brain-status.ts` | Terminal dashboard |
| `inbox-add.ts` | Inbox capture CLI |
| `daemon.ts` | Scheduler/background runner |
| `memory/` | Persistent JSON state |
| `skills/` | Markdown procedures loaded into the loop |
| `log.jsonl` | Append-only run history |

## Current blocker if `loop` still fails

If `bun run loop` fails now, it should be for one of these concrete reasons:

1. `OPEN_ROUTER_KEY` is not set
2. The OpenRouter key is invalid
3. OpenRouter is unreachable from the machine

The file/path scaffold itself is no longer the blocker.
