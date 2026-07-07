#!/usr/bin/env node
/**
 * embed-conversations.js
 *
 * Nightly conversation embedding pipeline.
 * Reads un-embedded messages from PostgreSQL, batches them by 30-minute gaps,
 * summarizes each batch with Gemini, embeds the summary, upserts to Qdrant,
 * and marks source rows as embedded.
 *
 * Usage:
 *   node embed-conversations.js
 *
 * Environment variables (all required):
 *   DATABASE_URL        — PostgreSQL connection string
 *   GEMINI_API_KEY      — Google AI API key (for summarization + embeddings)
 *   QDRANT_URL          — Qdrant REST endpoint (e.g., http://localhost:6333)
 *   QDRANT_API_KEY      — Qdrant API key
 *   QDRANT_COLLECTION   — Collection name (default: telegram_history)
 */

const { Client } = require('pg');

// ── Config ──────────────────────────────────────────────────────

const DATABASE_URL      = process.env.DATABASE_URL;
const GEMINI_API_KEY    = process.env.GEMINI_API_KEY;
const QDRANT_URL        = process.env.QDRANT_URL        || 'http://localhost:6333';
const QDRANT_API_KEY    = process.env.QDRANT_API_KEY;
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION  || 'telegram_history';
const BATCH_GAP_MS      = 30 * 60 * 1000; // 30 minutes between batches
const EMBEDDING_MODEL   = 'gemini-embedding-001';
const SUMMARY_MODEL     = 'gemini-2.0-flash';

if (!DATABASE_URL || !GEMINI_API_KEY) {
  console.error('Missing required env vars: DATABASE_URL, GEMINI_API_KEY');
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────

async function fetchUnembeddedMessages(pg) {
  const { rows } = await pg.query(`
    SELECT id, channel, sender, message_text, persona, timestamp
    FROM message_log
    WHERE embedded = false
    ORDER BY timestamp ASC
  `);
  return rows;
}

/**
 * Group messages into conversation batches.
 * A new batch starts when there's a 30+ minute gap between messages
 * or when the channel changes.
 */
function batchMessages(messages) {
  if (messages.length === 0) return [];

  const batches = [];
  let current = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const msg  = messages[i];
    const gap  = new Date(msg.timestamp) - new Date(prev.timestamp);
    const channelChanged = msg.channel !== prev.channel;

    if (gap > BATCH_GAP_MS || channelChanged) {
      batches.push(current);
      current = [msg];
    } else {
      current.push(msg);
    }
  }
  batches.push(current);
  return batches;
}

async function summarizeBatch(batch) {
  const transcript = batch
    .map(m => `[${m.sender}] ${m.message_text}`)
    .join('\n');

  const prompt = `Summarize this conversation in 2-4 sentences. Include: main topics discussed, any decisions made, emotional tone, and action items if any.\n\n${transcript}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${SUMMARY_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 300 }
      })
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini summarization failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function embedText(text) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text }] }
      })
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini embedding failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.embedding?.values;
}

async function upsertToQdrant(pointId, vector, payload) {
  const url = `${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points`;
  const headers = { 'Content-Type': 'application/json' };
  if (QDRANT_API_KEY) headers['api-key'] = QDRANT_API_KEY;

  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      points: [{
        id: pointId,
        vector,
        payload
      }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Qdrant upsert failed: ${res.status} ${err}`);
  }
}

async function markAsEmbedded(pg, messageIds) {
  if (messageIds.length === 0) return;
  await pg.query(
    `UPDATE message_log SET embedded = true WHERE id = ANY($1)`,
    [messageIds]
  );
}

async function getNextPointId() {
  const headers = { 'Content-Type': 'application/json' };
  if (QDRANT_API_KEY) headers['api-key'] = QDRANT_API_KEY;

  const res = await fetch(
    `${QDRANT_URL}/collections/${QDRANT_COLLECTION}`,
    { headers }
  );

  if (!res.ok) return Date.now(); // fallback
  const data = await res.json();
  return (data.result?.points_count || 0) + 1;
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();

  try {
    const messages = await fetchUnembeddedMessages(pg);

    if (messages.length === 0) {
      console.log('No un-embedded messages found. Nothing to do.');
      return;
    }

    console.log(`Found ${messages.length} un-embedded messages.`);
    const batches = batchMessages(messages);
    console.log(`Grouped into ${batches.length} conversation batches.`);

    let pointId = await getNextPointId();
    let totalEmbedded = 0;

    for (const batch of batches) {
      const channel   = batch[0].channel;
      const persona   = batch[0].persona;
      const firstTs   = batch[0].timestamp;
      const lastTs    = batch[batch.length - 1].timestamp;
      const msgIds    = batch.map(m => m.id);

      console.log(`  Batch: ${channel} | ${batch.length} msgs | ${firstTs} -> ${lastTs}`);

      // 1. Summarize
      const summary = await summarizeBatch(batch);

      // 2. Embed the summary
      const vector = await embedText(summary);
      if (!vector) {
        console.error(`  Skipping batch — embedding returned null`);
        continue;
      }

      // 3. Upsert to Qdrant
      const payload = {
        summary,
        channel,
        persona,
        message_count: batch.length,
        first_message_at: firstTs,
        last_message_at: lastTs,
        source: 'embed-conversations.js'
      };

      await upsertToQdrant(pointId, vector, payload);

      // 4. Mark source rows as embedded
      await markAsEmbedded(pg, msgIds);

      // 5. Optionally store summary in PostgreSQL too
      await pg.query(`
        INSERT INTO conversation_summaries
          (channel, persona, summary, message_count, first_message_at, last_message_at, qdrant_point_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [channel, persona, summary, batch.length, firstTs, lastTs, pointId]);

      pointId++;
      totalEmbedded += batch.length;
    }

    console.log(`Done. Embedded ${totalEmbedded} messages across ${batches.length} batches.`);
  } finally {
    await pg.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
