const { list, get } = require('@vercel/blob');

/* ─────────────────────────────────────────────────────────────
   /api/story-archive
   GET  ?email=xxx&page=1&limit=20   — list archive entries for an email
   No auth token needed here — the dashboard-api.js proxies this
   with the user's verified email from Supabase.
─────────────────────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { email, page = '1', limit = '20' } = req.query;
  if (!email) return res.status(400).json({ error: 'email required' });

  try {
    // List all index files for this email — stored as archive/index/{emailHash}/{storyId}.json
    const safeEmail = email.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const prefix    = `archive/index/${safeEmail}/`;

    const { blobs } = await list({ prefix, limit: 1000 });

    // Sort by uploadedAt descending (newest first)
    blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    // Paginate
    const pageNum   = Math.max(1, parseInt(page));
    const limitNum  = Math.min(50, Math.max(1, parseInt(limit)));
    const start     = (pageNum - 1) * limitNum;
    const paginated = blobs.slice(start, start + limitNum);

    // Fetch each index record
    const records = await Promise.all(
      paginated.map(async blob => {
        try {
          const r    = await fetch(blob.url);
          const data = await r.json();
          return data;
        } catch {
          return null;
        }
      })
    );

    const stories = records.filter(Boolean);

    // Group by date
    const byDate = {};
    stories.forEach(story => {
      const date = story.date || story.generatedAt?.slice(0, 10) || 'unknown';
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(story);
    });

    return res.status(200).json({
      stories,
      byDate,
      total:      blobs.length,
      page:       pageNum,
      totalPages: Math.ceil(blobs.length / limitNum),
    });
  } catch (err) {
    console.error('[story-archive] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
