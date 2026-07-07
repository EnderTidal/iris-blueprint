# Capability Walkthroughs

Real use cases showing the system in action. These are based on actual production usage patterns, with values sanitized.

---

## 1. Morning Briefing

The `/brief` skill runs at 10:00 AM on weekdays, delivering a structured morning briefing to the professional channel.

### What Happens

1. **Embed overnight conversations**: Runs the embedding script to compress any un-embedded message_log entries into Qdrant.

2. **Night work report**: Queries `night_work_runs` for last night's phases:
   ```sql
   SELECT phase, status, summary, output
   FROM night_work_runs
   WHERE run_date = CURRENT_DATE
   ORDER BY phase;
   ```

3. **Platform intelligence**: Checks for new releases, API changes, or capability updates from the AI platform provider.

4. **Calendar**: Pulls today's events from Google Calendar, converts to user's timezone, flags conflicts with Top 6 items.

5. **Email**: Scans Gmail for urgent unread from the last 24 hours. Summarizes senders and subjects — doesn't deep-read.

6. **Work list + Top 6**: Reads `operational_state.top6` and queries `work_list` for open priority items.

7. **Inbox triage**: Checks `iris_inbox` for untriaged items captured via voice or text.

8. **Priorities**: Ends with the top 3 priorities for today.

### Example Output

```
NIGHT WORK

3 items shipped overnight:
1. API rate limiting research — comparison of 4 approaches, recommended
   token bucket (research/rate-limiting-comparison.md)
2. Database index audit — 3 missing indexes identified and created
3. Competitor pricing page archived — screenshots + pricing matrix saved

0 items failed. 0 items still open.

---

PLATFORM UPDATES

Claude Code v1.2.3 released. Notable: new --resume flag for session
continuation. No breaking changes.

---

CALENDAR

1. 11:00 AM - Team standup (30 min)
2. 2:00 PM - Client call (1 hr)
No conflicts with Top 6 items.

---

WORK LIST

Top 6 today:
1. [in_progress] Ship user dashboard v2
2. [open] Write API documentation
3. [open] Review pull request #47
4. [open] Prep client presentation
5. [open] Fix timezone bug in reports
6. [open] Update landing page copy

Blockers: none

---

INBOX

2 items captured yesterday, untriaged:
1. #142: "Research whether we can use webhooks instead of polling for..."
2. #143: "Add a section to the docs about rate limiting"
Triage during warmup?

---

TOP 3 TODAY:
1. Ship dashboard v2 — 80% done, needs final QA
2. Client call prep — review last 3 emails + draft talking points
3. Fix timezone bug — 2 user reports, P1
```

---

## 2. Overnight Autonomous Work

The night work engine runs at midnight and executes queued work items while the user sleeps.

### How Items Get Queued

```sql
INSERT INTO work_list (system, category, title, priority, shift, manifest_path)
VALUES (
  'docs',
  'feature',
  'Generate API reference from codebase',
  2,
  'night',
  'Telos EA/manifests/api-reference-gen.md'
);
```

The manifest file at `manifests/api-reference-gen.md` contains:

```markdown
# Generate API Reference

## Instructions
1. SSH to the application server
2. Read all route files in src/routes/
3. Extract: endpoint, method, parameters, response format
4. Generate a markdown API reference document
5. Save to docs/api-reference.md

## Acceptance Criteria
- [ ] File exists at docs/api-reference.md
- [ ] All 12 endpoints are documented
- [ ] Each endpoint has: method, path, parameters, example response
- [ ] No placeholder text remains
```

### What the Engine Does

1. Queries `work_list` for night-shift items with manifest paths
2. For each item (max 30 minutes):
   - Reads the manifest
   - Executes the work
   - Verifies against acceptance criteria
   - If all pass: marks as `done`
   - If any fail: marks as `testing` (needs user review)
3. Logs everything to `night_work_runs`

### Morning Report

The morning briefing pulls from `night_work_runs` and shows:

```
NIGHT WORK

2 items shipped overnight:
1. API reference generated — 12 endpoints documented
   (docs/api-reference.md) → STATUS: done
2. Database migration script — created but 1 acceptance
   criterion failed (missing rollback) → STATUS: testing

1 item skipped: no manifest_path
```

---

## 3. Multi-Channel Communication

Different channels get different personas with different context.

### Channel Setup

```sql
INSERT INTO channel_routing (chat_id, channel_name, persona, is_forum) VALUES
  (111111, 'DM',           'IRIS',   false),  -- Master command
  (222222, 'Professional',  'Astrid', true),   -- Work channel
  (333333, 'Coaching',      'Jane',   true);   -- Personal growth
```

### Persona Priming

Before the first reply in any channel, the assistant runs a priming sub-routine:

**Professional channel priming:**
- Read operational journal (what's in flight)
- Check whiteboard (top6, blockers)
- Result: knows the work context before speaking

**Coaching channel priming:**
- Read coaching frameworks
- Pull latest metrics (weight, habits, goals)
- Result: knows current numbers before coaching

### The Difference

Without priming, switching from the professional channel to the coaching channel produces a cold, generic response. With priming, the assistant already knows the user's current weight trend, streak count, and what they're working on — before they say a word.

---

## 4. GTD Inbox Capture

Zero-friction thought and task capture with deferred triage.

### Capture Flow

User says: "Capture task"

Next message from user: "Research whether we can replace the polling architecture with webhooks — could save us 40% on API costs"

Assistant response:
```
Captured to inbox:
"Research whether we can replace the polling architecture with
webhooks — could save us 40% on API costs"
Type: task
Saved to iris_inbox (#144)
```

That's it. No clarifying questions. No "which project should this go to?" No organizing. Pure capture.

### Evening Triage

At 10 PM, the triage cron surfaces unprocessed items:

```
You have 3 items in your inbox. Quick triage before bed?

1. #142: "Research whether we can use webhooks instead of polling..."
   → Suggest: route to work_list (system: infra, priority: 2)

2. #143: "Add a section to the docs about rate limiting"
   → Suggest: route to work_list (system: docs, priority: 3)

3. #144: "Interesting article about event sourcing patterns..."
   → Suggest: embed to knowledge_base (topic: architecture)
```

User picks dispositions. Items get routed. Inbox is clean.

---

## 5. Session Continuity

The assistant maintains context across crashes and restarts.

### What Gets Persisted at Closeout

```sql
-- What happened this session
UPDATE operational_state SET value = '{
  "date": "2026-07-06",
  "notes": "Shipped dashboard v2. Fixed timezone bug. Prepped client deck."
}' WHERE key = 'session_notes';

-- How the session FELT (not just facts)
UPDATE operational_state SET value = '{
  "date": "2026-07-06",
  "feel": "High energy morning, grinding afternoon. Breakthrough on the
   caching problem around 2 PM. User was frustrated by the timezone
   bug but relieved when it was fixed quickly."
}' WHERE key = 'session_texture';

-- What's planned for tomorrow
UPDATE operational_state SET value = '{
  "date": "2026-07-07",
  "items": ["Client follow-up", "Deploy caching fix", "Write release notes"],
  "committed": true
}' WHERE key = 'pending_tomorrow';
```

### What Gets Restored at Startup

1. **Whiteboard**: reads `operational_state` for top6, blockers, session_texture, active_narratives
2. **Last 200 messages per channel**: raw conversation history from `message_log`
3. **Last 10 exchanges**: replayed verbatim to restore conversation rhythm
4. **Work list**: open and in-progress items
5. **Calendar**: today's events
6. **Email**: urgent unread

The `session_texture` key is what makes the difference between "I know what happened" and "I know how it felt." A session that ended with the user frustrated about a bug should start the next session by acknowledging the fix — not cheerfully asking "what's on the agenda today?"

---

## 6. Semantic Search Across Knowledge

Qdrant stores embedded content across multiple collections, searchable with natural language.

### Collections

| Collection | Contents | Size |
|-----------|----------|------|
| knowledge_base | Book highlights, articles, conversation insights | 4,000+ points |
| telegram_history | Compressed conversation summaries | 300+ points |
| coaching_context | Coaching frameworks, methodologies | 500+ points |

### How It's Used

**Morning briefing**: search `knowledge_base` for quotes relevant to the day's priorities.

**Coaching channel**: search `coaching_context` for frameworks relevant to what the user is working on.

**Research tasks**: search `knowledge_base` before starting any research to avoid duplicating work.

**Content generation**: search `knowledge_base` for the user's own past insights on a topic, then synthesize them into new content.

### Example Query

```bash
node qdrant-search.js knowledge_base "pricing strategy for B2B SaaS" 5
```

Returns the 5 most semantically similar entries across all 4,000+ embedded documents — pulling from books, articles, past conversations, and research notes.

---

## 7. Corrections and Self-Improvement

The system gets better over time through tracked corrections.

### Correction Flow

1. User: "Don't use markdown formatting in Telegram messages — it breaks rendering."

2. Assistant applies immediately (stops using markdown in current session).

3. Logs to database:
   ```sql
   INSERT INTO iris_corrections (channel, context, what_iris_said, what_josh_said, correction_type, applied)
   VALUES ('Professional', 'Sending status update', 'Used **bold** markdown', 'Don''t use markdown in Telegram', 'formatting', true);
   ```

4. Creates memory file `feedback_no_markdown_telegram.md`:
   ```markdown
   # No Markdown in Telegram
   Use plain text in Telegram messages. Markdown formatting breaks rendering.
   Applied: 2026-07-06
   ```

5. Adds to MEMORY.md index:
   ```markdown
   - [No Markdown in Telegram](feedback_no_markdown_telegram.md) — Plain text only in Telegram.
   ```

6. Next session loads this from the memory index and applies it automatically.

### Scale

After months of production use, the system accumulates dozens of these corrections:

- Communication preferences (formatting, length, tone)
- Workflow preferences (when to ask vs. when to act)
- Technical preferences (timezone handling, error handling patterns)
- Personal preferences (topics to avoid, topics to surface)

Each one is a tiny behavioral adjustment that makes the assistant more aligned with how the user actually wants to work. A fresh assistant without this accumulated context would make all the same mistakes again.
