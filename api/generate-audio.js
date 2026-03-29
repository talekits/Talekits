const { put } = require('@vercel/blob');

/* ─────────────────────────────────────────────────────────────
   ElevenLabs voice ID
   Set ELEVENLABS_VOICE_ID in Vercel env variables.
   Find your voice ID in ElevenLabs dashboard → Voices → click voice → ID shown in URL.
   e.g. "21m00Tcm4TlvDq8ikWAM" (Rachel) or your custom voice ID.
───────────────────────────────────────────────────────────── */
function getVoiceId() {
  return process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel fallback
}

/* ─────────────────────────────────────────────────────────────
   Prepare story text for narration
   - Adds natural pauses between paragraphs using SSML break tags
   - Prepends the title as an introduction
   - Strips any markdown or special characters that break TTS
───────────────────────────────────────────────────────────── */
function prepareNarrationText(storyTitle, storyText, childName) {
  // Clean the story text
  const cleaned = (storyText || '')
    .replace(/[*_`#]/g, '')           // strip markdown
    .replace(/─+/g, '')               // strip decorative lines
    .trim();

  // Split into paragraphs and join with SSML break tags for natural pacing
  const paragraphs = cleaned.split(/\n\n+/).filter(p => p.trim());
  const body       = paragraphs.join('\n<break time="0.8s"/>\n');

  // Full narration script
  return `${storyTitle}.\n<break time="1.2s"/>\nA story for ${childName}.\n<break time="1.5s"/>\n${body}\n<break time="1s"/>\nThe End.`;
}

/* ─────────────────────────────────────────────────────────────
   Generate audio via ElevenLabs TTS API
   Returns an MP3 buffer
───────────────────────────────────────────────────────────── */
async function generateAudioBuffer(text) {
  const voiceId = getVoiceId();
  const apiKey  = process.env.ELEVENLABS_API_KEY;

  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'xi-api-key':    apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',   // fast + high quality, good for children's content
        voice_settings: {
          stability:         0.55,         // moderate stability — natural, not robotic
          similarity_boost:  0.80,         // stay close to voice character
          style:             0.25,         // light expressiveness
          use_speaker_boost: true,
        },
        // Enable SSML for <break> tags
        text_type: 'ssml',
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`ElevenLabs API error ${response.status}: ${err.slice(0, 200)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/* ─────────────────────────────────────────────────────────────
   Main export
   Generates narration MP3 and saves to Vercel Blob
   Returns { url, filename, buffer }
───────────────────────────────────────────────────────────── */
async function generateAudio(storyTitle, storyText, childName, storyBase) {
  console.log(`[Audio] Preparing narration for: ${storyTitle}`);

  const narrationText = prepareNarrationText(storyTitle, storyText, childName);
  console.log(`[Audio] Narration text length: ${narrationText.length} chars`);

  const audioBuffer = await generateAudioBuffer(narrationText);
  console.log(`[Audio] Generated ${Math.round(audioBuffer.length / 1024)}KB MP3`);

  const filename = `${storyBase}-narration.mp3`;
  const blob     = await put(`stories/${filename}`, audioBuffer, {
    access:          'public',
    contentType:     'audio/mpeg',
    addRandomSuffix: false,
  });

  console.log(`[Audio] Saved: stories/${filename}`);
  return { url: blob.url, filename, buffer: audioBuffer };
}

module.exports = { generateAudio };
