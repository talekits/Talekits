const { put } = require('@vercel/blob');

/* ─────────────────────────────────────────────────────────────
   Image provider selection.
   This is now auto-selected per story rather than a global
   constant — see generateIllustrations() below.

   If a child profile has a trained lora_url → Flux
   Otherwise → GPT Image Mini (default)
───────────────────────────────────────────────────────────── */

const GPT_IMAGE_MINI_QUALITY = 'low'; // 'low' | 'medium' | 'high'

/* ─────────────────────────────────────────────────────────────
   GPT Image 1 Mini — generate a single image from a prompt.
   Returns a Buffer (b64_json decoded).
───────────────────────────────────────────────────────────── */
async function generateWithGptImageMini(prompt, quality = GPT_IMAGE_MINI_QUALITY, isFallback = false) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model:           'gpt-image-1-mini',
      prompt,
      n:               1,
      size:            '1536x1024',
      quality,
      output_format:   'jpeg',
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || `GPT Image Mini API error ${response.status}`;

    const isContentBlock = response.status === 400 &&
      (msg.toLowerCase().includes('safety') ||
       msg.toLowerCase().includes('content') ||
       msg.toLowerCase().includes('policy') ||
       msg.toLowerCase().includes('blocked'));

    if (isContentBlock && !isFallback) {
      console.warn(`Content filter hit — using safe fallback prompt immediately`);
      const safeFallback = `Cheerful fox cub character with bright amber eyes and a fluffy orange tail, standing in a sunny meadow with colourful wildflowers. Big friendly smile, looking ahead with curiosity. Soft golden sunlight, wide open landscape, clear blue sky with fluffy white clouds. Children's picture book illustration, soft watercolour, warm pastel palette. High quality, detailed illustration, safe for children, no text, no watermarks.`;
      return generateWithGptImageMini(safeFallback, quality, true);
    }

    throw new Error(msg);
  }

  const data = await response.json();
  return Buffer.from(data.data[0].b64_json, 'base64');
}

/* ─────────────────────────────────────────────────────────────
   Flux 2 via fal.ai — generate a single image with optional LoRA.
   Returns a Buffer.

   loraUrl: the fal.ai LoRA weights URL from child_profiles.lora_url
   loraScale: 0.5–0.7 is the sweet spot — full weight oversaturates
───────────────────────────────────────────────────────────── */
async function generateWithFlux(prompt, loraUrl = null, loraScale = 0.6, isFallback = false) {
  if (!process.env.FAL_API_KEY) {
    throw new Error('FAL_API_KEY not set — cannot use Flux provider');
  }

  // Route to correct endpoint:
  // - fal-ai/flux/dev        → standard text-to-image (no LoRA)
  // - fal-ai/flux-lora       → text-to-image with custom LoRA weights
  const endpoint = loraUrl ? 'fal-ai/flux-lora' : 'fal-ai/flux/dev';

  const body = {
    prompt,
    image_size:          'landscape_4_3',  // 4:3 suits children's book spreads
    num_inference_steps: 28,
    guidance_scale:      3.5,
    num_images:          1,
    output_format:       'jpeg',
    enable_safety_checker: true,
    sync_mode:           true,             // wait for result in same request (faster on Vercel)
  };

  if (loraUrl) {
    body.loras = [{ path: loraUrl, scale: loraScale }];
  }

  const response = await fetch(`https://fal.run/${endpoint}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Key ${process.env.FAL_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.detail || err?.message || `fal.ai error ${response.status}`;

    // Safety filter hit — use a safe fallback prompt
    const isSafetyBlock = response.status === 400 &&
      (msg.toLowerCase().includes('safety') || msg.toLowerCase().includes('nsfw'));

    if (isSafetyBlock && !isFallback) {
      console.warn(`Flux safety filter hit — using safe fallback prompt`);
      const safeFallback = `Cheerful fox cub character with bright amber eyes and a fluffy orange tail, standing in a sunny meadow with colourful wildflowers. Big friendly smile, looking ahead with curiosity. Soft golden sunlight, wide open landscape, clear blue sky with fluffy white clouds. Children's picture book illustration, soft watercolour, warm pastel palette. High quality, detailed illustration, safe for children, no text, no watermarks.`;
      return generateWithFlux(safeFallback, loraUrl, loraScale, true);
    }

    throw new Error(`Flux generation failed: ${msg}`);
  }

  const data = await response.json();
  const imageUrl = data?.images?.[0]?.url;
  if (!imageUrl) throw new Error('Flux response contained no image URL');

  // fal.ai returns a hosted URL — fetch and buffer it
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to fetch Flux image: ${imgRes.status}`);
  return Buffer.from(await imgRes.arrayBuffer());
}

/* ─────────────────────────────────────────────────────────────
   Save image buffer to Vercel Blob.
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
   Main export — generate all illustration images for a story.

   Provider logic:
   - Flux 2 [dev] is ALWAYS used by default (fal-ai/flux/dev)
   - Flux with LoRA is used when loraUrl is provided — this only
     happens when the subscriber has paid for Character Customisation
     ($14.99 add-on), uploaded photos, and a LoRA has been trained
     on their child's likeness (lora_url stored on child_profiles row)
   - GPT Image Mini is kept as an emergency fallback ONLY if Flux
     fails for a non-safety reason

   quality: GPT Image Mini quality tier — only used if Flux fails
     and the fallback fires.

   Returns array of { page, prompt, url } objects.
───────────────────────────────────────────────────────────── */
async function generateIllustrations(illustrations, storyBase, artStyle, quality = GPT_IMAGE_MINI_QUALITY, loraUrl = null) {
  const results  = [];
  // Flux 2 [dev] is always the provider.
  // loraUrl is only set when char_custom is active AND photos have been trained —
  // in that case we hit fal-ai/flux-lora instead of fal-ai/flux/dev.
  const mode = loraUrl ? 'flux-lora' : 'flux-dev';

  console.log(`[IMG] Generating ${illustrations.length} illustrations | mode: ${mode} | endpoint: ${loraUrl ? 'fal-ai/flux-lora' : 'fal-ai/flux/dev'}${loraUrl ? ' | lora: ' + loraUrl : ''}`);

  for (let i = 0; i < illustrations.length; i++) {
    const pageNum = i + 1;
    const prompt  = illustrations[i];

    try {
      console.log(`[IMG] Image ${pageNum}/${illustrations.length} — ${mode}`);

      // Always use Flux. loraUrl is null for standard generation,
      // populated only for Character Customisation subscribers.
      let imageBuffer = await generateWithFlux(prompt, loraUrl);

      const blobPath = `stories/${storyBase}/page-${String(pageNum).padStart(2, '0')}.jpg`;
      const savedUrl = await saveBufferToBlob(imageBuffer, blobPath, 'image/jpeg');

      results.push({ page: pageNum, prompt, url: savedUrl, mode });
      console.log(`[IMG] Image ${pageNum} saved: ${blobPath}`);

      // Brief pause between requests — fal.ai handles concurrency well but
      // a small gap avoids rate limit spikes on large stories
      if (i < illustrations.length - 1) {
        await new Promise(r => setTimeout(r, 300));
      }

    } catch (err) {
      console.error(`[IMG] Image ${pageNum} failed (${mode}): ${err.message}`);

      // Flux failed for a non-safety reason — try GPT Image Mini as emergency fallback
      // so the page isn't blank rather than holding up the whole story
      console.warn(`[IMG] Image ${pageNum} — Flux failed, trying GPT Image Mini emergency fallback`);
      try {
        const fallbackBuffer = await generateWithGptImageMini(prompt, quality);
        const blobPath       = `stories/${storyBase}/page-${String(pageNum).padStart(2, '0')}.jpg`;
        const savedUrl       = await saveBufferToBlob(fallbackBuffer, blobPath);
        results.push({ page: pageNum, prompt, url: savedUrl, mode: 'gpt-image-mini-fallback' });
        console.warn(`[IMG] Image ${pageNum} — fallback succeeded`);
        continue;
      } catch (fbErr) {
        console.error(`[IMG] Image ${pageNum} — fallback also failed: ${fbErr.message}`);
      }

      results.push({ page: pageNum, prompt, url: null, error: err.message });
    }
  }

  const manifest = {
    storyBase,
    artStyle,
    mode,
    endpoint: loraUrl ? 'fal-ai/flux-lora' : 'fal-ai/flux/dev',
    loraUrl: loraUrl || null,
    quality: null, // Flux doesn't use quality tiers
    generatedAt: new Date().toISOString(),
    images: results,
  };

  await put(`stories/${storyBase}/images-manifest.json`, JSON.stringify(manifest, null, 2), {
    access:          'public',
    contentType:     'application/json',
    addRandomSuffix: false,
  });

  console.log(`Images manifest saved for: ${storyBase}`);
  return results;
}

module.exports = { generateIllustrations };
