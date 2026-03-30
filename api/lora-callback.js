const { getSupabase } = require('./_supabase');

/* ─────────────────────────────────────────────────────────────
   lora-callback.js
   POST /api/lora-callback?profile_id=<uuid>

   fal.ai calls this endpoint when a LoRA training job finishes.
   We extract the trained model URL and save it to Supabase so
   the scheduler can use it in the next story generation.

   Secure this endpoint by verifying the fal.ai webhook secret.
   Add FAL_WEBHOOK_SECRET to your Vercel env vars — fal.ai sends
   it in the x-fal-webhook-secret header.
───────────────────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify fal.ai webhook secret
  const secret = req.headers['x-fal-webhook-secret'];
  if (process.env.FAL_WEBHOOK_SECRET && secret !== process.env.FAL_WEBHOOK_SECRET) {
    console.warn('[LORA-CB] Invalid webhook secret');
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const profileId = req.query.profile_id;
  if (!profileId) {
    return res.status(400).json({ error: 'profile_id query param required' });
  }

  let body = req.body;

  // Vercel doesn't auto-parse JSON for all content types — handle both
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  console.log(`[LORA-CB] Callback received for profile: ${profileId}`);
  console.log(`[LORA-CB] Status: ${body?.status} | Error: ${body?.error || 'none'}`);

  const supabase = getSupabase();

  // fal.ai sends { status: 'OK', output: { diffusers_lora_file: { url: '...' } } }
  // or { status: 'ERROR', error: '...' }
  if (body?.status === 'ERROR' || body?.error) {
    console.error(`[LORA-CB] Training failed for profile ${profileId}: ${body.error}`);

    await supabase.from('child_profiles').update({
      lora_status: 'failed',
      updated_at:  new Date().toISOString(),
    }).eq('id', profileId);

    return res.status(200).json({ received: true, status: 'failed' });
  }

  // Extract the LoRA weights URL from fal.ai response
  // fal.ai returns: output.diffusers_lora_file.url
  const loraUrl =
    body?.output?.diffusers_lora_file?.url ||
    body?.output?.lora_file?.url ||
    body?.output?.model_url ||
    null;

  if (!loraUrl) {
    console.error(`[LORA-CB] No LoRA URL in callback body for profile ${profileId}`);
    console.error('[LORA-CB] Full body:', JSON.stringify(body));

    await supabase.from('child_profiles').update({
      lora_status: 'failed',
      updated_at:  new Date().toISOString(),
    }).eq('id', profileId);

    return res.status(200).json({ received: true, status: 'no_url' });
  }

  // Save the LoRA URL — scheduler will pick this up at next story generation
  const { error } = await supabase.from('child_profiles').update({
    lora_url:        loraUrl,
    lora_status:     'ready',
    lora_trained_at: new Date().toISOString(),
    updated_at:      new Date().toISOString(),
  }).eq('id', profileId);

  if (error) {
    console.error(`[LORA-CB] Failed to save lora_url to Supabase: ${error.message}`);
    return res.status(500).json({ error: 'DB update failed' });
  }

  console.log(`[LORA-CB] LoRA ready for profile ${profileId} | URL: ${loraUrl}`);
  return res.status(200).json({ received: true, status: 'ready' });
};
