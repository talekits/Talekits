const { put } = require('@vercel/blob');

/* ─────────────────────────────────────────────────────────────
   Voice map — 4 narrator options
   Each key maps to an ElevenLabs voice ID set via Vercel env vars.
   Set these in Vercel → Settings → Environment Variables:

     ELEVENLABS_VOICE_AU_FEMALE  — Australian female narrator
     ELEVENLABS_VOICE_AU_MALE    — Australian male narrator
     ELEVENLABS_VOICE_US_FEMALE  — American female narrator
     ELEVENLABS_VOICE_US_MALE    — American male narrator

   If an env var is not set, falls back to a known public voice ID.
───────────────────────────────────────────────────────────── */
const VOICE_MAP = {
  au_female: () => process.env.ELEVENLABS_VOICE_AU_FEMALE || 'XB0fDUnXU5powFXDhCwa', // Charlotte (British-warm, works well for AU)
  au_male:   () => process.env.ELEVENLABS_VOICE_AU_MALE   || 'TX3LPaxmHKxFdv7VOQHJ', // Liam
  us_female: () => process.env.ELEVENLABS_VOICE_US_FEMALE || '21m00Tcm4TlvDq8ikWAM', // Rachel
  us_male:   () => process.env.ELEVENLABS_VOICE_US_MALE   || 'TxGEqnHWrfWFTfGW9XjX', // Josh
};

const VOICE_LABELS = {
  au_female: 'Australian Female',
  au_male:   'Australian Male',
  us_female: 'American Female',
  us_male:   'American Male',
};

function getVoiceId(narratorVoice = 'au_female') {
  const resolver = VOICE_MAP[narratorVoice] || VOICE_MAP['au_female'];
  return resolver();
}

/* ─────────────────────────────────────────────────────────────
   Prepare story text for narration
   Adds natural SSML pauses between paragraphs
───────────────────────────────────────────────────────────── */
function prepareNarrationText(storyTitle, storyText, childName) {
  const cleaned = (storyText || '')
    .replace(/[*_`#]/g, '')
    .replace(/─+/g, '')
    .trim();

  const paragraphs = cleaned.split(/\n\n+/).filter(p => p.trim());
  const body       = paragraphs.join('\n<break time="0.8s"/>\n');

  return `${storyTitle}.\n<break time="1.2s"/>\nA story for ${childName}.\n<break time="1.5s"/>\n${body}\n<break time="1s"/>\nThe End.`;
}

/* ─────────────────────────────────────────────────────────────
   Call ElevenLabs TTS API
───────────────────────────────────────────────────────────── */
async function generateAudioBuffer(text, voiceId) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key':   apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability:         0.55,
          similarity_boost:  0.80,
          style:             0.25,
          use_speaker_boost: true,
        },
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
───────────────────────────────────────────────────────────── */
async function generateAudio(storyTitle, storyText, childName, storyBase, narratorVoice = 'au_female') {
  const voiceId    = getVoiceId(narratorVoice);
  const voiceLabel = VOICE_LABELS[narratorVoice] || narratorVoice;

  console.log(`[Audio] Generating narration | Voice: ${voiceLabel} (${voiceId}) | Story: ${storyTitle}`);

  const narrationText = prepareNarrationText(storyTitle, storyText, childName);
  const audioBuffer   = await generateAudioBuffer(narrationText, voiceId);

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

module.exports = { generateAudio, VOICE_LABELS };
