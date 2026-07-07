# Heartbeat Manifest Template

Define all scheduled crons here. These are recreated on every session startup
and verified by a midnight self-renewal cron.

---

## Format

Each cron entry needs:
- **Cron expression** (in the user's timezone)
- **Name** (human-readable)
- **Prompt** (full instructions for what the cron should do)
- **Rules** (any constraints or dependencies)

---

## MIDNIGHT SELF-RENEWAL (daily at 00:01)

- Cron: `1 0 * * *`
- This is the MASTER CRON. It keeps all other crons alive.
- Prompt: `HEARTBEAT: Midnight Self-Renewal. PROCEDURE: 1. List all existing crons. 2. Read this manifest for the full list of required crons. 3. For each required cron: check if it exists. If MISSING, create it. If EXISTS, skip. 4. For each existing cron NOT in the manifest: delete it. 5. Report: "Self-renewal complete. X crons verified, Y created, Z deleted."`
- Self-healing: if any cron dies during the day, midnight restores it.

---

## MORNING BRIEFING ([TIME] weekdays)

- Cron: `[MIN] [HOUR] * * 1-5`
- Prompt: `HEARTBEAT: Morning Briefing. Send morning briefing to [CHANNEL]. Steps: 1. Check overnight work results (query night_work_runs). 2. Pull today's Google Calendar events. 3. Check Gmail for urgent unread. 4. Read operational_state for top6 and blockers. 5. Check inbox for untriaged items. 6. Format as concise briefing. End with top 3 priorities.`

---

## NIGHT WORK: ENGINE (00:00 daily)

- Cron: `[MIN] 0 * * *`
- Prompt: `HEARTBEAT: Night Work Engine. Execute work items sequentially from work_list. PROCEDURE: 1. Log run start to night_work_runs table. 2. Query work_list WHERE status IN ('open','in_progress') AND manifest_path IS NOT NULL ORDER BY priority. 3. For each item (max 30 min each): read the manifest, execute, verify against acceptance criteria, update status. 4. Log run completion with summary and structured output. 5. Do NOT message the user. Work silently.`

---

## NIGHT WORK: RESEARCH ([TIME] daily)

- Cron: `[MIN] 1 * * *`
- Prompt: `HEARTBEAT: Night Research. Log run start. Research tasks: check platform changelog for new capabilities, deep research on active projects, skill sharpening on relevant tools. Save findings to research/. Log run completion.`

---

## NIGHT WORK: SYNTHESIS ([TIME] daily)

- Cron: `[MIN] 2 * * *`
- Prompt: `HEARTBEAT: Night Synthesis. Log run start. Read upstream phase results from night_work_runs. Synthesize findings. Prep morning brief deliverables. Log run completion.`

---

## NIGHT MAINTENANCE ([TIME] daily)

- Cron: `[MIN] 3 * * *`
- Prompt: `HEARTBEAT: Night Maintenance. Log run start. 1. Run conversation embedding script to compress message_log into vector DB. 2. Audit memory files for staleness. 3. Backup critical config files. Log run completion.`

---

## GIT BACKUP ([TIME] daily)

- Cron: `[MIN] [HOUR] * * *`
- Prompt: `HEARTBEAT: Git Backup. SSH to [VPS_IP]. For each repo: git add -A && git commit -m "Nightly backup" --allow-empty && git push. Log results. Do NOT message the user.`

---

## HEALTH CHECK ([TIME] daily)

- Cron: `[MIN] [HOUR] * * *`
- Prompt: `HEARTBEAT: Health Check. Check: 1. Database connectivity. 2. Vector DB health. 3. VPS disk space. 4. Service uptime (PM2/Docker). 5. SSL cert expiry. Report to [CHANNEL]. Flag P0 issues to DM.`

---

## EOD REPORT + PLAN TOMORROW ([TIME] daily)

- Cron: `[MIN] [HOUR] * * [DAYS]`
- Prompt: `HEARTBEAT: EOD Report + Plan Tomorrow. Two parts: PART 1 — What got done today, what carries over. PART 2 — Interactive planning: gather candidates (calendar, work_list, carried items), present to user, wait for user to pick their priorities, confirm and persist to pending_tomorrow.`

---

## TOP 6 ROLLOVER (23:57 daily)

- Cron: `57 23 * * *`
- Prompt: `HEARTBEAT: Top 6 Rollover. 1. Read top6 from operational_state. 2. Separate done vs incomplete items. 3. Append snapshot to top6_history. 4. Build new top6: incomplete items carried forward + pending_tomorrow items. 5. Write new top6. 6. Clear pending_tomorrow. Do NOT message the user.`

---

## WEEKLY DEEP ([DAY] [TIME])

- Cron: `[MIN] [HOUR] * * [DAY]`
- Prompt: `HEARTBEAT: Weekly Deep. Full audit: 1. Memory file staleness check. 2. Secret rotation audit. 3. Message log cleanup (DELETE WHERE older than 14 days AND embedded = true). 4. CLAUDE.md review for stale rules. 5. Backup verification.`

---

## Notes

- All crons use the user's local timezone
- Crons are recreated on every session startup AND by the midnight self-renewal
- Items marked DISABLED or KILLED should be commented out, not deleted (preserves history)
- The self-renewal cron should be the FIRST cron created — it ensures all others survive
