#!/usr/bin/env node
/**
 * qdrant-search.js
 *
 * Semantic search across Qdrant vector collections.
 * Embeds the query string via Gemini, then searches Qdrant with cosine similarity.
 *
 * Usage:
 *   node qdrant-search.js <collection> "<query>" [limit]
 *
 * Examples:
 *   node qdrant-search.js knowledge_base "pricing strategy" 5
 *   node qdrant-search.js telegram_history "what did we discuss about caching" 3
 *
 * Environment variables (all required):
 *   GEMINI_API_KEY    — Google AI API key (for query embedding)
 *   QDRANT_URL        — Qdrant REST endpoint (default: http://localhost:6333)
 *   QDRANT_API_KEY    — Qdrant API key
 */

const GEMINI_API_KEY  = process.env.GEMINI_API_KEY;
const QDRANT_URL      = process.env.QDRANT_URL      || 'http://localhost:6333';
const QDRANT_API_KEY  = process.env.QDRANT_API_KEY;
const EMBEDDING_MODEL = 'gemini-embedding-001';

// ── Argument parsing ────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: node qdrant-search.js <collection> "<query>" [limit]');
  console.error('');
  console.error('Collections: knowledge_base, telegram_history, coaching_context, journal_entries');
  process.exit(1);
}

const collection = args[0];
const query      = args[1];
const limit      = parseInt(args[2], 10) || 5;

if (!GEMINI_API_KEY) {
  console.error('Missing required env var: GEMINI_API_KEY');
  process.exit(1);
}

// ── Functions ───────────────────────────────────────────────────

async function embedQuery(text) {
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

async function searchQdrant(collectionName, vector, topK) {
  const url = `${QDRANT_URL}/collections/${collectionName}/points/search`;
  const headers = { 'Content-Type': 'application/json' };
  if (QDRANT_API_KEY) headers['api-key'] = QDRANT_API_KEY;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      vector,
      limit: topK,
      with_payload: true,
      with_vector: false
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Qdrant search failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.result || [];
}

function formatResult(result, index) {
  const { score, payload } = result;
  const lines = [`--- Result ${index + 1} (score: ${score.toFixed(4)}) ---`];

  if (payload.title)            lines.push(`Title: ${payload.title}`);
  if (payload.author)           lines.push(`Author: ${payload.author}`);
  if (payload.source)           lines.push(`Source: ${payload.source}`);
  if (payload.channel)          lines.push(`Channel: ${payload.channel}`);
  if (payload.first_message_at) lines.push(`Date: ${payload.first_message_at}`);
  if (payload.category)         lines.push(`Category: ${payload.category}`);

  // Main content — could be summary, text, highlight, etc.
  const content = payload.summary || payload.text || payload.highlight || payload.content;
  if (content) {
    lines.push('');
    lines.push(content.length > 500 ? content.substring(0, 500) + '...' : content);
  }

  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  console.log(`Searching "${collection}" for: "${query}" (top ${limit})\n`);

  // 1. Embed the query
  const vector = await embedQuery(query);
  if (!vector) {
    throw new Error('Embedding returned null vector');
  }

  // 2. Search Qdrant
  const results = await searchQdrant(collection, vector, limit);

  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  // 3. Display results
  for (let i = 0; i < results.length; i++) {
    console.log(formatResult(results[i], i));
    if (i < results.length - 1) console.log('');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
