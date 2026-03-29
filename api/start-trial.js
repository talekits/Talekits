const { put }           = require('@vercel/blob');
const { generateStory } = require('./generate-story');
const { getSupabase }   = require('./_supabase');

module.exports.maxDuration = 300;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { filename, content, profileJson, childName, email, gender } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'No profile content provided' });
  }

  // Save profile text to Blob
  try {
    await put(`profiles/${filename}`, content, {
      access: 'public', contentType: 'text/plain', addRandomSuffix: false,
    });
    console.log(`Kit profile saved: ${filename} | Child: ${childName} | Email: ${email}`);
  } catch (err) {
    console.error('Failed to save profile:', err.message);
    return res.status(500).json({ error: 'Failed to save profile' });
  }

  // If subscriber exists, save profile_json to Supabase
  if (profileJson && email) {
    try {
      const supabase = getSupabase();
      const { data: subscriber } = await supabase
        .from('subscribers').select('id').eq('email', email).maybeSingle();

      if (subscriber) {
        const { data: existing } = await supabase
          .from('child_profiles').select('id')
          .eq('subscriber_id', subscriber.id).eq('child_name', childName).maybeSingle();

        if (existing) {
          await supabase.from('child_profiles').update({
            profile_json, profile_content: content,
            updated_at: new Date().toISOString(),
          }).eq('id', existing.id);
        }
      }
    } catch (err) {
      console.warn('Could not save profile_json (non-fatal):', err.message);
    }
  }

  // Generate story and send email
  try {
    console.log(`Generating trial story for: ${childName}`);
    const outputs = await generateStory(content, childName, filename, 'kit', email);
    outputs.forEach(o => console.log(`Output saved: ${o.type} → ${o.url}`));
  } catch (err) {
    console.error('Story generation failed:', err.message);
  }

  return res.status(200).json({ success: true });
};
