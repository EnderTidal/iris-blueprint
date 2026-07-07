# Changelog

Notable changes to the IRIS system architecture, in reverse chronological order.

---

## 2026-07-06 — Open-sourced as IRIS Blueprint

Published the architecture, patterns, and schema as a public repository. Sanitized all credentials, personal references, and proprietary business logic. Added setup guide, architecture deep-dive, and capability walkthroughs.

## 2026-06-30 — Git safety rules after data loss

Lost a full marathon coding session to an uncommitted `git checkout --`. Added non-negotiable git safety rules: always branch before changes, commit after each feature, never run destructive git ops without checking `git status` first. Added staging-only rule for all agent work.

## 2026-06-13 — Corrections tracking

Added `iris_corrections` table to log every user correction with context, what was wrong, what was right, and whether it was persisted. Before this, corrections were applied in-session but sometimes lost across restarts. Now there's an audit trail.

## 2026-06-05 — Data quality pass (Anthropic-inspired)

Added `COMMENT ON COLUMN` descriptions to every table. Created shape files as canonical system descriptions. Moved skills from flat `.md` files to folder-based structure (`skill-name/SKILL.md`). Added memory freshness tracking with `verified_at` dates.

## 2026-05-22 — Two-tier memory architecture

Raw `message_log` kept for 2 weeks. Nightly script compresses conversations into semantic summaries and embeds to Qdrant. Solved the problem of "what did we discuss about X last month?" without keeping raw logs forever. Weekly scrub deletes embedded rows older than 14 days.

## 2026-05-04 — Night work engine v2

Replaced ad-hoc overnight task execution with manifest-driven sequential engine. Each work item gets a manifest file with instructions and acceptance criteria. Engine verifies completion before marking done. Added `night_work_runs` table for full observability. Morning brief now reports what shipped overnight.

## 2026-04-18 — Self-healing heartbeat crons

Discovered crons silently dying mid-session. Added a midnight master cron that reads the heartbeat manifest and recreates any missing crons. Belt-and-suspenders: crons also recreate on every session startup. Zero manual intervention needed since implementation.

## 2026-04-02 — Encrypted secrets vault

Moved all API keys from environment variables and config files into PostgreSQL with pgcrypto encryption. Added `decrypt_secret()` convenience function. Monthly audit flags keys older than 90 days. Eliminated the "which .env file has the current key?" problem.

## 2026-03-15 — Operational state whiteboard

Added the `operational_state` table as a persistent key-value store. Before this, session crashes lost all context about current priorities, blockers, and plans. The whiteboard survives crashes and gives the next session instant context recovery. Added `session_texture` key to capture how the session felt, not just what happened.

## 2026-02-20 — Initial CLAUDE.md brain config

First version of the single-file brain configuration. Identity, personality, basic SOPs, and tool manifest. Started the pattern of accumulating behavioral corrections as permanent rules. The file has grown from ~200 lines to ~2,000 lines since.
