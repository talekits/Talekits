const { put } = require('@vercel/blob');

/* ─────────────────────────────────────────────────────────────
   Image provider — swap this one constant to switch from
   DALL-E 3 to Flux without changing anything else.
   Supported: 'dalle3' | 'flux' (future)
───────────────────────────────────────────────────────────── */
const IMAGE_PROVIDER = 'dalle3';

/* ─────────────────────────────────────────────────────────────
   DALL-E 3 — generate a single image from a prompt
───────────────────────────────────────────────────────────── */
async function generateWithDalle3(prompt) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model:           'dall-e-3',
      prompt,
      n:               1,
      size:            '1792x1024',  // landscape — ideal for picture book spreads
      quality:         'standard',   // switch to 'hd' for premium plans
      response_format: 'url',
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `DALL-E 3 API error ${response.status}`);
  }

  const data = await response.json();
  return data.data[0].url; // temporary URL — valid for ~1 hour, must be saved
}

/* ─────────────────────────────────────────────────────────────
   Flux (fal.ai) — swap in here when ready
   Uncomment and set IMAGE_PROVIDER = 'flux' above
───────────────────────────────────────────────────────────── */
// async function generateWithFlux(prompt, loraUrl = null) {
//   const body = {
//     prompt,
//     image_size:        'landscape_16_9',
//     num_inference_steps: 28,
//     guidance_scale:    3.5,
//     num_images:        1,
//   };
//   if (loraUrl) {
//     body.loras = [{ path: loraUrl, scale: 0.9 }];
//   }
//   const response = await fetch('https://fal.run/fal-ai/flux/dev', {
//     method:  'POST',
//     headers: {
//       'Content-Type':  'application/json',
//       'Authorization': `Key ${process.env.FAL_API_KEY}`,
//     },
//     body: JSON.stringify(body),
//   });
//   const data = await response.json();
//   return data.images[0].url;
// }

/* ─────────────────────────────────────────────────────────────
   Download image from temporary URL and save to Vercel Blob
   DALL-E 3 URLs expire after ~1 hour so we must save immediately
───────────────────────────────────────────────────────────── */
async function saveImageToBlob(imageUrl, blobPath) {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);

  const buffer      = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || 'image/png';

  const blob = await put(blobPath, buffer, {
    access:          'public',
    contentType,
    addRandomSuffix: false,
  });

  return blob.url;
}

/* ─────────────────────────────────────────────────────────────
   Main export — generate all illustration images for a story
   Returns array of { page, prompt, url } objects
───────────────────────────────────────────────────────────── */
async function generateIllustrations(illustrations, storyBase, artStyle) {
  const results  = [];
  const provider = IMAGE_PROVIDER;

  console.log(`Generating ${illustrations.length} illustrations with ${provider}`);

  for (let i = 0; i < illustrations.length; i++) {
    const pageNum = i + 1;
    const prompt  = illustrations[i];

    try {
      console.log(`Generating image ${pageNum}/${illustrations.length}`);

      let tempUrl;
      if (provider === 'dalle3') {
        tempUrl = await generateWithDalle3(prompt);
      } else {
        throw new Error(`Unknown provider: ${provider}`);
      }

      // Save immediately — temporary URLs expire
      const blobPath  = `stories/${storyBase}/page-${String(pageNum).padStart(2, '0')}.png`;
      const savedUrl  = await saveImageToBlob(tempUrl, blobPath);

      results.push({ page: pageNum, prompt, url: savedUrl });
      console.log(`Image ${pageNum} saved: ${blobPath}`);

      // Small delay between requests to avoid rate limiting
      if (i < illustrations.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }

    } catch (err) {
      console.error(`Image ${pageNum} failed: ${err.message}`);
      // Push null url so we know which pages failed — don't abort the whole batch
      results.push({ page: pageNum, prompt, url: null, error: err.message });
    }
  }

  // Save a manifest of all image URLs alongside the story files
  const manifest = {
    storyBase,
    artStyle,
    provider,
    generatedAt: new Date().toISOString(),
    images:      results,
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
