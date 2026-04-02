const { getSupabase }   = require('./_supabase');
const { generateStory } = require('./generate-story');

module.exports.maxDuration = 300;

/* ─────────────────────────────────────────────────────────────
   POST /api/admin-generate
   Admin-only endpoint to trigger a test story generation for
   any subscriber without going through checkout or the cron.
   Protected by ADMIN_SECRET header or query param.

   Body: { email?, profileId? }
   - email defaults to the first active subscriber found if omitted
   - profileId defaults to the first active child profile if omitted
─────────────────────────────────────────────────────────────── */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth — require ADMIN_SECRET
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorised — ADMIN_SECRET required' });
  }

  const supabase = getSupabase();
  const { email = 'test@talekits.com', profileId } = req.body || {};

  try {
    // Fetch subscriber by email
    const { data: subscriber, error: subErr } = await supabase
      .from('subscribers')
      .select(`
        id, email, plan, status, narrator_voice,
        child_profiles (id, child_name, gender, profile_content, profile_json, profile_blob_url, is_active)
      `)
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (subErr) throw new Error(`Subscriber lookup failed: ${subErr.message}`);
    if (!subscriber) return res.status(404).json({ error: `No subscriber found for email: ${email}` });

    // Pick the target profile
    const activeProfiles = (subscriber.child_profiles || []).filter(p => p.is_active);
    if (!activeProfiles.length) {
      return res.status(400).json({ error: `No active child profiles for ${email}` });
    }

    const profile = profileId
      ? activeProfiles.find(p => p.id === profileId)
      : activeProfiles[0];

    if (!profile) {
      return res.status(404).json({ error: `Profile ID ${profileId} not found or not active` });
    }

    // Resolve profile content
    let profileContent = profile.profile_content;
    const profileJson  = profile.profile_json || null;

    if (!profileContent && profile.profile_blob_url) {
      const r = await fetch(profile.profile_blob_url);
      if (r.ok) profileContent = await r.text();
    }

    if (!profileContent && !profileJson) {
      return res.status(400).json({ error: `No profile content for ${profile.child_name}` });
    }

    const now      = new Date();
    const dateStr  = now.toISOString().slice(0, 10);
    const safeName = profile.child_name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const filename = `talekits-profile-${safeName}-${dateStr}-admin.txt`;

    console.log(`[ADMIN] Generating test story | email: ${email} | child: ${profile.child_name} | plan: ${subscriber.plan}`);

    // Log to story_deliveries so it appears in the dashboard archive
    const { data: deliveryLog } = await supabase
      .from('story_deliveries')
      .insert({
        subscriber_id:    subscriber.id,
        child_profile_id: profile.id,
        plan:             subscriber.plan,
        status:           'generating',
        scheduled_for:    now.toISOString(),
      })
      .select('id')
      .single();

    // Run generation
    const outputs = await generateStory(
      profileContent,
      profile.child_name,
      filename,
      subscriber.plan,
      subscriber.email,
      profileJson,
      subscriber.narrator_voice || 'au_female'
    );

    // Update delivery log
    const get = (type) => outputs.find(o => o.type === type)?.url || null;
    await supabase
      .from('story_deliveries')
      .update({
        status:            'sent',
        story_txt_url:     get('story-txt'),
        illustrations_url: get('illustrations-txt'),
        story_pdf_url:     get('story-pdf'),
        picturebook_url:   get('picturebook-pdf'),
        sent_at:           now.toISOString(),
      })
      .eq('id', deliveryLog?.id);

    console.log(`[ADMIN] Test generation complete for: ${profile.child_name}`);

    return res.status(200).json({
      success: true,
      email,
      childName: profile.child_name,
      plan: subscriber.plan,
      outputs: outputs.map(o => ({ type: o.type, url: o.url || null, filename: o.filename || null })),
    });

  } catch (err) {
    console.error(`[ADMIN] Generation error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
};
