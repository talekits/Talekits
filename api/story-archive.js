const { list }        = require('@vercel/blob');
const { getSupabase } = require('./_supabase');

/* ─────────────────────────────────────────────────────────────
   /api/story-archive
   GET ?page=1&limit=20
   Authenticated via Bearer token (same as dashboard-api).
   Looks up the user's email from Supabase, then lists their
   archive blobs from Vercel Blob storage.
─────────────────────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // ── Auth ──────────────────────────────────────────────────
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const supabase = getSupabase();
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  // Get the subscriber email (auth email is the canonical one)
  const email = user.email;
  if (!email) return res.status(400).json({ error: 'No email on account' });

  // ── Pagination params ─────────────────────────────────────
  const { page = '1', limit = '20' } = req.query;
  const pageNum  = Math.max(1, parseInt(page)  || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 20));

  try {
    // List all index files for this email
    const safeEmail = email.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const prefix    = `archive/index/${safeEmail}/`;

    const { blobs } = await list({ prefix, limit: 1000 });

    // Sort by uploadedAt descending (newest first)
    blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    // Paginate
    const start     = (pageNum - 1) * limitNum;
    const paginated = blobs.slice(start, start + limitNum);

    // Fetch each index record
    const records = await Promise.all(
      paginated.map(async blob => {
        try {
          const r    = await fetch(blob.url);
          if (!r.ok) return null;
          return await r.json();
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
