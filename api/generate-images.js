const { put } = require('@vercel/blob');

/* ─────────────────────────────────────────────────────────────
   Image provider selection.

   Flux 2 [dev] is the primary provider (fal-ai/flux/dev).
   Flux with LoRA is used for Character Customisation subscribers.
   GPT Image Mini is the emergency fallback only.

   THREE-PASS GENERATION:
   Pass 0 — Style portrait: a clean, composition-neutral character
            portrait in the chosen art style. Never saved as a
            deliverable. Its fal.ai-hosted URL becomes the reference
            for all page images, decoupling style/character locking
            from the cover's scene composition.
   Pass 1 — Cover image: independent, no IP reference. Uses higher
            steps + guidance for richer detail on the hero image.
   Pass 2 — Page images: each uses the style portrait URL as
            image_prompt at low strength (0.17). The shared seed
            + portrait reference gives both style and character
            consistency without composition conflict.
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

// Cover gets extra negative terms — we want richness and depth on the cover,
// not the clean minimal look that works for interior page illustrations.
const COVER_NEGATIVE_PROMPT = [
  ...NEGATIVE_PROMPT.split(', '),
  'empty background', 'minimalist', 'simple background', 'plain background',
  'flat composition', 'low detail', 'sparse scene', 'cropped', 'closeup only',
  'symmetrical composition',
].join(', ');

/* ─────────────────────────────────────────────────────────────
   Build the style-portrait prompt.

   A deliberately simple, composition-neutral image: the protagonist
   centred against a plain background in the chosen art style.
   No narrative action, no setting detail — pure character + style.
   This is what the IP-Adapter reads from, so keeping it uncluttered
   maximises how cleanly both signals transfer to page images.
───────────────────────────────────────────────────────────── */
function buildStylePortraitPrompt(characterAnchor, artStyle) {
  const style = artStyle || "children's picture book illustration, soft watercolour, warm pastel palette";

  const protagonistDesc = characterAnchor && characterAnchor.protagonist
    ? characterAnchor.protagonist
    : 'a cheerful storybook character with bright expressive eyes';

  const companionLine = characterAnchor && characterAnchor.companion
    ? ` Their companion — ${characterAnchor.companion} — stands close beside them.`
    : '';

  return `A character portrait of ${protagonistDesc}, facing the viewer with a warm friendly expression, standing upright in a natural relaxed pose.${companionLine} Plain soft neutral background with subtle texture, no setting detail, no props, no action. The character is centred and fully visible from head to toe. ${style}. High quality, detailed illustration, safe for children, no text, no watermarks, no borders, no frames.`;
}

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
    const msg = err.error && err.error.message ? err.error.message : ('GPT Image Mini API error ' + response.status);
    const isContentBlock = response.status === 400 &&
      (msg.toLowerCase().includes('safety') || msg.toLowerCase().includes('content') ||
       msg.toLowerCase().includes('policy') || msg.toLowerCase().includes('blocked'));
    if (isContentBlock && !isFallback) {
      const safe = "Cheerful fox cub with bright amber eyes and fluffy orange tail in a sunny meadow. Children's picture book illustration, soft watercolour. High quality, safe for children, no text, no borders.";
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
     loraScale     — LoRA influence weight (0.5-0.7 sweet spot)
     referenceUrl  — style portrait URL for IP-Adapter consistency
     isFallback    — prevents recursive safety retries
     isCover       — applies cover-specific steps/guidance/negatives
───────────────────────────────────────────────────────────── */
async function generateWithFlux(prompt, opts) {
  if (!opts) opts = {};
  const seed         = opts.seed         !== undefined ? opts.seed         : null;
  const loraUrl      = opts.loraUrl      !== undefined ? opts.loraUrl      : null;
  const loraScale    = opts.loraScale    !== undefined ? opts.loraScale    : 0.6;
  const referenceUrl = opts.referenceUrl !== undefined ? opts.referenceUrl : null;
  const isFallback   = opts.isFallback   !== undefined ? opts.isFallback   : false;
  const isCover      = opts.isCover      !== undefined ? opts.isCover      : false;

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

  if (seed !== null) body.seed = seed;
  if (referenceUrl) {
    body.image_prompt          = referenceUrl;
    // 0.17 — enough for the IP-Adapter to read style and character appearance
    // clearly, but low enough that the page prompt drives composition freely.
    body.image_prompt_strength = 0.17;
  }
  if (loraUrl) body.loras = [{ path: loraUrl, scale: loraScale }];

  const response = await fetch('https://fal.run/' + endpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Key ' + process.env.FAL_API_KEY },
    body:    JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(function() { return {}; });
    const msg = err.detail || err.message || ('fal.ai error ' + response.status);
    const isSafetyBlock = response.status === 400 &&
      (msg.toLowerCase().includes('safety') || msg.toLowerCase().includes('nsfw'));
    if (isSafetyBlock && !isFallback) {
      console.warn('Flux safety filter hit — using safe fallback prompt');
      const safe = "Cheerful fox cub with bright amber eyes and fluffy orange tail in a sunny meadow. Children's picture book illustration, soft watercolour, warm pastel palette. High quality, safe for children, no text, no watermarks, no borders, no frames.";
      return generateWithFlux(safe, { seed: seed, loraUrl: loraUrl, loraScale: loraScale, isFallback: true, isCover: isCover });
    }
    throw new Error('Flux generation failed: ' + msg);
  }

  const data = await response.json();
  const imageUrl = data && data.images && data.images[0] ? data.images[0].url : null;
  if (!imageUrl) throw new Error('Flux response contained no image URL');

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error('Failed to fetch Flux image: ' + imgRes.status);
  return { buffer: Buffer.from(await imgRes.arrayBuffer()), hostedUrl: imageUrl };
}

/* ─────────────────────────────────────────────────────────────
   Save buffer to Vercel Blob.
───────────────────────────────────────────────────────────── */
async function saveBufferToBlob(imageBuffer, blobPath, contentType) {
  if (!contentType) contentType = 'image/jpeg';
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
   characterAnchor    = { protagonist, companion } from story JSON

   THREE-PASS FLOW:
   Pass 0 - Style portrait (not saved as deliverable).
            Built from characterAnchor + artStyle.
            Its fal.ai URL is used as IP-Adapter reference for pages.
   Pass 1 - Cover: independent, no reference, high steps + guidance.
   Pass 2 - Pages: portrait URL as reference at strength 0.17.
            Falls back to seed-only if portrait generation failed.

   All images share a single storySeed for style coherence.

   Returns array of { page, prompt, url } where page 0 = cover.
───────────────────────────────────────────────────────────── */
async function generateIllustrations(illustrations, storyBase, artStyle, quality, loraUrl, characterAnchor) {
  if (!quality) quality = GPT_IMAGE_MINI_QUALITY;
  if (!loraUrl) loraUrl = null;
  if (!characterAnchor) characterAnchor = null;

  const results   = [];
  const mode      = loraUrl ? 'flux-lora' : 'flux-dev';
  const storySeed = Math.floor(Math.random() * 2147483647);

  console.log('[IMG] Generating ' + illustrations.length + ' illustrations | mode: ' + mode + ' | seed: ' + storySeed + (loraUrl ? ' | lora: ' + loraUrl : ''));

  // ── Pass 0: Style portrait ────────────────────────────────
  // Generates a clean, composition-neutral character portrait that
  // serves as the IP-Adapter reference for all page images.
  // Saved to blob for debugging only — not surfaced to the user.
  let portraitHostedUrl = null;

  if (characterAnchor && characterAnchor.protagonist) {
    const portraitPrompt = buildStylePortraitPrompt(characterAnchor, artStyle);
    try {
      console.log('[IMG] Pass 0 — style portrait');
      const portraitResult = await generateWithFlux(portraitPrompt, { seed: storySeed, loraUrl: loraUrl });
      portraitHostedUrl = portraitResult.hostedUrl;
      const blobPath = 'stories/' + storyBase + '/style-portrait.jpg';
      await saveBufferToBlob(portraitResult.buffer, blobPath, 'image/jpeg');
      console.log('[IMG] Style portrait ready | hosted: ' + !!portraitHostedUrl);
    } catch (err) {
      // Non-fatal — pages fall back to seed-only consistency
      console.warn('[IMG] Style portrait failed (non-fatal): ' + err.message);
    }
  } else {
    console.log('[IMG] Pass 0 — no characterAnchor protagonist, skipping style portrait');
  }

  // ── Pass 1: Cover (index 0) ───────────────────────────────
  // Cover is fully independent — no IP reference — so it renders
  // with maximum fidelity to its own rich prompt and scene direction.
  if (illustrations.length > 0) {
    const coverPrompt = illustrations[0];
    try {
      console.log('[IMG] Pass 1 — cover (steps:38, guidance:4.5, no reference)');
      const coverResult = await generateWithFlux(coverPrompt, {
        seed:    storySeed,
        loraUrl: loraUrl,
        isCover: true,
        // Deliberately no referenceUrl — cover is fully prompt-driven
      });
      const blobPath = 'stories/' + storyBase + '/page-00.jpg';
      const savedUrl = await saveBufferToBlob(coverResult.buffer, blobPath, 'image/jpeg');
      results.push({ page: 0, prompt: coverPrompt, url: savedUrl, mode: mode, seed: storySeed });
      console.log('[IMG] Cover saved: ' + blobPath);
    } catch (err) {
      console.error('[IMG] Cover failed: ' + err.message);
      try {
        const fb       = await generateWithGptImageMini(illustrations[0], quality);
        const blobPath = 'stories/' + storyBase + '/page-00.jpg';
        const savedUrl = await saveBufferToBlob(fb, blobPath);
        results.push({ page: 0, prompt: illustrations[0], url: savedUrl, mode: 'gpt-image-mini-fallback' });
        console.warn('[IMG] Cover fallback succeeded');
      } catch (fbErr) {
        console.error('[IMG] Cover fallback failed: ' + fbErr.message);
        results.push({ page: 0, prompt: illustrations[0], url: null, error: err.message });
      }
    }
  }

  // ── Pass 2: Page images (indices 1..N) ────────────────────
  // Every page uses the style portrait as IP-Adapter reference.
  // If portrait generation failed, portraitHostedUrl is null and
  // pages fall back gracefully to seed-only consistency.
  for (let i = 1; i < illustrations.length; i++) {
    const prompt = illustrations[i];
    await new Promise(function(r) { setTimeout(r, 300); });

    try {
      console.log('[IMG] Pass 2 — page ' + i + '/' + (illustrations.length - 1) + (portraitHostedUrl ? ' [+portrait ref 0.17]' : ' [seed-only]'));
      const pageResult = await generateWithFlux(prompt, {
        seed:         storySeed,
        loraUrl:      loraUrl,
        referenceUrl: portraitHostedUrl,
      });
      const blobPath = 'stories/' + storyBase + '/page-' + String(i).padStart(2, '0') + '.jpg';
      const savedUrl = await saveBufferToBlob(pageResult.buffer, blobPath, 'image/jpeg');
      results.push({ page: i, prompt: prompt, url: savedUrl, mode: mode, seed: storySeed });
      console.log('[IMG] Page ' + i + ' saved: ' + blobPath);
    } catch (err) {
      console.error('[IMG] Page ' + i + ' failed: ' + err.message);
      try {
        const fb       = await generateWithGptImageMini(prompt, quality);
        const blobPath = 'stories/' + storyBase + '/page-' + String(i).padStart(2, '0') + '.jpg';
        const savedUrl = await saveBufferToBlob(fb, blobPath);
        results.push({ page: i, prompt: prompt, url: savedUrl, mode: 'gpt-image-mini-fallback' });
        console.warn('[IMG] Page ' + i + ' fallback succeeded');
      } catch (fbErr) {
        console.error('[IMG] Page ' + i + ' fallback failed: ' + fbErr.message);
        results.push({ page: i, prompt: prompt, url: null, error: err.message });
      }
    }
  }

  // ── Manifest ──────────────────────────────────────────────
  const manifest = {
    storyBase:     storyBase,
    artStyle:      artStyle,
    mode:          mode,
    endpoint:      loraUrl ? 'fal-ai/flux-lora' : 'fal-ai/flux/dev',
    loraUrl:       loraUrl || null,
    seed:          storySeed,
    stylePortrait: !!portraitHostedUrl,
    generatedAt:   new Date().toISOString(),
    images:        results,
  };

  await put('stories/' + storyBase + '/images-manifest.json', JSON.stringify(manifest, null, 2), {
    access: 'public', contentType: 'application/json', addRandomSuffix: false,
  });

  console.log('[IMG] Manifest saved | seed: ' + storySeed + ' | portrait ref: ' + !!portraitHostedUrl);
  return results;
}

module.exports = { generateIllustrations };
