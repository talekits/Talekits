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
      const artMatch = prompt.match(/[Pp]ainted in[^.]+\./);
      const artStyle = artMatch ? artMatch[0] : 'Painted in soft watercolour with warm pastel tones.';
      const safeFallback = `A children's book illustration of a cheerful animal character standing in a sunny meadow filled with colourful wildflowers. The character has a big friendly smile and is looking ahead with bright curious eyes. Soft golden sunlight fills the scene. Wide landscape composition with a clear blue sky and a few fluffy white clouds. ${artStyle} No text, no speech bubbles, no borders, no watermarks, safe for children.`;
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

  const body = {
    prompt,
    image_size:          'landscape_16_9',
    num_inference_steps: 28,
    guidance_scale:      3.5,
    num_images:          1,
    output_format:       'jpeg',
    enable_safety_checker: true,
  };

  if (loraUrl) {
    body.loras = [{ path: loraUrl, scale: loraScale }];
  }

  const response = await fetch('https://fal.run/fal-ai/flux-2/lora', {
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
      const artMatch = prompt.match(/[Pp]ainted in[^.]+\./);
      const artStyle = artMatch ? artMatch[0] : 'Painted in soft watercolour with warm pastel tones.';
      const safeFallback = `A children's book illustration of a cheerful fox character standing in a sunny meadow filled with colourful wildflowers. The fox has a big friendly smile and bright curious eyes. Soft golden sunlight fills the scene. Wide landscape composition. ${artStyle} No text, no borders, safe for children.`;
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

   loraUrl: optional — if provided (Den+ subscribers with a
     trained LoRA), Flux is used. Otherwise GPT Image Mini.
   quality: GPT Image Mini quality tier ('low'|'medium'|'high').
     Ignored when using Flux.

   Returns array of { page, prompt, url } objects.
───────────────────────────────────────────────────────────── */
async function generateIllustrations(illustrations, storyBase, artStyle, quality = GPT_IMAGE_MINI_QUALITY, loraUrl = null) {
  const results  = [];
  const provider = loraUrl ? 'flux' : 'gpt-image-mini';

  console.log(`Generating ${illustrations.length} illustrations | provider: ${provider}${loraUrl ? ' (LoRA)' : ''} | quality: ${quality}`);

  for (let i = 0; i < illustrations.length; i++) {
    const pageNum = i + 1;
    const prompt  = illustrations[i];

    try {
      console.log(`Generating image ${pageNum}/${illustrations.length}`);

      let imageBuffer;

      if (provider === 'flux') {
        imageBuffer = await generateWithFlux(prompt, loraUrl);
      } else {
        imageBuffer = await generateWithGptImageMini(prompt, quality);
      }

      const blobPath = `stories/${storyBase}/page-${String(pageNum).padStart(2, '0')}.jpg`;
      const savedUrl = await saveBufferToBlob(imageBuffer, blobPath, 'image/jpeg');

      results.push({ page: pageNum, prompt, url: savedUrl });
      console.log(`Image ${pageNum} saved: ${blobPath}`);

      // Flux is fast (~4-7s) — GPT Image Mini can be slow on complex prompts
      // Smaller delay is fine for either
      if (i < illustrations.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }

    } catch (err) {
      console.error(`Image ${pageNum} failed (${provider}): ${err.message}`);

      // If Flux fails for a non-safety reason, fall back to GPT Image Mini
      // rather than leaving the page blank
      if (provider === 'flux') {
        console.warn(`Image ${pageNum} — Flux failed, falling back to GPT Image Mini`);
        try {
          const fallbackBuffer = await generateWithGptImageMini(prompt, quality);
          const blobPath       = `stories/${storyBase}/page-${String(pageNum).padStart(2, '0')}.jpg`;
          const savedUrl       = await saveBufferToBlob(fallbackBuffer, blobPath);
          results.push({ page: pageNum, prompt, url: savedUrl, provider_used: 'gpt-image-mini-fallback' });
          continue;
        } catch (fbErr) {
          console.error(`Image ${pageNum} fallback also failed: ${fbErr.message}`);
        }
      }

      results.push({ page: pageNum, prompt, url: null, error: err.message });
    }
  }

  const manifest = {
    storyBase,
    artStyle,
    provider,
    loraUrl: loraUrl || null,
    quality: provider === 'gpt-image-mini' ? quality : null,
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
