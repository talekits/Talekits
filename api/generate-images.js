const { put } = require('@vercel/blob');

/* ─────────────────────────────────────────────────────────────
   Image provider selection.

   Flux 2 [dev] is the primary provider (fal-ai/flux/dev).
   Flux with LoRA is used for Character Customisation subscribers.
   GPT Image Mini is the emergency fallback only.

   TWO-PASS GENERATION:
   Pass 1 — Generate the cover image (index 0 in allPrompts).
   Pass 2 — For each page image, use fal-ai/flux/dev with the
             cover image injected as image_prompt (IP-Adapter).
             This locks in the art style and character design.
───────────────────────────────────────────────────────────── */

const GPT_IMAGE_MINI_QUALITY = 'low';

/* ─────────────────────────────────────────────────────────────
   Negative prompt — applied to every Flux request.
───────────────────────────────────────────────────────────── */
const NEGATIVE_PROMPT = [
  'realistic photograph', 'photorealistic', '3D render', 'CGI render',
  'low quality', 'blurry', 'watermark', 'text', 'speech bubble',
  'caption', 'border', 'frame', 'page edge', 'ruled line', 'red line',
  'dividing line', 'panel border', 'inconsistent character',
  'adult themes', 'violence', 'scary', 'dark atmosphere', 'horror',
].join(', ');

// Cover gets extra negative terms — we want richness, depth, drama on the cover,
// not the clean minimal look that works well for interior page illustrations.
const COVER_NEGATIVE_PROMPT = [
  ...NEGATIVE_PROMPT.split(', '),
  'empty background', 'minimalist', 'simple background', 'plain background',
  'flat composition', 'low detail', 'sparse scene', 'cropped', 'closeup only',
  'symmetrical composition',
].join(', ');

/* ─────────────────────────────────────────────────────────────
   GPT Image 1 Mini — emergency fallback only.
───────────────────────────────────────────────────────────── */
async function generateWithGptImageMini(prompt, quality = GPT_IMAGE_MINI_QUALITY, isFallback = false) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model:         'gpt-image-1-mini',
      prompt,
      n:             1,
      size:          '1536x1024',
      quality,
      output_format: 'jpeg',
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || `GPT Image Mini API error ${response.status}`;
    const isContentBlock = response.status === 400 &&
      (msg.toLowerCase().includes('safety') || msg.toLowerCase().includes('content') ||
       msg.toLowerCase().includes('policy') || msg.toLowerCase().includes('blocked'));
    if (isContentBlock && !isFallback) {
      const safe = `Cheerful fox cub with bright amber eyes and fluffy orange tail in a sunny meadow. Children's picture book illustration, soft watercolour. High quality, safe for children, no text, no borders.`;
      return generateWithGptImageMini(safe, quality, true);
    }
    throw new Error(msg);
  }
  const data = await response.json();
  return Buffer.from(data.data[0].b64_json, 'base64');
}

/* ─────────────────────────────────────────────────────────────
   Flux 2 [dev] — single image generation.

   Options:
     seed          — shared integer seed for style coherence
     loraUrl       — LoRA weights for Character Customisation
     loraScale     — LoRA influence weight (0.5–0.7 sweet spot)
     referenceUrl  — fal.ai-hosted cover URL for two-pass style lock
     isFallback    — prevents recursive safety retries
───────────────────────────────────────────────────────────── */
async function generateWithFlux(prompt, {
  seed         = null,
  loraUrl      = null,
  loraScale    = 0.6,
  referenceUrl = null,
  isFallback   = false,
  isCover      = false,
} = {}) {
  if (!process.env.FAL_API_KEY) {
    throw new Error('FAL_API_KEY not set — cannot use Flux provider');
  }

  const endpoint = loraUrl ? 'fal-ai/flux-lora' : 'fal-ai/flux/dev';

  const body = {
    prompt,
    negative_prompt:       isCover ? COVER_NEGATIVE_PROMPT : NEGATIVE_PROMPT,
    image_size:            'landscape_4_3',
    // Cover gets more inference steps and higher guidance for richer detail and
    // stricter prompt adherence — worth the extra ~10s latency for the hero image.
    num_inference_steps:   isCover ? 38 : 28,
    guidance_scale:        isCover ? 4.5 : 3.5,
    num_images:            1,
    output_format:         'jpeg',
    enable_safety_checker: true,
    sync_mode:             true,
  };

  if (seed !== null)      body.seed = seed;
  if (referenceUrl)       { body.image_prompt = referenceUrl; body.image_prompt_strength = 0.22; }
  if (loraUrl)            body.loras = [{ path: loraUrl, scale: loraScale }];

  const response = await fetch(`https://fal.run/${endpoint}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Key ${process.env.FAL_API_KEY}` },
    body:    JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.detail || err?.message || `fal.ai error ${response.status}`;
    const isSafetyBlock = response.status === 400 &&
      (msg.toLowerCase().includes('safety') || msg.toLowerCase().includes('nsfw'));
    if (isSafetyBlock && !isFallback) {
      console.warn(`Flux safety filter hit — using safe fallback prompt`);
      const safe = `Cheerful fox cub with bright amber eyes and fluffy orange tail in a sunny meadow. Children's picture book illustration, soft watercolour, warm pastel palette. High quality, safe for children, no text, no watermarks, no borders, no frames.`;
      return generateWithFlux(safe, { seed, loraUrl, loraScale, isFallback: true, isCover });
    }
    throw new Error(`Flux generation failed: ${msg}`);
  }

  const data = await response.json();
  const imageUrl = data?.images?.[0]?.url;
  if (!imageUrl) throw new Error('Flux response contained no image URL');

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to fetch Flux image: ${imgRes.status}`);
  // Return both the buffer and the fal.ai-hosted URL (needed for two-pass reference)
  return { buffer: Buffer.from(await imgRes.arrayBuffer()), hostedUrl: imageUrl };
}

/* ─────────────────────────────────────────────────────────────
   Save buffer to Vercel Blob.
───────────────────────────────────────────────────────────── */
async function saveBufferToBlob(imageBuffer, blobPath, contentType = 'image/jpeg') {
  const blob = await put(blobPath, imageBuffer, {
    access:          'public',
    contentType,
    addRandomSuffix: false,
  });
  return blob.url;
}

/* ─────────────────────────────────────────────────────────────
   Main export.

   illustrations[0]   = cover prompt
   illustrations[1+]  = page prompts

   TWO-PASS FLOW:
   1. Generate cover (pass 1) — no reference
   2. Save cover, capture its fal.ai hosted URL
   3. Generate each page (pass 2) — inject cover URL as
      image_prompt so Flux uses it as a visual style anchor

   All images share a single storySeed for style coherence.

   Returns array of { page, prompt, url } where page 0 = cover.
───────────────────────────────────────────────────────────── */
async function generateIllustrations(illustrations, storyBase, artStyle, quality = GPT_IMAGE_MINI_QUALITY, loraUrl = null) {
  const results    = [];
  const mode       = loraUrl ? 'flux-lora' : 'flux-dev';
  const storySeed  = Math.floor(Math.random() * 2147483647);

  console.log(`[IMG] Generating ${illustrations.length} illustrations | mode: ${mode} | seed: ${storySeed}${loraUrl ? ' | lora: ' + loraUrl : ''}`);

  // ── Pass 1: Cover (index 0) ───────────────────────────────
  let coverHostedUrl = null;

  if (illustrations.length > 0) {
    const coverPrompt = illustrations[0];
    try {
      console.log(`[IMG] Pass 1 — cover (steps:38, guidance:4.5)`);
      const { buffer: coverBuffer, hostedUrl } = await generateWithFlux(coverPrompt, { seed: storySeed, loraUrl, isCover: true });
      coverHostedUrl = hostedUrl;
      const blobPath = `stories/${storyBase}/page-00.jpg`;
      const savedUrl = await saveBufferToBlob(coverBuffer, blobPath, 'image/jpeg');
      results.push({ page: 0, prompt: coverPrompt, url: savedUrl, mode, seed: storySeed });
      console.log(`[IMG] Cover saved: ${blobPath}`);
    } catch (err) {
      console.error(`[IMG] Cover failed: ${err.message}`);
      try {
        const fb = await generateWithGptImageMini(illustrations[0], quality);
        const blobPath = `stories/${storyBase}/page-00.jpg`;
        const savedUrl = await saveBufferToBlob(fb, blobPath);
        results.push({ page: 0, prompt: illustrations[0], url: savedUrl, mode: 'gpt-image-mini-fallback' });
        console.warn(`[IMG] Cover fallback succeeded`);
      } catch (fbErr) {
        console.error(`[IMG] Cover fallback failed: ${fbErr.message}`);
        results.push({ page: 0, prompt: illustrations[0], url: null, error: err.message });
      }
    }
  }

  // ── Pass 2: Page images (indices 1..N) ────────────────────
  for (let i = 1; i < illustrations.length; i++) {
    const prompt  = illustrations[i];
    await new Promise(r => setTimeout(r, 300));

    try {
      console.log(`[IMG] Pass 2 — page ${i}/${illustrations.length - 1}${coverHostedUrl ? ' [+cover ref]' : ''}`);
      const { buffer: pageBuffer } = await generateWithFlux(prompt, {
        seed:         storySeed,
        loraUrl,
        referenceUrl: coverHostedUrl,
      });
      const blobPath = `stories/${storyBase}/page-${String(i).padStart(2, '0')}.jpg`;
      const savedUrl = await saveBufferToBlob(pageBuffer, blobPath, 'image/jpeg');
      results.push({ page: i, prompt, url: savedUrl, mode, seed: storySeed });
      console.log(`[IMG] Page ${i} saved: ${blobPath}`);
    } catch (err) {
      console.error(`[IMG] Page ${i} failed: ${err.message}`);
      try {
        const fb       = await generateWithGptImageMini(prompt, quality);
        const blobPath = `stories/${storyBase}/page-${String(i).padStart(2, '0')}.jpg`;
        const savedUrl = await saveBufferToBlob(fb, blobPath);
        results.push({ page: i, prompt, url: savedUrl, mode: 'gpt-image-mini-fallback' });
        console.warn(`[IMG] Page ${i} fallback succeeded`);
      } catch (fbErr) {
        console.error(`[IMG] Page ${i} fallback failed: ${fbErr.message}`);
        results.push({ page: i, prompt, url: null, error: err.message });
      }
    }
  }

  // ── Manifest ──────────────────────────────────────────────
  const manifest = {
    storyBase, artStyle, mode,
    endpoint:    loraUrl ? 'fal-ai/flux-lora' : 'fal-ai/flux/dev',
    loraUrl:     loraUrl || null,
    seed:        storySeed,
    twoPass:     !!coverHostedUrl,
    generatedAt: new Date().toISOString(),
    images:      results,
  };

  await put(`stories/${storyBase}/images-manifest.json`, JSON.stringify(manifest, null, 2), {
    access: 'public', contentType: 'application/json', addRandomSuffix: false,
  });

  console.log(`[IMG] Manifest saved | seed: ${storySeed} | two-pass: ${!!coverHostedUrl}`);
  return results;
}

module.exports = { generateIllustrations };
