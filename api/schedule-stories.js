const { getSupabase }    = require('./_supabase');
const { generateStory }  = require('./generate-story');
const { list }           = require('@vercel/blob');

module.exports.maxDuration = 300;

/* ─────────────────────────────────────────────────────────────
   GET /api/schedule-stories
   Called daily by a cron job (Vercel Cron or external service)
   Protected by CRON_SECRET header
─────────────────────────────────────────────────────────────── */
module.exports = async function handler(req, res) {
  // Security — only allow requests with the correct secret
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const supabase = getSupabase();
  const now      = new Date();
  const results  = { processed: 0, sent: 0, failed: 0, skipped: 0 };

  console.log(`[CRON] Daily story scheduler started at ${now.toISOString()}`);

  try {
    // Fetch all active subscribers due for a story right now
    // We check delivery_time against current UTC hour (simplified — timezone support can be added later)
    const currentHour = now.getUTCHours().toString().padStart(2, '0') + ':00';

    const { data: subscribers, error } = await supabase
      .from('subscribers')
      .select(`
        id, email, plan, status, delivery_time, delivery_timezone,
        child_profiles (id, child_name, gender, profile_content, profile_json, profile_blob_url, is_active)
      `)
      .in('status', ['active', 'trial'])
      .eq('delivery_time', currentHour);

    if (error) throw new Error(`Failed to fetch subscribers: ${error.message}`);

    console.log(`[CRON] Found ${subscribers?.length || 0} subscribers due for delivery at ${currentHour} UTC`);

    for (const subscriber of (subscribers || [])) {
      const activeProfiles = (subscriber.child_profiles || []).filter(p => p.is_active);

      if (!activeProfiles.length) {
        console.warn(`[CRON] No active profiles for subscriber: ${subscriber.id}`);
        results.skipped++;
        continue;
      }

      // Send a story for each active child profile
      for (const profile of activeProfiles) {
        results.processed++;

        try {
          console.log(`[CRON] Generating story | Subscriber: ${subscriber.id} | Child: ${profile.child_name} | Plan: ${subscriber.plan}`);

          // Get profile content — prefer JSON (accurate), fall back to text, then Blob
          let profileContent = profile.profile_content;
          let profileJson    = profile.profile_json || null;

          if (!profileContent && profile.profile_blob_url) {
            const r = await fetch(profile.profile_blob_url);
            if (r.ok) profileContent = await r.text();
          }

          if (!profileContent && !profileJson) {
            console.error(`[CRON] No profile data for: ${profile.child_name}`);
            results.failed++;
            continue;
          }

          // Generate a unique filename for today's story
          const dateStr  = now.toISOString().slice(0, 10);
          const safeName = profile.child_name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
          const filename = `talekits-profile-${safeName}-${dateStr}.txt`;

          // Check we haven't already sent a story today for this profile
          const { data: todayDelivery } = await supabase
            .from('story_deliveries')
            .select('id')
            .eq('child_profile_id', profile.id)
            .gte('created_at', `${dateStr}T00:00:00Z`)
            .maybeSingle();

          if (todayDelivery) {
            console.log(`[CRON] Story already sent today for: ${profile.child_name} — skipping`);
            results.skipped++;
            continue;
          }

          // Log as pending before starting
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

          // Generate story + send email
          const outputs = await generateStory(
            profileContent,
            profile.child_name,
            filename,
            subscriber.plan,
            subscriber.email,
            profileJson
          );

          // Update delivery log with results
          const get = (type) => outputs.find(o => o.type === type)?.url || null;
          await supabase
            .from('story_deliveries')
            .update({
              status:            'sent',
              story_txt_url:     get('story-txt'),
              illustrations_url: get('illustrations-txt'),
              story_pdf_url:     get('story-pdf'),
              picturebook_url:   get('picturebook-pdf'),
              sent_at:           new Date().toISOString(),
            })
            .eq('id', deliveryLog?.id);

          results.sent++;
          console.log(`[CRON] Story sent for: ${profile.child_name} | Subscriber: ${subscriber.id}`);

        } catch (storyErr) {
          results.failed++;
          console.error(`[CRON] Story generation failed for ${profile.child_name}: ${storyErr.message}`);

          // Log failure in Supabase
          await supabase.from('story_deliveries').update({
            status: 'failed', error_message: storyErr.message,
          }).eq('child_profile_id', profile.id).eq('status', 'generating');
        }
      }
    }

  } catch (err) {
    console.error(`[CRON] Scheduler error: ${err.message}`);
    return res.status(500).json({ error: err.message, results });
  }

  console.log(`[CRON] Scheduler complete:`, results);
  return res.status(200).json({ success: true, results });
};
