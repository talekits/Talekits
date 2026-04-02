const { getSupabase }    = require('./_supabase');
const { generateStory }  = require('./generate-story');

module.exports.maxDuration = 300;

/* ─────────────────────────────────────────────────────────────
   GET /api/schedule-stories
   Called hourly by Vercel Cron.
   Protected by CRON_SECRET header or query param.

   Delivery time logic:
   - Subscribers store delivery_time as a local time (e.g. "21:00")
     and delivery_timezone as an IANA timezone (e.g. "Australia/Melbourne").
   - Each hour we compute what local time it currently is in each
     subscriber's timezone, then match against their stored delivery_time.
   - This means delivery always fires at the correct local time regardless
     of DST changes or UTC offset differences.
─────────────────────────────────────────────────────────────── */

/**
 * Get the current local HH:MM in an IANA timezone.
 * Falls back to UTC if the timezone is invalid.
 */
function localHourMinute(timezone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-AU', {
      timeZone: timezone,
      hour:     '2-digit',
      minute:   '2-digit',
      hour12:   false,
    });
    // Returns e.g. "21:00" or "09:00"
    const parts = fmt.formatToParts(new Date());
    const h = parts.find(p => p.type === 'hour')?.value   || '00';
    const m = parts.find(p => p.type === 'minute')?.value || '00';
    return `${h}:${m}`;
  } catch {
    // Fallback to UTC
    const now = new Date();
    return `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')}`;
  }
}

module.exports = async function handler(req, res) {
  // Security — accept CRON_SECRET via header/query param, OR Vercel's internal cron invocation
  const secret       = req.headers['x-cron-secret'] || req.query.secret;
  const isVercelCron = req.headers['x-vercel-cron-signature'] !== undefined
                    || req.headers['x-vercel-id'] !== undefined;

  if (secret !== process.env.CRON_SECRET && !isVercelCron) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const supabase = getSupabase();
  const now      = new Date();
  const results  = { processed: 0, sent: 0, failed: 0, skipped: 0 };

  console.log(`[CRON] Daily story scheduler started at ${now.toISOString()}`);

  try {
    // Fetch ALL active subscribers — we filter by local time below
    const { data: subscribers, error } = await supabase
      .from('subscribers')
      .select(`
        id, email, plan, status, delivery_time, delivery_timezone, narrator_voice,
        child_profiles (id, child_name, gender, profile_content, profile_json, profile_blob_url, is_active)
      `)
      .in('status', ['active', 'trial']);

    if (error) throw new Error(`Failed to fetch subscribers: ${error.message}`);

    console.log(`[CRON] Checking ${subscribers?.length || 0} active subscribers for delivery`);

    for (const subscriber of (subscribers || [])) {
      // Determine the subscriber's current local time
      const tz            = subscriber.delivery_timezone || 'Australia/Melbourne';
      const localNow      = localHourMinute(tz);
      const deliveryTime  = subscriber.delivery_time || '07:00';

      // Match on HH:00 — cron runs on the hour so we only need to match the hour
      const deliveryHour = deliveryTime.slice(0, 5); // "21:00"
      const localHour    = localNow.slice(0, 2) + ':00'; // "21:00"

      if (deliveryHour !== localHour) {
        // Not their delivery hour — skip silently
        continue;
      }

      console.log(`[CRON] Delivery due for ${subscriber.email} | local time ${localNow} in ${tz}`);

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
          // Use the subscriber's local date (not UTC) to avoid double-sending across midnight
          const localDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now); // "YYYY-MM-DD"
          const { data: todayDelivery } = await supabase
            .from('story_deliveries')
            .select('id')
            .eq('child_profile_id', profile.id)
            .gte('scheduled_for', `${localDateStr}T00:00:00Z`)
            .not('status', 'eq', 'failed')
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
            profileJson,
            subscriber.narrator_voice || 'au_female'
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
