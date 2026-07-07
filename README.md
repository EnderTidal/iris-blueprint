# IRIS Blueprint

**Architecture patterns for building a production AI executive assistant with Claude Code.**

IRIS (Integrated Recursive Intelligence System) is a real system that has been running in production since early 2026 — managing communications, scheduling, task execution, overnight autonomous work, and multi-channel operations across a portfolio of businesses. This repository documents the architecture, patterns, and schema behind it so others can build their own.

It manages 20+ core database tables (the production system runs 120+), 25+ scheduled crons, 5 communication channels, overnight autonomous work execution, semantic search across 4,000+ embedded documents, and a 6-phase startup sequence that restores full operational context in under 60 seconds.

---

## Architecture Overview

```
                                    CLAUDE.md
                                  (Brain Config)
                                       |
                          Identity / SOPs / Tool Manifest
                          Memory Pointers / Startup Sequence
                                       |
                    +------------------+------------------+
                    |                  |                  |
              Skills System      Memory System      Heartbeat Crons
            (folder-based,     (categorized .md    (25+ scheduled tasks:
             invokable via      files indexed by    overnight work engine,
             /slash-commands)    MEMORY.md)          health checks, briefs,
                    |                  |              backups, rollover)
                    |                  |                  |
         +----------+---------+--------+---------+-------+--------+
         |          |         |        |         |       |        |
     PostgreSQL   Qdrant   Telegram  Google    Gmail   n8n    Cloudflare
     (20+ core   (vector  (multi-   Calendar         (workflow  (Pages,
      tables)     search,  channel,                   engine)   Workers)
                  4 colls) persona
                           routing)
```

### How It Works

1. **CLAUDE.md is the brain.** A single markdown file contains the assistant's identity, personality, all SOPs, a tool manifest with config pointers, startup/shutdown procedures, database schema rules, and behavioral corrections. Claude Code reads this file at session start and follows it as operating instructions.

2. **PostgreSQL is the whiteboard.** An `operational_state` table acts as a persistent key-value store that survives session restarts. The assistant writes its current priorities, blockers, session notes, and emotional context here. On startup, it reads the whiteboard to restore where it left off.

3. **Memory files are categorized pointers.** Instead of loading everything at startup, a `MEMORY.md` index file maps ~140 memory files by category (feedback, project, reference, user context). Files are loaded on-demand when a relevant trigger fires — not all at once.

4. **Skills are folder-based modules.** Each capability (morning briefing, session closeout, GTD capture) lives in its own folder with a `SKILL.md` entry point and optional sub-files. Invoked via `/slash-commands`.

5. **Heartbeat crons run autonomously.** 25+ scheduled tasks handle overnight work execution, health checks, conversation embedding, git backups, morning briefings, and daily planning — all without user intervention.

6. **Qdrant provides long-term memory.** Raw conversation logs are kept for 2 weeks in PostgreSQL. A nightly script compresses them into semantic summaries and embeds them into Qdrant vector collections for permanent, searchable memory.

---

## Capabilities

| Capability | What It Does | Key Components |
|-----------|-------------|----------------|
| **Morning Briefing** | Pulls calendar, email, overnight work results, LLM costs, inbox items. Delivers a structured brief to chat. | `/brief` skill, Google Calendar MCP, Gmail MCP, `night_work_runs` table |
| **Overnight Autonomous Work** | Executes work items from a task list while the user sleeps. Sequential manifest-driven execution with pass/fail tracking. | `work_list` table with `manifest_path`, `night_work_runs` table, 4 night crons (engine, research, synthesis, maintenance) |
| **Multi-Channel Personas** | Different personality and context per communication channel. Professional assistant in one channel, coaching persona in another. | `channel_routing` table, `forum_topics` table, persona priming sub-routines |
| **GTD Inbox Capture** | Voice or text capture with zero friction. Evening triage surfaces unprocessed items with routing recommendations. | `iris_inbox` table, `/capture` skill, ElevenLabs STT for voice |
| **Semantic Knowledge Search** | Search across 4,000+ embedded book highlights, conversation history, coaching frameworks, and journal entries. | Qdrant vector DB, Gemini embeddings, `qdrant-search.js` script |
| **Session Continuity** | Full context restoration across restarts — operational state, last 200 messages per channel, persona priming, calendar, work list. | `operational_state` table, `message_log` table, 6-phase startup SOP |
| **Operational State Machine** | Persistent whiteboard pattern — Top 6 priorities, blockers, session texture, active narratives, tomorrow's plan. Survives crashes. | `operational_state` table (JSONB key-value) |
| **Self-Healing Crons** | A midnight master cron verifies all other crons exist and recreates any that died. Crons also recreate on every session startup. | Heartbeat manifest, midnight self-renewal cron |
| **Encrypted Secrets Vault** | All API keys stored encrypted in PostgreSQL with pgcrypto. Decrypted at runtime via a passphrase. | `secrets` table, `decrypt_secret()` function |
| **Corrections Tracking** | Every user correction is logged with context, what was wrong, what was right, and whether it was persisted to memory. | `iris_corrections` table, feedback memory files |
| **Decision Logging** | Significant decisions recorded with date, rationale, context, and reversibility flag. | `decision_log` table |
| **Night Work Observability** | Every overnight phase logs start time, duration, status, structured output, and human-readable summary. | `night_work_runs` table |

---

## Design Decisions

### Why CLAUDE.md instead of code?

The entire system is configured through a single markdown file that Claude Code reads as instructions. No application server, no custom runtime, no deployment pipeline for the assistant itself. Changes to behavior are just edits to a text file.

This works because Claude Code treats `CLAUDE.md` as authoritative instructions. The file contains everything: identity, personality, SOPs, tool manifest, startup sequence, database rules, and behavioral corrections learned from user feedback.

### Why PostgreSQL for state instead of files?

Files work for static configuration. But operational state — what's the current priority list? what happened overnight? where did the last conversation leave off? — needs to survive crashes, be queryable, and support concurrent access from cron jobs. PostgreSQL with JSONB gives you a typed, queryable, transactional whiteboard.

### Why a pointer system instead of loading everything?

An AI assistant accumulates context: 140+ memory files, 10+ config files, tool manifests, persona scripts. Loading everything at startup burns the context window on things that may never be needed. Instead, a `MEMORY.md` index maps files by trigger condition. Files are loaded on-demand when the trigger fires.

### Why folder-based skills?

Early iterations used flat `.md` files for skills. But skills often need supporting scripts, sub-files, and structured metadata. A folder with `SKILL.md` as the entry point (plus optional sub-files) is more extensible and mirrors how Claude Code's own skill system works.

### Why two-tier memory?

Raw conversation logs in PostgreSQL give you exact recall for 2 weeks. But you can't search "what did we discuss about pricing strategy last month?" against raw messages. A nightly embedding script compresses conversations into semantic summaries in Qdrant, giving you permanent searchable memory with good recall.

### Why a correction tracking table?

When a user corrects the assistant ("don't do X, do Y"), that correction needs to persist across sessions. Memory files handle behavioral patterns, but the `iris_corrections` table provides an audit trail: what was wrong, what was right, whether it was applied. This is how the system improves over time.

---

## Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| AI Runtime | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | CLI-based AI assistant with tool use, MCP support, session management |
| Brain Config | `CLAUDE.md` (markdown) | Identity, SOPs, tool manifest, startup sequence, behavioral rules |
| Database | PostgreSQL + pgcrypto | Operational state, message logs, task management, encrypted secrets vault |
| Vector DB | [Qdrant](https://qdrant.tech/) | Semantic search over embedded conversations, books, frameworks |
| Embeddings | Gemini `gemini-embedding-001` | 3072-dimension embeddings for Qdrant |
| Communication | Telegram (via MCP plugin) | Multi-channel messaging with persona routing |
| Calendar/Email | Google Calendar + Gmail (MCP) | Scheduling, email triage |
| Workflow Engine | [n8n](https://n8n.io/) | Webhook-driven automations, accountability gates |
| Hosting | VPS (Ubuntu) + Cloudflare Pages | Database hosting, static sites, edge workers |
| TTS/STT | ElevenLabs | Voice note transcription, speech generation |
| Image Gen | Gemini / Higgsfield | AI-generated images for content drops |
| Deployment | Cloudflare Wrangler + PM2 + SSH | Static sites, Node.js services, remote deploys |

---

## Repository Structure

```
iris-blueprint/
  README.md                              # This file
  CHANGELOG.md                           # System evolution timeline
  docs/
    architecture.md                      # Detailed architecture deep-dive
    setup-guide.md                       # Step-by-step setup instructions
  schema/
    tables.sql                           # CREATE TABLE statements for all tables
  scripts/
    embed-conversations.js               # Nightly conversation embedding pipeline
    qdrant-search.js                     # Semantic search across Qdrant collections
  templates/
    claude-md-template.md                # Sanitized CLAUDE.md template
    heartbeat-manifest-template.md       # Example cron manifest
    skill-template/                      # Example skill folder structure
      SKILL.md
  examples/
    capabilities.md                      # Real use case walkthroughs
    brief-skill/                         # Complete example skill (morning briefing)
      SKILL.md
  .gitignore
```

---

## Getting Started

See [docs/setup-guide.md](docs/setup-guide.md) for a step-by-step setup walkthrough.

See [docs/architecture.md](docs/architecture.md) for a deep-dive into every subsystem.

See [examples/capabilities.md](examples/capabilities.md) for real use case walkthroughs with example outputs.

---

## Credits

Built by [Josh Tibbetts](https://github.com/EnderTidal) using [Claude Code](https://docs.anthropic.com/en/docs/claude-code) by Anthropic.

The system has been in continuous production use since early 2026, managing communications, operations, and development across multiple businesses.

---

## License

MIT
