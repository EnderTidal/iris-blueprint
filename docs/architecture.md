# Architecture Deep-Dive

This document covers every major subsystem in the IRIS architecture. Each section explains what it is, why it exists, and how to implement it.

---

## Table of Contents

1. [The CLAUDE.md Brain Pattern](#1-the-claudemd-brain-pattern)
2. [Memory System](#2-memory-system)
3. [Operational State (Whiteboard Pattern)](#3-operational-state-whiteboard-pattern)
4. [Session Lifecycle](#4-session-lifecycle)
5. [Heartbeat Crons](#5-heartbeat-crons)
6. [Night Work Engine](#6-night-work-engine)
7. [Skills System](#7-skills-system)
8. [Multi-Persona Routing](#8-multi-persona-routing)
9. [Message Logging and Conversation Embedding](#9-message-logging-and-conversation-embedding)
10. [Encrypted Secrets Vault](#10-encrypted-secrets-vault)
11. [Task Management](#11-task-management)
12. [Tool Manifest (Pointer System)](#12-tool-manifest-pointer-system)
13. [Corrections and Self-Improvement](#13-corrections-and-self-improvement)

---

## 1. The CLAUDE.md Brain Pattern

The entire assistant is configured through a single `CLAUDE.md` file that Claude Code reads as operating instructions. This file is the brain.

### Structure

```
CLAUDE.md
├── Identity & Role          # Who the assistant is, personality traits
├── Communication Style      # How to speak, formatting rules
├── Decision-Making          # When to act vs. when to ask
├── Systems & Integrations   # MCP servers, API integrations, pending setup
├── Tool Manifest            # Trigger → tool → config pointer → how
├── Personal Context         # Trigger → context file → loading rules
├── SOPs                     # Standard Operating Procedures
│   ├── Responding via Chat
│   ├── Real-Time Logging
│   ├── Task Management
│   ├── Session Startup (6 phases)
│   ├── Session Closeout
│   ├── Scheduling Changes
│   ├── Feedback Handling
│   ├── GTD Capture Protocol
│   └── Knowledge Capture
├── Database Schema Rules    # Table ownership, cross-read rules, timezone rules
└── Core Principles          # Timezone rules, simplicity, systems thinking
```

### Key Design Patterns

**Personality is explicit, not implicit.** The file defines personality traits with specific behavioral examples: "confident and sharp," "dry wit," "proactive and opinionated," "never sycophantic." This prevents the assistant from defaulting to generic helpful-assistant tone.

**SOPs are step-by-step procedures.** Not vague guidelines — concrete sequences of actions with specific SQL queries, file paths, and API calls. "Check Gmail for urgent unread" is too vague. "Query Gmail MCP for unread messages from last 24h, summarize senders and subjects, flag anything from [priority contacts]" is an SOP.

**The Tool Manifest is a routing table.** Instead of the assistant memorizing how to use every tool, the manifest maps triggers to tools to config files. When the trigger fires, the assistant reads the config file for current endpoints and keys. This prevents stale hardcoded values.

**Behavioral corrections accumulate.** When the user corrects the assistant, the correction gets added to `CLAUDE.md` as a permanent rule. Over time, the file becomes a highly customized behavioral specification. Example rules from production:

- "Never use bare `Date()` — always convert to user's timezone"
- "Use numbered lists in chat for easy reference"
- "Don't summarize what you just did unless the outcome is ambiguous"
- "Never bring up work topics until the user does"
- "Push for session closeout when quality degrades"

### Why One File?

Claude Code loads `CLAUDE.md` files from three locations (global, project, workspace) and treats them as system instructions. A single well-structured file is:

- **Searchable**: Claude can reference any section during a session
- **Versionable**: Track changes with git
- **Auditable**: Every rule has a reason, often with a date stamp
- **Portable**: Copy to a new machine and the assistant works identically

---

## 2. Memory System

### Categories

Memory files are plain markdown stored in a project-specific directory. Each file has a prefix indicating its category:

| Prefix | Purpose | Example |
|--------|---------|---------|
| `user_*` | Personal context about the user | `user_profile.md`, `user_favorites.md` |
| `feedback_*` | Behavioral corrections | `feedback_numbered_lists.md`, `feedback_no_sycophancy.md` |
| `project_*` | Project status and context | `project_billyfit.md`, `project_joblink.md` |
| `reference_*` | System references and configs | `reference_telegram_channels.md`, `reference_vps_servers.md` |

### The Index Pattern

A `MEMORY.md` file serves as the master index:

```markdown
- [User Profile](user_profile.md) — Load every session. Personal context.
- [No Sycophancy](feedback_no_sycophancy.md) — Push back honestly, never yes-man.
- [Numbered Lists](feedback_numbered_lists.md) — Use numbered lists in chat.
- [Project Status](project_billyfit.md) — Current BillyFit project state.
```

The assistant reads this index at startup to know what's available, then loads specific files on-demand when triggers match.

### Loading Rules

Not all memory loads at once. A pointer table in `CLAUDE.md` maps triggers to files:

```
| Trigger              | File                    | Rule                    |
|----------------------|-------------------------|-------------------------|
| Every session        | user_profile.md         | Always load             |
| User seems low       | user_the_darkness.md    | Load before responding  |
| Any correction       | feedback_*.md           | Apply immediately       |
| Work topic raised    | project_*.md            | Load relevant project   |
```

This keeps the context window clean. An assistant with 140 memory files that loads all of them at startup will run out of context before doing any actual work.

### Memory Freshness

Each memory file should have a `verified_at` date in its frontmatter. A weekly maintenance task flags files that haven't been verified in 30+ days. Stale memory is worse than no memory — it creates false confidence.

---

## 3. Operational State (Whiteboard Pattern)

The most important table in the system: a JSONB key-value store that acts as a persistent whiteboard.

```sql
CREATE TABLE operational_state (
  key   TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT now()
);
```

### Standard Keys

| Key | Purpose | Example Value |
|-----|---------|---------------|
| `top6` | Today's priority list | `{"date": "2026-07-06", "items": [{"title": "Ship feature X", "status": "in_progress"}]}` |
| `pending_tomorrow` | Tomorrow's planned items | `{"date": "2026-07-07", "items": ["Review PR", "Write spec"]}` |
| `blockers` | Current blockers | `["Waiting on API access", "Need design review"]` |
| `session_notes` | Last session summary | `{"date": "...", "notes": "Built X, shipped Y, decided Z"}` |
| `session_texture` | Emotional context of last session | `{"feel": "High energy. Breakthrough on architecture."}` |
| `active_narratives` | Interactive thread state per channel | `{"channel_a": {"thread": "...", "state": "..."}}` |
| `last_closeout` | When/how last session ended | `{"type": "planned", "timestamp": "..."}` |

### Why This Matters

When a Claude Code session crashes or restarts, all in-memory context is lost. The operational state table is the assistant's way of leaving notes for its future self. On startup, it reads the whiteboard and knows:

- What it was working on
- What's blocked
- How the last session felt (not just what happened)
- What's planned for today and tomorrow
- Where interactive conversations left off

### Temporal Key Rules

`top6` is always TODAY. `pending_tomorrow` is always TOMORROW. A nightly rollover cron promotes `pending_tomorrow` to `top6` at 11:57 PM, preserving incomplete items from today.

---

## 4. Session Lifecycle

### Startup (6 Phases)

The startup sequence is the most critical SOP. It runs before the assistant responds to any messages.

```
Phase 0:   Session Registration
           └─ Log startup to message_log

Phase 0.5: Read the Whiteboard
           └─ Load operational_state (top6, blockers, session_texture, narratives)

Phase 1:   System Boot (parallel)
           ├─ Get current time (in user's timezone)
           ├─ Recreate heartbeat crons
           ├─ Read memory index
           ├─ Load forum topic directory
           ├─ Load task queues
           └─ Read system shape files

Phase 2:   Asset & Config Inventory (parallel)
           ├─ Query secrets vault
           ├─ Read operational journal
           ├─ Verify vector search is live
           └─ Scan deployed assets

Phase 3:   Context Recovery (sequential)
           ├─ Pull last 200 messages per channel
           ├─ Replay last 10 exchanges per active channel
           ├─ Scan work list
           ├─ Check calendar
           ├─ Check email
           └─ Check recently modified files

Phase 4:   Persona Priming
           └─ Run sub-routines for each active persona

Phase 5:   Topic Routing Verification
           └─ Confirm forum topics are live

Phase 6:   Status Report + Go Live
           └─ Print startup blurb, process queued messages
```

**Why parallel phases?** Phases 1 and 2 contain independent operations that can run simultaneously. Phase 3 is sequential because each step builds on the previous. This minimizes startup time.

**Why replay raw exchanges?** Reading a summary of the last conversation tells you WHAT happened. Reading the actual last 10 message exchanges tells you HOW it felt — the rhythm, the tone, whether the user was frustrated or excited. This is the difference between robotic continuation and natural continuity.

### Closeout

Session closeout is equally structured:

1. Commit all uncommitted work (on all servers)
2. Verify all deliverables exist (files, deployments, DB records)
3. Log closeout to message_log
4. Update operational state (session_notes, session_texture, last_closeout)
5. Snapshot active narrative threads
6. Save new memories
7. Update operational journal
8. Update indexes (schema manifest, shape files, memory index)
9. Embed un-embedded conversations
10. Final verification

The closeout is where the assistant writes the notes that its next incarnation will read at startup. Skip it, and the next session starts cold.

---

## 5. Heartbeat Crons

Heartbeat crons are scheduled tasks that run autonomously. They are defined in a manifest file and recreated on every session startup.

### The Manifest Pattern

A `heartbeat-manifest.md` file defines every cron with:
- Cron expression
- Human-readable name
- Full prompt text (what the cron should do)
- Any special rules or dependencies

### Self-Healing

A master cron runs at midnight:

1. Lists all existing crons
2. Reads the manifest for the full list of required crons
3. Creates any missing crons
4. Deletes any orphaned crons (not in the manifest)

This means crons self-heal. If any die during the day, midnight restores them. They also recreate on every session startup as a belt-and-suspenders measure.

### How Claude Code Crons Work

Claude Code provides a `CronCreate` tool that schedules prompt-based execution on a cron expression. Here's what you need to know:

**Session-level scheduling.** Crons are created within a Claude Code session using the `CronCreate` tool. Each cron has a name, a cron expression (standard 5-field format), and a prompt — the text that Claude Code will execute when the cron fires.

**Prompt-based execution.** When a cron triggers, Claude Code starts a new sub-session and runs the prompt as if the user typed it. The prompt has full access to all tools, MCP servers, and the `CLAUDE.md` context. This means a cron can run SQL queries, SSH to servers, call APIs, send messages — anything the assistant can do interactively.

**7-day auto-expiry.** Crons expire after 7 days by default. This is a safety mechanism — it prevents orphaned crons from running indefinitely if the system is abandoned. It also means crons must be actively recreated.

**Recreated on startup via the heartbeat manifest.** The assistant reads a `heartbeat-manifest.md` file during Phase 1 of startup and calls `CronCreate` for every cron defined in the manifest. This means crons are recreated every time a new session starts — typically daily. The 7-day expiry is irrelevant in practice because crons are refreshed far more frequently.

**Self-renewal at midnight.** A master cron runs at midnight that reads the manifest and recreates any missing crons. This handles the edge case where a session runs for multiple days without restart — the midnight cron ensures nothing expires mid-session.

**No persistent daemon.** There is no separate cron service or background process. Crons only run while a Claude Code session is active. If Claude Code is not running, no crons fire. This is a conscious trade-off: simplicity over uptime. For truly always-on tasks, use a system-level cron or a workflow engine like n8n.

```
Startup                    Midnight Self-Renewal
   │                              │
   ▼                              ▼
Read heartbeat-manifest     Read heartbeat-manifest
   │                              │
   ▼                              ▼
CronCreate × N             CronList (check existing)
   │                              │
   ▼                              ▼
All crons active            Recreate missing crons
   │                              │
   ▼                              ▼
7-day expiry timer starts   Expiry timers reset
```

### Example Crons

| Time | Name | Purpose |
|------|------|---------|
| 00:01 | Midnight Self-Renewal | Verify + recreate all crons |
| 00:00 | Night Work Engine | Execute queued work items |
| 01:00 | Night Research | Research tasks + skill sharpening |
| 02:00 | Night Synthesis | Synthesize overnight findings |
| 03:00 | Night Maintenance | Embed conversations, audit memory, backup |
| 03:30 | Git Backup | Push all repos to GitHub |
| 04:00 | Daily Intelligence Brief | Check for platform updates, new capabilities |
| 06:00 | Health Check | 7-system health check |
| 07:00 | Morning Message | Good morning + daily prompt |
| 10:00 | AM Brief | Full morning briefing (weekdays) |
| 15:33 | EOD + Plan Tomorrow | End of day wrap + interactive planning |
| 23:57 | Top 6 Rollover | Promote tomorrow's plan to today |

---

## 6. Night Work Engine

The night work engine is a sequential task executor that runs while the user sleeps.

### How It Works

1. Query `work_list` for items with `status IN ('open', 'in_progress')` and `manifest_path IS NOT NULL`
2. For each item (max 30 minutes per item):
   a. Read the manifest file at the specified path
   b. Execute the work described in the manifest
   c. Verify completion against acceptance criteria in the manifest
   d. If all criteria pass: mark as `done`
   e. If any criteria fail: mark as `testing` (needs user review)
3. Log results to `night_work_runs` table

### The Manifest Pattern

Each work item can have a `manifest_path` pointing to a markdown file that describes:
- What to do
- How to verify it's done
- Acceptance criteria (specific, testable conditions)

Items WITHOUT a manifest are skipped — the engine only executes well-defined work.

### Observability

Every night phase logs to `night_work_runs`:

```sql
INSERT INTO night_work_runs (run_date, phase, status, started_at)
VALUES (CURRENT_DATE, 'engine', 'running', NOW());

-- ... do work ...

UPDATE night_work_runs
SET status = 'completed',
    summary = 'Executed 3 items: 2 completed, 1 moved to testing',
    output = '{"items_attempted": 3, "items_completed": 2, ...}',
    completed_at = NOW(),
    duration_ms = 45000
WHERE run_date = CURRENT_DATE AND phase = 'engine';
```

The morning briefing pulls from this table to report what happened overnight.

---

## 7. Skills System

Skills are folder-based modules invoked via `/slash-commands`.

### Folder Structure

```
skills/
  brief/
    SKILL.md          # Entry point — execution steps, format rules, examples
  closeout/
    SKILL.md          # Closeout procedure with 9 steps
  capture/
    SKILL.md          # GTD inbox capture + knowledge thread detection
  weekly-review/
    SKILL.md          # Friday L10 weekly review format
```

### SKILL.md Format

```yaml
---
name: brief
description: Morning briefing — calendar, email, overnight work, priorities
user_invocable: true
---

# Skill Name

## Execution Order
1. Step one (with specific SQL queries, API calls, file paths)
2. Step two
...

## Format Rules
- Keep messages under 2000 chars
- Use numbered lists
- One section per message

## Examples of Good Execution
(Actual example outputs showing what "done well" looks like)
```

### Why Folder-Based?

- **Extensibility**: Skills can include supporting scripts, data files, sub-procedures
- **Versioning**: Each skill evolves independently
- **Discoverability**: Claude Code can list available skills and their descriptions
- **Examples**: Including "examples of good execution" in the skill file dramatically improves output quality

---

## 8. Multi-Persona Routing

The system supports multiple personas, each with distinct personality, context, and purpose, routed by communication channel.

### Channel Routing Table

```sql
CREATE TABLE channel_routing (
  chat_id      BIGINT PRIMARY KEY,
  channel_name VARCHAR(30) NOT NULL,
  persona      VARCHAR(30) NOT NULL,
  is_forum     BOOLEAN DEFAULT false
);
```

Example rows:
| chat_id | channel_name | persona | is_forum |
|---------|-------------|---------|----------|
| 123456 | DM | IRIS | false |
| -100111 | Professional | Astrid | true |
| -100222 | Coaching | Jane | true |

### Persona Priming

Each persona has a pre-flight checklist that runs before the first reply in that channel:

- **Professional persona**: Read operational journal, check whiteboard, know what's in flight
- **Coaching persona**: Load coaching frameworks, pull latest metrics, know current goals

The priming step ensures the assistant doesn't give a cold, generic response when switching between channels. It should already know the context of each channel before speaking.

### Forum Topic Routing

For forum-enabled channels (Telegram supergroups with topics), messages are routed to the correct topic based on content classification:

```sql
CREATE TABLE forum_topics (
  chat_id    VARCHAR(30) NOT NULL,
  topic_id   INTEGER NOT NULL,
  topic_name VARCHAR(255)
);
```

Before sending any reply to a forum channel, the assistant classifies the content and routes to the appropriate topic. Bug reports go to the Bugs topic, feature requests to the Feature Requests topic, etc.

---

## 9. Message Logging and Conversation Embedding

### Two-Tier Memory Architecture

```
Tier 1: Working Memory (2 weeks)
  └─ message_log table in PostgreSQL
  └─ Raw messages: sender, text, channel, timestamp
  └─ Used for: context recovery at startup, recent conversation replay

Tier 2: Long-Term Memory (permanent)
  └─ Qdrant vector collections
  └─ Compressed conversation summaries with semantic embeddings
  └─ Used for: "what did we discuss about X last month?"
```

### Real-Time Logging

Every message sent or received is logged to PostgreSQL immediately:

```sql
INSERT INTO message_log (channel, sender, message_text, message_type, persona, timestamp, embedded)
VALUES ('Professional', 'User', 'Ship the feature today', 'text', 'Astrid', NOW(), false);
```

### Nightly Embedding Pipeline

A maintenance cron runs nightly:

1. Query `message_log WHERE embedded = false`
2. Group messages into conversation batches (30-minute gaps between batches)
3. Generate a summary for each batch (topics, emotional tone, decisions, action items)
4. Embed the summary using Gemini embeddings (3072 dimensions)
5. Upsert to Qdrant `telegram_history` collection
6. Mark source rows as `embedded = true`

### Retention Policy

- Raw `message_log`: 2-week retention. Weekly scrub deletes rows older than 14 days (only if `embedded = true`).
- Qdrant summaries: permanent. Compressed, searchable, low-cost.

---

## 10. Encrypted Secrets Vault

All API keys, tokens, and credentials are stored encrypted in PostgreSQL using pgcrypto.

```sql
CREATE TABLE secrets (
  name            TEXT PRIMARY KEY,
  service         TEXT NOT NULL,
  encrypted_value BYTEA NOT NULL,
  description     TEXT,
  rotated_at      TIMESTAMPTZ DEFAULT now()
);
```

### Encrypting

```sql
INSERT INTO secrets (name, service, encrypted_value, description)
VALUES (
  'openai_api_key',
  'openai',
  pgp_sym_encrypt('sk-abc123...', 'your-passphrase'),
  'OpenAI API key for embeddings'
);
```

### Decrypting at Runtime

```sql
SELECT pgp_sym_decrypt(encrypted_value, 'your-passphrase')
FROM secrets
WHERE name = 'openai_api_key';
```

Or via a convenience function:

```sql
CREATE FUNCTION decrypt_secret(val BYTEA, pass TEXT)
RETURNS TEXT AS $$
  SELECT pgp_sym_decrypt(val, pass);
$$ LANGUAGE SQL;
```

### Key Rotation Tracking

The `rotated_at` column tracks when each key was last rotated. A monthly audit flags keys older than 90 days. A weekly review surfaces overdue rotations.

---

## 11. Task Management

### Work List

The central task tracking table:

```sql
CREATE TABLE work_list (
  id          SERIAL PRIMARY KEY,
  system      VARCHAR(20) NOT NULL,   -- Which system owns this
  category    VARCHAR(20) NOT NULL,   -- feature, bug, polish, admin
  title       TEXT NOT NULL,
  priority    INTEGER DEFAULT 3,      -- 1=highest, 4=lowest
  status      VARCHAR(20) DEFAULT 'open',
  shift       TEXT DEFAULT 'day',     -- day or night
  manifest_path TEXT,                 -- Path to work manifest for night engine
  scheduled_date DATE,
  blocked_by  INTEGER REFERENCES work_list(id)
);
```

**Day vs. night shift**: Items marked `shift='night'` are candidates for the overnight work engine. Items marked `shift='day'` appear in the morning briefing.

**Manifest path**: Points to a markdown file with detailed instructions and acceptance criteria. Only items with a manifest can be executed autonomously.

### Eisenhower Box with Decay

The `etool` table implements an Eisenhower matrix where Q2 tasks automatically escalate to Q1 after a configurable number of days:

```sql
CREATE TABLE etool (
  task              TEXT NOT NULL,
  quadrant          INTEGER NOT NULL,      -- Current quadrant (1-4)
  original_quadrant INTEGER NOT NULL,      -- Where it started
  decay_days        INTEGER DEFAULT 14,    -- Days before Q2→Q1 escalation
  escalation_date   TIMESTAMP              -- When it will escalate
);
```

### GTD Inbox

Frictionless capture with deferred triage:

```sql
CREATE TABLE iris_inbox (
  type          TEXT DEFAULT 'thought',   -- thought or task
  raw_text      TEXT NOT NULL,            -- Exact verbatim text, never edited
  source        TEXT DEFAULT 'text',      -- voice or text
  source_channel TEXT,
  triaged       BOOLEAN DEFAULT false,
  disposition   TEXT                      -- routed, killed, deferred
);
```

Capture is instant and frictionless — no clarifying questions, no organizing, no routing. Just store the raw text. Evening triage surfaces unprocessed items with routing recommendations.

---

## 12. Tool Manifest (Pointer System)

Instead of hardcoding tool knowledge, the assistant uses a routing table:

```
| Trigger                    | Tool        | Config Pointer              |
|----------------------------|-------------|-----------------------------|
| Voice message received     | STT API     | configs/stt-service.md      |
| Need to generate image     | Image API   | configs/image-gen.md        |
| Need CRM operations        | CRM API     | configs/crm.md              |
| Need workflow management   | n8n API     | configs/n8n.md              |
| Security concern flagged   | Security SOP| memory/security.md          |
```

**Rule: If a config file exists, READ IT before making API calls.**

This prevents a common failure mode: the assistant "remembers" an API endpoint or key from a previous session, but it's been rotated or changed. The pointer system forces a fresh read of the config file every time.

---

## 13. Corrections and Self-Improvement

### Correction Tracking

```sql
CREATE TABLE iris_corrections (
  channel          TEXT,
  context          TEXT,       -- What was being discussed
  what_iris_said   TEXT,       -- What was wrong
  what_josh_said   TEXT,       -- What was right
  correction_type  TEXT,       -- factual, behavioral, formatting, process
  applied          BOOLEAN     -- Whether persisted to memory/config
);
```

### The Feedback Loop

1. User corrects the assistant
2. Assistant applies the correction immediately in the current session
3. Assistant logs it to `iris_corrections`
4. If it's a pattern (not a one-off), the correction is persisted to:
   - A `feedback_*.md` memory file (for the specific pattern)
   - `CLAUDE.md` itself (for fundamental behavioral rules)
5. Next session, the correction is loaded from memory and applied automatically

This creates a virtuous cycle: the assistant gets better over time because corrections accumulate as permanent behavioral rules. A system running for months will have dozens of user-specific behavioral adjustments that a fresh assistant wouldn't have.

---

## Next Steps

- See [setup-guide.md](setup-guide.md) for step-by-step setup instructions
- See [examples/capabilities.md](../examples/capabilities.md) for real use case walkthroughs
- See [schema/tables.sql](../schema/tables.sql) for the complete database schema
