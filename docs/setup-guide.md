# Setup Guide

Step-by-step instructions for building your own AI executive assistant using this architecture.

---

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- A VPS (Ubuntu 22.04+ recommended) with SSH access
- A domain (optional but recommended for webhooks)
- A Telegram account (for the communication layer)

---

## Step 1: VPS Provisioning

You need a VPS to host PostgreSQL, Qdrant, and any always-on services. Minimum specs:

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 2 GB | 4 GB |
| Storage | 20 GB | 40 GB |
| CPU | 1 vCPU | 2 vCPU |

### Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

### SSH Key Setup

Generate a key pair on your local machine:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_vps -N ""
ssh-copy-id -i ~/.ssh/id_ed25519_vps root@YOUR_VPS_IP
```

Test: `ssh -i ~/.ssh/id_ed25519_vps root@YOUR_VPS_IP "echo connected"`

---

## Step 2: PostgreSQL Setup

### Deploy via Docker

```bash
docker run -d \
  --name iris-postgres \
  --restart unless-stopped \
  -e POSTGRES_USER=iris_user \
  -e POSTGRES_PASSWORD=YOUR_STRONG_PASSWORD \
  -e POSTGRES_DB=iris_db \
  -p 5432:5432 \
  -v pgdata:/var/lib/postgresql/data \
  postgres:16
```

### Enable pgcrypto

```bash
docker exec -it iris-postgres psql -U iris_user -d iris_db -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
docker exec -it iris-postgres psql -U iris_user -d iris_db -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
```

### Create the schema

Run the SQL from `schema/tables.sql`:

```bash
docker exec -i iris-postgres psql -U iris_user -d iris_db < schema/tables.sql
```

### Create the decrypt function

```sql
CREATE OR REPLACE FUNCTION decrypt_secret(val BYTEA, pass TEXT)
RETURNS TEXT AS $$
  SELECT pgp_sym_decrypt(val, pass);
$$ LANGUAGE SQL;
```

### Store your first secrets

```sql
INSERT INTO secrets (name, service, encrypted_value, description)
VALUES (
  'anthropic_api_key',
  'anthropic',
  pgp_sym_encrypt('sk-ant-...', 'YOUR_VAULT_PASSPHRASE'),
  'Anthropic API key for Claude'
);
```

---

## Step 3: Qdrant Setup

### Deploy via Docker

```bash
docker run -d \
  --name iris-qdrant \
  --restart unless-stopped \
  -p 6333:6333 \
  -v qdrant_data:/qdrant/storage \
  -e QDRANT__SERVICE__API_KEY=YOUR_QDRANT_API_KEY \
  qdrant/qdrant:latest
```

### Create Collections

```bash
# Knowledge base — for embedded books, articles, insights
curl -X PUT "http://localhost:6333/collections/knowledge_base" \
  -H "api-key: YOUR_QDRANT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "vectors": {
      "size": 3072,
      "distance": "Cosine"
    }
  }'

# Conversation history — for embedded conversation summaries
curl -X PUT "http://localhost:6333/collections/conversation_history" \
  -H "api-key: YOUR_QDRANT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "vectors": {
      "size": 3072,
      "distance": "Cosine"
    }
  }'
```

The vector dimension (3072) matches Gemini's `gemini-embedding-001` model. Adjust if using a different embedding model.

### Embedding Script

Create a script that:

1. Queries `message_log WHERE embedded = false`
2. Groups by 30-minute gaps into conversation batches
3. Generates a summary for each batch (use Claude or Gemini)
4. Embeds the summary (use Gemini `gemini-embedding-001` or OpenAI `text-embedding-3-large`)
5. Upserts to Qdrant
6. Marks rows as `embedded = true`

### Search Script

Create a search script that:

1. Takes a collection name and query string
2. Embeds the query
3. Searches Qdrant with the embedded vector
4. Returns top N results with payloads

Example usage: `node qdrant-search.js knowledge_base "pricing strategy" 5`

---

## Step 4: n8n Setup (Optional)

n8n provides webhook-driven workflow automation — useful for accountability gates, scheduled messages, and integrations that need to run outside of Claude Code sessions.

```bash
docker run -d \
  --name iris-n8n \
  --restart unless-stopped \
  -p 5678:5678 \
  -v n8n_data:/home/node/.n8n \
  n8nio/n8n:latest
```

Access at `http://YOUR_VPS_IP:5678`

---

## Step 5: Telegram Bot Setup

### Create the Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot`
3. Choose a name and username
4. Save the bot token

### Configure Channels

Create Telegram channels/groups for each persona:

1. Create a supergroup for your professional channel
2. Enable Topics (Forum mode) in the group settings
3. Add your bot as an administrator
4. Note the chat IDs (send a message, then check `https://api.telegram.org/bot<TOKEN>/getUpdates`)

### Store Routing

```sql
INSERT INTO channel_routing (chat_id, channel_name, persona, is_forum) VALUES
  (YOUR_DM_CHAT_ID, 'DM', 'IRIS', false),
  (YOUR_WORK_CHAT_ID, 'Professional', 'Astrid', true);
```

### Claude Code Telegram Plugin

Claude Code has a built-in Telegram plugin. Configure it with your bot token. This gives the assistant the ability to send and receive Telegram messages via MCP tools.

---

## Step 6: Claude Code Configuration

### Global CLAUDE.md

Create `~/.claude/CLAUDE.md` with your brain config. Use the template at `templates/claude-md-template.md` as a starting point.

### Memory Directory

Create your memory directory:

```bash
mkdir -p ~/.claude/projects/YOUR_PROJECT_KEY/memory/
```

Create `MEMORY.md` as the index file. Create your first memory files:

- `user_profile.md` — who you are, preferences, timezone
- `feedback_*.md` — any behavioral corrections as you notice them

### Skills Directory

```bash
mkdir -p ~/.claude/skills/brief/
mkdir -p ~/.claude/skills/closeout/
mkdir -p ~/.claude/skills/capture/
```

Create `SKILL.md` in each folder with the skill's execution steps.

### Heartbeat Manifest

Create your heartbeat manifest file with all scheduled crons. See `templates/heartbeat-manifest-template.md` for the format.

---

## Step 7: API Keys

You'll need API keys for the following services. Store all of them in the `secrets` table.

| Service | Purpose | Where to Get |
|---------|---------|-------------|
| Anthropic | Claude API (for subagents, embeddings fallback) | [console.anthropic.com](https://console.anthropic.com) |
| Gemini | Embeddings (`gemini-embedding-001`), image generation | [ai.google.dev](https://ai.google.dev) |
| Telegram Bot | Communication | [@BotFather](https://t.me/BotFather) |
| ElevenLabs | Speech-to-text (voice notes), text-to-speech | [elevenlabs.io](https://elevenlabs.io) |
| Cloudflare | Static site hosting, edge workers | [dash.cloudflare.com](https://dash.cloudflare.com) |
| Resend | Transactional email with attachments | [resend.com](https://resend.com) |
| GitHub | Repository management (for `gh` CLI) | [github.com/settings/tokens](https://github.com/settings/tokens) |

Optional:
| Service | Purpose |
|---------|---------|
| Fal.ai | Video generation |
| Higgsfield | Image/video generation |
| GoHighLevel | CRM operations |
| Retell | AI phone agents |

---

## Step 8: First Run

1. Start Claude Code in your project directory
2. It will read your `CLAUDE.md` and begin the startup sequence
3. The startup will:
   - Register the session in PostgreSQL
   - Read the operational state whiteboard
   - Recreate heartbeat crons
   - Load memory index
   - Pull recent messages
   - Check calendar and email
   - Print a status blurb

If something fails during startup, it should note the failure and continue. Don't block on non-critical failures.

### Verify the Setup

Check that:
- [ ] PostgreSQL is reachable from your local machine
- [ ] Qdrant is reachable and collections exist
- [ ] Telegram bot can send/receive messages
- [ ] `secrets` table has your API keys
- [ ] `operational_state` table has at least one key
- [ ] Memory files are in the expected directory
- [ ] CLAUDE.md is being read by Claude Code

---

## Step 9: Iterate

The system improves over time. As you use it:

1. **Correct behaviors** — when the assistant does something wrong, tell it. It should persist the correction to a `feedback_*.md` file.
2. **Add SOPs** — when you find yourself giving the same instructions repeatedly, codify them as an SOP in CLAUDE.md.
3. **Build skills** — when a task becomes routine, create a skill for it.
4. **Add crons** — when you want something to happen automatically, add it to the heartbeat manifest.
5. **Expand memory** — as context accumulates, create new memory files and index them.

The CLAUDE.md file should grow organically. A well-used system will have hundreds of behavioral rules, dozens of SOPs, and a deep memory system — all accumulated from real usage, not designed upfront.
