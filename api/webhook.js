const Stripe          = require('stripe');
const { put, del, list } = require('@vercel/blob');
const { generateStory }  = require('./generate-story');
const { getSupabase }    = require('./_supabase');

module.exports.config     = { api: { bodyParser: false } };
module.exports.maxDuration = 300;

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function createSubscriberAccount({ email, plan, childName, gender, stripeCustomerId, stripeSubId, profileContent, profileJson, profileBlobUrl, narratorVoice }) {
  const supabase = getSupabase();

  const { data: existing } = await supabase
    .from('subscribers')
    .select('id, auth_id')
    .eq('email', email)
    .maybeSingle();

  let subscriberId = existing?.id;
  let authId       = existing?.auth_id;

  if (!existing) {
    const tempPassword = require('crypto').randomUUID();
    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email, password: tempPassword, email_confirm: true,
    });
    if (authErr) throw new Error(`Auth user creation failed: ${authErr.message}`);
    authId = authUser.user.id;

    const trialEndsAt = plan === 'kit'
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const { data: sub, error: subErr } = await supabase
      .from('subscribers')
      .insert({
        auth_id: authId, email,
        stripe_customer_id: stripeCustomerId,
        stripe_sub_id: stripeSubId,
        plan, status: plan === 'kit' ? 'trial' : 'active',
        trial_ends_at: trialEndsAt,
        delivery_time: '07:00',
        delivery_timezone: 'Australia/Melbourne',
        narrator_voice: narratorVoice || 'au_female',
      })
      .select('id').single();
    if (subErr) throw new Error(`Subscriber row creation failed: ${subErr.message}`);
    subscriberId = sub.id;

    // Send password setup email
    await supabase.auth.admin.generateLink({
      type: 'recovery', email,
      options: { redirectTo: `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard?setup=true` },
    });
  } else {
    await supabase.from('subscribers').update({
      stripe_customer_id: stripeCustomerId,
      stripe_sub_id: stripeSubId, plan, status: 'active',
    }).eq('id', subscriberId);
  }

  const { data: profile, error: profileErr } = await supabase
    .from('child_profiles')
    .insert({
      subscriber_id:    subscriberId,
      child_name:       childName,
      gender:           gender || null,
      profile_content:  profileContent,
      profile_json:     profileJson || null,
      profile_blob_url: profileBlobUrl,
      is_active:        true,
    })
    .select('id').single();
  if (profileErr) throw new Error(`Child profile creation failed: ${profileErr.message}`);

  return { subscriberId, authId, childProfileId: profile.id };
}

async function logDelivery({ subscriberId, childProfileId, plan, outputs }) {
  const supabase = getSupabase();
  try {
    const get = (type) => outputs.find(o => o.type === type)?.url || null;
    const titleOutput = outputs.find(o => o.type === 'story-txt');
    const storyTitle = titleOutput?.filename?.replace(/talekits-story-[^-]+-\d{4}-\d{2}-\d{2}/, '') || '';
    await supabase.from('story_deliveries').insert({
      subscriber_id: subscriberId, child_profile_id: childProfileId,
      plan, status: 'sent',
      story_txt_url:     get('story-txt'),
      illustrations_url: get('illustrations-txt'),
      story_pdf_url:     get('story-pdf'),
      picturebook_url:   get('picturebook-pdf'),
      sent_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Failed to log delivery:', err.message);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe    = Stripe(process.env.STRIPE_SECRET_KEY);
  const rawBody   = await getRawBody(req);
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session  = event.data.object;
  const meta          = session.metadata || {};
  const filename      = meta.filename;
  const plan          = meta.plan;
  const child         = meta.childName;
  const gender        = meta.gender;
  const email         = session.customer_email || meta.email || null;
  const narratorVoice = meta.narratorVoice || 'au_female';

  if (!filename) {
    console.warn('No filename in session metadata');
    return res.status(200).json({ received: true });
  }

  try {
    console.log(`[1] Looking for pending profile: pending/${filename}`);
    const { blobs } = await list({ prefix: `pending/${filename}` });
    console.log(`[1] Blobs found: ${blobs.length}`);
    if (!blobs.length) { console.warn(`[1] No pending profile found`); return res.status(200).json({ received: true }); }

    const pendingBlob    = blobs[0];
    console.log(`[2] Fetching profile from: ${pendingBlob.url}`);
    const profileContent = await fetch(pendingBlob.url).then(r => r.text());
    console.log(`[2] Profile fetched, length: ${profileContent.length} chars`);

    console.log(`[3] Saving confirmed profile`);
    const confirmedBlob = await put(`profiles/${filename}`, profileContent, {
      access: 'public', contentType: 'text/plain', addRandomSuffix: false,
    });
    await del(pendingBlob.url);
    console.log(`[3] Profile confirmed: ${filename} | Plan: ${plan} | Child: ${child}`);

    // Fetch the pending JSON blob if it exists
    let profileJson = null;
    try {
      const jsonFilename = filename.replace('.txt', '.json');
      const { blobs: jsonBlobs } = await list({ prefix: `pending/${jsonFilename}` });
      if (jsonBlobs.length) {
        profileJson = await fetch(jsonBlobs[0].url).then(r => r.json());
        await del(jsonBlobs[0].url);
        // Save confirmed JSON alongside
        await put(`profiles/${jsonFilename}`, JSON.stringify(profileJson), {
          access: 'public', contentType: 'application/json', addRandomSuffix: false,
        });
        console.log(`[3] Profile JSON confirmed: ${jsonFilename}`);
      }
    } catch (err) {
      console.warn(`[3] Could not load profile JSON (non-fatal): ${err.message}`);
    }

    console.log(`[3b] Creating Supabase account for: ${email}`);
    let subscriberId = null, childProfileId = null;
    try {
      const result = await createSubscriberAccount({
        email, plan, childName: child, gender,
        stripeCustomerId: session.customer, stripeSubId: session.subscription,
        profileContent, profileJson, profileBlobUrl: confirmedBlob.url,
        narratorVoice,
      });
      subscriberId   = result.subscriberId;
      childProfileId = result.childProfileId;
      console.log(`[3b] Account created | Subscriber: ${subscriberId}`);
    } catch (accErr) {
      console.error(`[3b] Account creation failed (continuing): ${accErr.message}`);
    }

    console.log(`[4] Starting story generation | Child: ${child} | Plan: ${plan} | Email: ${email}`);

    // Fetch narrator_voice from subscriber record (defaults to au_female if not set)
    let narratorVoice = 'au_female';
    if (subscriberId) {
      try {
        const supabase = getSupabase();
        const { data: subRow } = await supabase
          .from('subscribers').select('narrator_voice').eq('id', subscriberId).maybeSingle();
        if (subRow?.narrator_voice) narratorVoice = subRow.narrator_voice;
      } catch { /* non-fatal */ }
    }

    const outputs = await generateStory(profileContent, child, filename, plan, email, profileJson, narratorVoice);
    console.log(`[4] Story generation complete. Outputs: ${outputs.length}`);
    outputs.forEach(o => console.log(`[4] Output: ${o.type} → ${o.url || o.count}`));

    if (subscriberId) await logDelivery({ subscriberId, childProfileId, plan, outputs });

  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    console.error(err.stack);
  }

  return res.status(200).json({ received: true });
};
