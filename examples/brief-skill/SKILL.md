---
name: brief
description: Morning briefing — overnight work report, calendar, email, top 6, inbox triage, costs
user_invocable: true
---

# Morning Brief

Structured daily briefing delivered to the professional channel. Runs at 10:00 AM weekdays via heartbeat cron, or invoked manually with `/brief`.

## Prerequisites

- `operational_state` table populated (at minimum: `top6`, `blockers`)
- `night_work_runs` table exists (even if empty)
- `message_log` table with recent entries
- `iris_inbox` table exists
- Google Calendar MCP connected
- Gmail MCP connected
- Qdrant running with `telegram_history` collection

## Execution Order

### 0. Embed Outstanding Conversations

Before anything else, run the embedding pipeline to compress overnight messages:

```bash
node scripts/embed-conversations.js
```

This ensures the vector DB is current before the brief pulls from it.

### 1. Night Work Report

Query overnight execution results:

```sql
SELECT phase, status, summary, output, duration_ms,
       started_at AT TIME ZONE 'America/Los_Angeles' as started_local
FROM night_work_runs
WHERE run_date = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date
ORDER BY started_at;
```

Format: count of items shipped, failed, skipped. For each completed item, one-line summary with file/resource path.

### 2. Calendar

Pull today's events from Google Calendar MCP:

```
list_events for today, primary calendar
```

Convert all times to user's timezone. Flag any conflicts with Top 6 items. If calendar is clear, say so.

### 3. Email Scan

Query Gmail MCP for urgent unread:

```
search_threads: is:unread newer_than:1d
```

Summarize: sender, subject, urgency assessment. Don't deep-read unless flagged as urgent. Cap at 5 most important.

### 4. Work List + Top 6

Load priorities from the whiteboard and work list:

```sql
-- Today's Top 6
SELECT value FROM operational_state WHERE key = 'top6';

-- Active work items
SELECT id, system, title, priority, status
FROM work_list
WHERE status IN ('open', 'in_progress')
ORDER BY priority, system;

-- Blockers
SELECT value FROM operational_state WHERE key = 'blockers';
```

### 5. Inbox Triage

Check for untriaged captured items:

```sql
SELECT id, type, raw_text, source, source_channel, captured_at
FROM iris_inbox
WHERE triaged = false
ORDER BY captured_at;
```

If items exist, list them with routing suggestions. Offer to triage inline.

### 6. Priorities

End with the top 3 priorities for today. Derive from Top 6 + calendar + blockers. Be opinionated about what matters most.

## Format Rules

- Deliver as multiple messages, one section per message
- Keep each section under 2000 characters
- Use numbered lists for scannable items
- Use plain text (no markdown) if delivering via Telegram
- Sections with no data: single line ("Calendar is clear today.")
- Don't send empty sections at all

## Error Handling

- If Google Calendar is unreachable: "Calendar: MCP unavailable. Check manually."
- If Gmail is unreachable: "Email: MCP unavailable. Check manually."
- If `night_work_runs` is empty: "No overnight work scheduled."
- If `iris_inbox` has zero untriaged items: skip the section entirely
- If any step times out (>30s): skip and note the timeout

## Example Output

### Section 1: Night Work

```
NIGHT WORK

3 items shipped overnight:
1. Rate limiting research — token bucket recommended, comparison in
   research/rate-limiting-comparison.md
2. Missing DB indexes — identified 3, created all 3 on staging
3. Competitor pricing archived — screenshots + matrix saved to
   research/competitor-pricing-jul.md

0 failed. 0 skipped.
```

### Section 2: Calendar

```
CALENDAR

1. 11:00 AM — Team standup (30 min)
2. 2:00 PM — Client call with Acme Corp (1 hr)

No conflicts with Top 6.
```

### Section 3: Work List

```
TOP 6

1. [in_progress] Ship user dashboard v2 — 80% done, final QA
2. [open] Write API docs for public endpoints
3. [open] Review PR #47 (auth refactor)
4. [open] Prep Acme deck for 2 PM call
5. [open] Fix timezone display bug — 2 user reports
6. [open] Update landing page pricing section

Blockers: none
```

### Section 4: Inbox

```
INBOX (2 items)

1. #142: "Research webhooks vs polling for event pipeline"
   Suggest: route to work_list (system: infra, P2)
2. #143: "Add rate limiting section to public docs"
   Suggest: route to work_list (system: docs, P3)

Triage now?
```

### Section 5: Priorities

```
TOP 3 TODAY

1. Ship dashboard v2 — 80% done, push to 100%
2. Acme call prep — review last 3 emails, draft talking points
3. Timezone bug — P1, two users affected
```

## Anti-Patterns

- Don't send a 10-paragraph wall of text. One section per message.
- Don't deep-read every email. Summarize from subject + sender.
- Don't list completed work items — only open and in-progress.
- Don't editorialize on the night work. State what happened, move on.
- Don't skip the priorities section. It's the most important part.
