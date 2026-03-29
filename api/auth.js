const { getSupabase } = require('./_supabase');

module.exports = async function handler(req, res) {
  const { action } = req.query;
  const supabase   = getSupabase();

  /* ── POST /api/auth?action=login ── */
  if (req.method === 'POST' && action === 'login') {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Invalid email or password' });

    return res.status(200).json({
      access_token:  data.session.access_token,
      refresh_token: data.session.refresh_token,
      user:          { id: data.user.id, email: data.user.email },
    });
  }

  /* ── POST /api/auth?action=reset-password ── */
  if (req.method === 'POST' && action === 'reset-password') {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard?setup=true`,
    });
    if (error) return res.status(400).json({ error: error.message });

    return res.status(200).json({ success: true });
  }

  /* ── POST /api/auth?action=set-password ── */
  if (req.method === 'POST' && action === 'set-password') {
    const { access_token, password } = req.body;
    if (!access_token || !password) {
      return res.status(400).json({ error: 'Token and password required' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(access_token);
    if (error || !user) return res.status(401).json({ error: 'Invalid token' });

    const { error: updateErr } = await supabase.auth.admin.updateUserById(user.id, { password });
    if (updateErr) return res.status(400).json({ error: updateErr.message });

    return res.status(200).json({ success: true });
  }

  /* ── GET /api/auth?action=me ── */
  if (req.method === 'GET' && action === 'me') {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid or expired token' });

    // Fetch subscriber data
    const { data: subscriber } = await supabase
      .from('subscribers')
      .select(`
        id, email, plan, status, delivery_time, delivery_timezone, narrator_voice,
        trial_ends_at, subscribed_at,
        child_profiles (id, child_name, gender, profile_content, profile_json, is_active, created_at)
      `)
      .eq('auth_id', user.id)
      .maybeSingle();

    return res.status(200).json({ user, subscriber });
  }

  return res.status(404).json({ error: 'Unknown action' });
};
