const { put }         = require('@vercel/blob');
const { getSupabase } = require('./_supabase');

module.exports.config = { api: { bodyParser: { sizeLimit: '25mb' } } };

/* Auth helper — extract and verify token from Authorization header */
async function getAuthUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) throw new Error('Not authenticated');
  const supabase = getSupabase();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error('Invalid or expired token');
  return user;
}

const ALLOWED_TYPES   = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES       = 5 * 1024 * 1024; // 5MB per photo
const MIN_PHOTOS      = 3;
const MAX_PHOTOS      = 6;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  let authUser;
  try {
    authUser = await getAuthUser(req);
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }

  const supabase = getSupabase();

  // ── Resolve subscriber ────────────────────────────────────────────────────
  const { data: subscriber } = await supabase
    .from('subscribers')
    .select('id, plan')
    .eq('auth_id', authUser.id)
    .maybeSingle();

  if (!subscriber) {
    return res.status(404).json({ error: 'Subscriber not found' });
  }

  const { profileId, photos } = req.body;

  if (!profileId) {
    return res.status(400).json({ error: 'profileId is required' });
  }
  if (!Array.isArray(photos) || photos.length < MIN_PHOTOS) {
    return res.status(400).json({ error: `Please provide at least ${MIN_PHOTOS} photos` });
  }
  if (photos.length > MAX_PHOTOS) {
    return res.status(400).json({ error: `Maximum ${MAX_PHOTOS} photos allowed` });
  }

  // ── Verify the profile belongs to this subscriber and has char_custom ─────
  const { data: profile } = await supabase
    .from('child_profiles')
    .select('id, child_name, char_custom, char_custom_photos_uploaded')
    .eq('id', profileId)
    .eq('subscriber_id', subscriber.id)
    .maybeSingle();

  if (!profile) {
    return res.status(403).json({ error: 'Profile not found' });
  }
  if (!profile.char_custom) {
    return res.status(403).json({ error: 'Character Customisation is not enabled for this profile' });
  }

  // ── Validate each photo ───────────────────────────────────────────────────
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    if (!photo.data || !photo.type) {
      return res.status(400).json({ error: `Photo ${i + 1} is missing data or type` });
    }
    if (!ALLOWED_TYPES.has(photo.type)) {
      return res.status(400).json({ error: `Photo ${i + 1}: unsupported type ${photo.type}. Use JPEG, PNG, or WebP.` });
    }
    const byteLength = Buffer.from(photo.data, 'base64').length;
    if (byteLength > MAX_BYTES) {
      return res.status(400).json({ error: `Photo ${i + 1} exceeds the 5MB limit` });
    }
  }

  // ── Upload photos to Vercel Blob ──────────────────────────────────────────
  const uploadedUrls = [];
  const basePath     = `char-photos/${subscriber.id}/${profileId}`;
  const ext          = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

  try {
    for (let i = 0; i < photos.length; i++) {
      const photo  = photos[i];
      const buffer = Buffer.from(photo.data, 'base64');
      const filename = `${String(i + 1).padStart(2, '0')}.${ext[photo.type] || 'jpg'}`;

      const blob = await put(`${basePath}/${filename}`, buffer, {
        access:          'public',
        contentType:     photo.type,
        addRandomSuffix: false,
      });

      uploadedUrls.push(blob.url);
      console.log(`[UPLOAD] Photo ${i + 1}/${photos.length} saved: ${blob.url}`);
    }
  } catch (err) {
    console.error('[UPLOAD] Blob storage error:', err.message);
    return res.status(500).json({ error: 'Failed to store photos. Please try again.' });
  }

  // ── Update child_profiles row in Supabase ─────────────────────────────────
  const { error: updateErr } = await supabase
    .from('child_profiles')
    .update({
      char_custom_photos_uploaded: true,
      char_custom_photos_path:     basePath,
      updated_at:                  new Date().toISOString(),
    })
    .eq('id', profileId);

  if (updateErr) {
    console.error('[UPLOAD] Supabase update error:', updateErr.message);
    // Photos are in blob storage even if the DB update fails — log but don't fail the request
  }

  console.log(`[UPLOAD] Complete — ${photos.length} photos for profile ${profileId} (${profile.child_name})`);

  return res.status(200).json({
    success:  true,
    path:     basePath,
    count:    uploadedUrls.length,
    urls:     uploadedUrls,
  });
};
