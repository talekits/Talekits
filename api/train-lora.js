const { getSupabase } = require('./_supabase');

/* ─────────────────────────────────────────────────────────────
   train-lora.js
   Called from webhook.js after a Den (or higher) subscriber
   completes checkout. Submits a FLUX.2 LoRA training job to
   fal.ai using the child's profile art style as a style LoRA.

   Training costs ~$8 at 1000 steps (fal.ai: $0.008/step).
   Training takes 5–20 minutes depending on queue.
   fal.ai will POST to /api/lora-callback when done.

   Docs: https://fal.ai/models/fal-ai/flux-2-trainer
───────────────────────────────────────────────────────────── */

const FAL_TRAINER_URL = 'https://fal.run/fal-ai/flux-2-trainer';
const FAL_CALLBACK_URL = `${process.env.NEXT_PUBLIC_BASE_URL}/api/lora-callback`;

/* Plans that get a LoRA trained on signup */
const LORA_ELIGIBLE_PLANS = ['den', 'pack'];

/* ─────────────────────────────────────────────────────────────
   Build a training caption set from the child profile JSON.
   fal.ai trainer expects an array of { image_url, caption }
   objects. We don't have actual photos of the child — instead
   we're training a *style* LoRA so Kit's illustrations look
   consistent across stories.

   For a style LoRA, supply 10–20 example prompts describing
   Kit-the-fox's appearance in the chosen art style. These act
   as "captions" that teach the model the visual style.

   When you have actual reference images (e.g. from a LoRA
   image-upload feature), pass them here as { image_url, caption }.
───────────────────────────────────────────────────────────── */
function buildTrainingCaptions(profileJson, artStyle) {
  const childName = profileJson?.childName || 'the child';
  const style     = artStyle || 'soft watercolour with warm pastel tones';

  // Style LoRA seed captions — describes Kit the fox in various scenes
  // in the selected art style. Expand this list as you get more examples.
  const captions = [
    `A children's book illustration of Kit the fox, a small cheerful orange fox with bright curious eyes and a fluffy white-tipped tail, standing in a sunny meadow. Painted in ${style}. No text, no borders.`,
    `A children's book illustration of Kit the fox, a small cheerful orange fox with bright curious eyes and a fluffy white-tipped tail, reading a book under a tree. Painted in ${style}. No text, no borders.`,
    `A children's book illustration of Kit the fox, a small cheerful orange fox with bright curious eyes and a fluffy white-tipped tail, looking up at stars at night. Painted in ${style}. No text, no borders.`,
    `A children's book illustration of Kit the fox, a small cheerful orange fox with bright curious eyes and a fluffy white-tipped tail, splashing in a puddle. Painted in ${style}. No text, no borders.`,
    `A children's book illustration of Kit the fox, a small cheerful orange fox with bright curious eyes and a fluffy white-tipped tail, making friends with a rabbit. Painted in ${style}. No text, no borders.`,
  ];

  // fal.ai accepts text-only captions for style training (no image_url required)
  return captions.map(caption => ({ caption }));
}

/* ─────────────────────────────────────────────────────────────
   Main export — submit a LoRA training job for a child profile.
   Returns the fal.ai training request ID (stored in Supabase).
───────────────────────────────────────────────────────────── */
async function trainLoraForProfile({ childProfileId, profileJson, artStyle, subscriberId }) {
  if (!process.env.FAL_API_KEY) {
    throw new Error('FAL_API_KEY not set — cannot submit LoRA training job');
  }

  const supabase = getSupabase();
  const captions = buildTrainingCaptions(profileJson, artStyle);
  const steps    = 1000; // ~$8 at $0.008/step — good quality, reasonable cost

  console.log(`[LORA] Submitting training job for profile: ${childProfileId} | steps: ${steps}`);

  // Mark as training before we submit — prevents double-submission on webhook retry
  await supabase.from('child_profiles').update({
    lora_status: 'training',
    updated_at:  new Date().toISOString(),
  }).eq('id', childProfileId);

  const body = {
    steps,
    learning_rate:  0.0004,
    captions,
    // fal.ai will POST to this URL when training completes
    // Include profile ID so we know which record to update
    webhook_url: `${FAL_CALLBACK_URL}?profile_id=${childProfileId}`,
  };

  const response = await fetch(FAL_TRAINER_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Key ${process.env.FAL_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.detail || err?.message || `fal.ai trainer error ${response.status}`;

    // Mark as failed so the scheduler can fall back to GPT Image Mini
    await supabase.from('child_profiles').update({
      lora_status: 'failed',
      updated_at:  new Date().toISOString(),
    }).eq('id', childProfileId);

    throw new Error(`LoRA training submission failed: ${msg}`);
  }

  const data = await response.json();
  const modelId = data?.request_id || data?.id || null;

  // Store the fal.ai request ID so we can look it up later if the webhook fails
  await supabase.from('child_profiles').update({
    lora_model_id: modelId,
    lora_status:   'training',
    updated_at:    new Date().toISOString(),
  }).eq('id', childProfileId);

  console.log(`[LORA] Training job submitted | request_id: ${modelId} | profile: ${childProfileId}`);
  return modelId;
}

/* ─────────────────────────────────────────────────────────────
   Helper — should this plan get a LoRA trained on signup?
───────────────────────────────────────────────────────────── */
function isLoraEligible(plan) {
  return LORA_ELIGIBLE_PLANS.includes(plan);
}

module.exports = { trainLoraForProfile, isLoraEligible };
