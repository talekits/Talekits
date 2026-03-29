const { getSupabase } = require('./_supabase');

/* Auth helper — extract and verify token from Authorization header */
async function getAuthUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) throw new Error('Not authenticated');
  const supabase = getSupabase();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error('Invalid or expired token');
  return user;
}

module.exports = async function handler(req, res) {
  const { action } = req.query;
  const supabase   = getSupabase();

  let authUser;
  try {
    authUser = await getAuthUser(req);
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }

  // Get subscriber record for this auth user
  const { data: subscriber } = await supabase
    .from('subscribers')
    .select('id, plan, status, delivery_time, delivery_timezone')
    .eq('auth_id', authUser.id)
    .maybeSingle();

  if (!subscriber) return res.status(404).json({ error: 'Subscriber not found' });

  /* ── GET /api/dashboard?action=overview ── */
  if (req.method === 'GET' && action === 'overview') {
    const { data: profiles } = await supabase
      .from('child_profiles')
      .select('id, child_name, gender, profile_content, profile_json, is_active, created_at')
      .eq('subscriber_id', subscriber.id)
      .order('created_at');

    const { data: recentStories } = await supabase
      .from('story_deliveries')
      .select('id, story_title, plan, status, story_pdf_url, picturebook_url, sent_at, created_at, child_profile_id')
      .eq('subscriber_id', subscriber.id)
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(20);

    return res.status(200).json({ subscriber, profiles, recentStories });
  }

  /* ── PATCH /api/dashboard?action=delivery-settings ── */
  if (req.method === 'PATCH' && action === 'delivery-settings') {
    const { delivery_time, delivery_timezone } = req.body;
    if (!delivery_time) return res.status(400).json({ error: 'delivery_time required (HH:MM)' });

    const { error } = await supabase
      .from('subscribers')
      .update({ delivery_time, delivery_timezone: delivery_timezone || 'UTC', updated_at: new Date().toISOString() })
      .eq('id', subscriber.id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  /* ── POST /api/dashboard?action=add-profile ── */
  if (req.method === 'POST' && action === 'add-profile') {
    const PROFILE_LIMITS = { cub: 1, scout: 3, den: 5, pack: 30, kit: 1 };
    const limit = PROFILE_LIMITS[subscriber.plan] || 1;

    const { count } = await supabase
      .from('child_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('subscriber_id', subscriber.id)
      .eq('is_active', true);

    if ((count || 0) >= limit) {
      return res.status(400).json({ error: `Your ${subscriber.plan} plan supports up to ${limit} child profile${limit > 1 ? 's' : ''}` });
    }

    const { child_name, gender, profile_content, profile_json } = req.body;
    if (!child_name) return res.status(400).json({ error: 'child_name required' });

    const { data: profile, error } = await supabase
      .from('child_profiles')
      .insert({
        subscriber_id: subscriber.id, child_name,
        gender: gender || null,
        profile_content: profile_content || '',
        profile_json: profile_json || null,
        is_active: true,
      })
      .select('id, child_name, gender').single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ profile });
  }

  /* ── PATCH /api/dashboard?action=update-profile ── */
  if (req.method === 'PATCH' && action === 'update-profile') {
    const { profile_id, child_name, gender, profile_content, profile_json, is_active } = req.body;
    if (!profile_id) return res.status(400).json({ error: 'profile_id required' });

    const { data: existing } = await supabase
      .from('child_profiles').select('id').eq('id', profile_id).eq('subscriber_id', subscriber.id).maybeSingle();
    if (!existing) return res.status(403).json({ error: 'Profile not found' });

    const updates = {};
    if (child_name     !== undefined) updates.child_name     = child_name;
    if (gender         !== undefined) updates.gender         = gender;
    if (profile_content !== undefined) updates.profile_content = profile_content;
    if (profile_json   !== undefined) updates.profile_json   = profile_json;
    if (is_active      !== undefined) updates.is_active      = is_active;
    updates.updated_at = new Date().toISOString();

    const { error } = await supabase.from('child_profiles').update(updates).eq('id', profile_id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  /* ── GET /api/dashboard?action=story-archive ── */
  if (req.method === 'GET' && action === 'story-archive') {
    const page  = parseInt(req.query.page  || '1');
    const limit = parseInt(req.query.limit || '12');
    const from  = (page - 1) * limit;

    const { data: stories, count } = await supabase
      .from('story_deliveries')
      .select('id, story_title, plan, story_pdf_url, picturebook_url, sent_at, child_profile_id, child_profiles(child_name)', { count: 'exact' })
      .eq('subscriber_id', subscriber.id)
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .range(from, from + limit - 1);

    return res.status(200).json({ stories, total: count, page, limit });
  }

  return res.status(404).json({ error: 'Unknown action' });
};
