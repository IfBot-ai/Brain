# Monthly reflection

## When to invoke this skill
Run this skill when any of the following are true:
- It is the last 3 days of the month and no reflection log entry exists for this month
- Jake explicitly asks for a reflection (inbox item with content containing "reflect" or "monthly review")
- More than 35 days have passed since the last reflection entry in reflections.jsonl

## Purpose
The monthly reflection is a structured look backward and forward. It produces a `reflections.jsonl` entry that persists permanently - future runs can reference it for long-range pattern recognition. The goal is not accountability theater. It is honest signal about what is working, what is not, and what to carry forward.

## Procedure

### Step 1 - Read the evidence
Before answering any reflection question, scan the available data:
- The last 30 days of `log.jsonl` entries (summarize the pattern of runs)
- Tasks closed in the last 30 days (done + cancelled)
- Current open task queue - what is still open that was open last month?
- Ideas promoted to tasks in the last 30 days (move_item actions in log)
- Waiting items resolved vs still pending

You are synthesizing from the state of the system, not from memory or assumption.

### Step 2 - Answer the reflection questions
Work through each question in order. Be specific. Vague answers are worthless.

**What shipped?**
List everything closed with status "done" this month. Group by project if possible.

**What stalled?**
List tasks that have been open for more than 21 days with no updatedAt change. Be direct about why they likely stalled - too vague, dependency not met, lower priority than it seemed.

**What surprised you?**
Things that turned out harder, easier, faster, slower, or more/less important than expected.

**What did the inbox reveal?**
Look at the types of items that came in this month (from log summaries). Were they mostly tasks? Ideas? Waiting? What does the pattern say about where Jake's attention is?

**What ideas are worth carrying forward?**
Look at the ideas collection. Which "raw" or "developing" ideas have momentum worth preserving?

**What should next month's focus be?**
One concrete statement. Not a list of aspirations. What is the single most important area of progress?

**What should be dropped?**
Tasks, ideas, or projects that are no longer earning their place. Name them specifically.

### Step 3 - Write the reflection entry
Use `append_log` is NOT sufficient for reflections. Instead, use `write_skill` with filename `_reflection_YYYY-MM.md` - this creates a timestamped archive file in skills/ that persists. Use the current month in the filename.

The content should be a structured markdown document:

```md
# Reflection: [Month Year]
Generated: [ISO date]

## What shipped
[list]

## What stalled
[list with honest reasons]

## Surprises
[prose]

## Inbox pattern
[prose]

## Ideas with momentum
[list]

## Next month focus
[single statement]

## Drops
[list with reasons]
```

### Step 4 - Act on the reflection
After writing the reflection, fire any obvious actions it surfaces:
- Close stale tasks identified as "should be dropped"
- Promote ideas with momentum to "developing"
- Add a task for next month's stated focus if one doesn't already exist
- Fire a `schedule_item` if anything needs to be revisited next month

### Step 5 - Standard log
End with `append_log` summary: "monthly reflection complete - [month]"

## Notes
- The reflection file uses `write_skill` so it lands in skills/ and is visible to all future runs. Claude will naturally reference past reflections when relevant.
- Do not be diplomatic in the reflection. A reflection that says everything is fine when tasks are stalling is worse than useless.
- The best outcome of a reflection is 2-3 concrete actions and one thing dropped.
