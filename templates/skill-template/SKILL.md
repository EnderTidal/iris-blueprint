---
name: example-skill
description: Brief description of what this skill does — shown in skill listings
user_invocable: true
---

# Skill Name

Brief description of what this skill does and when to invoke it.

## Prerequisites

- List any required state, tables, or services
- E.g., "Requires `operational_state` table to be populated"
- E.g., "Requires Google Calendar MCP to be connected"

## Execution Order

### 1. First Step

Description of what to do first. Include specific queries or commands:

```sql
SELECT key, value FROM operational_state WHERE key IN ('top6', 'blockers');
```

### 2. Second Step

Description of the second step. Be specific — not "check email" but:

```
Query Gmail MCP for unread messages from last 24h.
Filter to messages from [priority contacts].
Summarize: sender, subject, urgency level.
```

### 3. Third Step

Continue with remaining steps. Each step should be independently executable
and produce a verifiable result.

## Format Rules

- Keep output messages under 2000 chars
- Use numbered lists for easy reference
- Send one section per message (don't wall-of-text)
- Use plain text unless formatting adds real value

## Error Handling

- If [SERVICE] is unreachable: note in output, continue with remaining steps
- If [TABLE] is empty: report "no data" for that section, don't fail
- If a step takes >60 seconds: skip and note the timeout

## Examples of Good Execution

### Example 1: Normal Day

```
Section title

1. Item one with specific detail
2. Item two with specific detail
3. Item three with specific detail
```

### Example 2: Edge Case

```
Section title

No items found. [Explanation of why this is fine.]
```

## Anti-Patterns

- Don't [COMMON_MISTAKE_1]
- Don't [COMMON_MISTAKE_2]
- Never [DANGEROUS_ACTION] without [SAFETY_CHECK]
