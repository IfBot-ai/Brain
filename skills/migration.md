# Task migration

## When to invoke this skill
Run this skill when either of these are true:
- It is Monday and there has not been a run in at least 5 days
- There are open tasks older than 14 days with no update
- Jake explicitly asks for a migration or reset

## Purpose
Migration is a cleanup ritual. It forces a decision on stale work instead of letting the task list decay.

## Procedure

### Step 1 - Review stale tasks
Identify every task that is open or in-progress and untouched for 14+ days.

### Step 2 - Decide honestly
For each stale task, choose one:
- Update it with a clearer next step
- Lower its priority
- Close it as no longer relevant
- Move the underlying idea into `future` with a concrete revisit date

### Step 3 - Protect the focus
If more than 7 tasks remain open after migration, reduce noise:
- Close weak tasks
- Merge duplicates
- Move low-signal items into `future`

### Step 4 - Log it
Finish with an `append_log` action summarizing what was clarified, dropped, or deferred.
