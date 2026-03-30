const { generateStory } = require('./generate-story');

module.exports.maxDuration = 300;

/* ─────────────────────────────────────────────────────────────
   Stress test endpoint — generates one story per request.
   Call with storyIndex=0 to start, it auto-chains to the next.

   POST /api/stress-test
   Body: { secret, email, plan, narratorVoice, storyIndex, total, sessionId }
─────────────────────────────────────────────────────────────── */

const TEST_PROFILES = [
  {
    childName: 'James', gender: 'boy',
    label: 'Pirates & ocean adventure',
    content: `TALEKIT STORY PROFILE
────────────────────────────────────
Child's name: James
Child's gender: boy

AGE & FORMAT
  Age brackets: Ages 6–7 (early reader: longer sentences, basic chapter structure) — 400–550 words
  Reading level: Independent early reader
  Story length: Medium — middle of age range
  Tone & mood: Exciting & adventurous
  Story structure: Quest (a journey toward a goal)

THEMES
  Adventure & discovery: Pirates & treasure maps
  Nature & animals: Ocean creatures

ART STYLES
  Classic & traditional: Watercolour (soft, Beatrix Potter-esque)

EDUCATIONAL FOCUS
  Ethics & values: Courage & doing what is right

CHARACTERS
  Protagonist type: Human child
  Protagonist personalisation: Child's own name as the hero`,
  },
  {
    childName: 'James', gender: 'boy',
    label: 'Talking objects / silly fairy tale',
    content: `TALEKIT STORY PROFILE
────────────────────────────────────
Child's name: James
Child's gender: boy

AGE & FORMAT
  Age brackets: Ages 6–7 (early reader: longer sentences, basic chapter structure) — 400–550 words
  Reading level: Independent early reader
  Story length: Short — lower end of age range
  Tone & mood: Funny & silly
  Story structure: Episodic (a series of small linked events)

THEMES
  Fantasy & magic: Fairy tales
  Fantasy & magic: Talking objects & toys

ART STYLES
  Modern illustration: Flat design / bold vector

EDUCATIONAL FOCUS
  Social-emotional learning: Friendship skills

CHARACTERS
  Protagonist type: Everyday object come to life`,
  },
  {
    childName: 'James', gender: 'boy',
    label: 'Space & robots mystery',
    content: `TALEKIT STORY PROFILE
────────────────────────────────────
Child's name: James
Child's gender: boy

AGE & FORMAT
  Age brackets: Ages 8–10 (confident reader: plot complexity, subtext, humour) — 550–800 words
  Reading level: Fluent independent reader
  Story length: Long — upper end of age range
  Tone & mood: Mysterious
  Story structure: Mystery (a problem to identify and solve)

THEMES
  Science & space: Outer space & planets
  Science & space: Robots & androids

ART STYLES
  Digital & contemporary: Soft digital painting

EDUCATIONAL FOCUS
  STEM & critical thinking: Engineering & building challenges

CHARACTERS
  Protagonist type: Alien or space explorer`,
  },
  {
    childName: 'James', gender: 'boy',
    label: 'Wild animals in the rainforest',
    content: `TALEKIT STORY PROFILE
────────────────────────────────────
Child's name: James
Child's gender: boy

AGE & FORMAT
  Age brackets: Ages 4–5 (preschool: short sentences, single moral lesson, bright art) — 200–350 words
  Reading level: Emergent reader (guided with adult)
  Story length: Short — lower end of age range
  Tone & mood: Heartwarming
  Story structure: Classic (clear beginning, middle, end)

THEMES
  Nature & animals: Wild animals
  Nature & animals: Rainforests

ART STYLES
  Classic & traditional: Hand-drawn crayon

EDUCATIONAL FOCUS
  Ethics & values: Caring for animals

CHARACTERS
  Protagonist type: Animal hero`,
  },
  {
    childName: 'James', gender: 'boy',
    label: 'Jungle dinosaur expedition',
    content: `TALEKIT STORY PROFILE
────────────────────────────────────
Child's name: James
Child's gender: boy

AGE & FORMAT
  Age brackets: Ages 6–7 (early reader: longer sentences, basic chapter structure) — 400–550 words
  Reading level: Independent early reader
  Story length: Medium — middle of age range
  Tone & mood: Exciting & adventurous
  Story structure: Circular (story ends where it began)

THEMES
  Adventure & discovery: Jungle expeditions
  Nature & animals: Dinosaurs

ART STYLES
  Digital & contemporary: Pixar/Disney 3D CGI-style

EDUCATIONAL FOCUS
  STEM & critical thinking: Scientific method & hypothesis testing

CHARACTERS
  Protagonist type: Human child
  Protagonist personalisation: Child's own name as the hero`,
  },
  {
    childName: 'James', gender: 'boy',
    label: 'Dreams & bedtime adventure',
    content: `TALEKIT STORY PROFILE
────────────────────────────────────
Child's name: James
Child's gender: boy

AGE & FORMAT
  Age brackets: Ages 6–7 (early reader: longer sentences, basic chapter structure) — 400–550 words
  Reading level: Independent early reader
  Story length: Medium — middle of age range
  Tone & mood: Gentle & cosy
  Story structure: Classic (clear beginning, middle, end)

THEMES
  Everyday life & emotions: Bedtime & dreams
  Fantasy & magic: Dream realms

ART STYLES
  Themed & atmospheric: Dreamlike pastel clouds

EDUCATIONAL FOCUS
  Mindfulness & wellbeing: The value of rest and quiet

CHARACTERS
  Protagonist type: Human child`,
  },
  {
    childName: 'James', gender: 'boy',
    label: 'World cultures journey',
    content: `TALEKIT STORY PROFILE
────────────────────────────────────
Child's name: James
Child's gender: boy

AGE & FORMAT
  Age brackets: Ages 8–10 (confident reader: plot complexity, subtext, humour) — 550–800 words
  Reading level: Fluent independent reader
  Story length: Medium — middle of age range
  Tone & mood: Educational & informative
  Story structure: Quest (a journey toward a goal)

THEMES
  Cultures & people: Around-the-world adventures
  Cultures & people: Festivals & traditions (Diwali, Lunar New Year, Eid, Hanukkah, Christmas)

ART STYLES
  Cultural art styles: Japanese woodblock print

EDUCATIONAL FOCUS
  History & civics: Cultural heritage & family history

CHARACTERS
  Protagonist type: Human child
  Cultural representation: Diverse ensemble cast of characters`,
  },
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const {
    secret,
    email,
    plan          = 'scout',
    narratorVoice = 'au_female',
    storyIndex    = 0,
    total         = 7,
    sessionId     = Date.now().toString(),
  } = req.body;

  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  if (!email) {
    return res.status(400).json({ error: 'email required' });
  }

  const idx     = parseInt(storyIndex);
  const cap     = Math.min(parseInt(total), TEST_PROFILES.length);
  const profile = TEST_PROFILES[idx % TEST_PROFILES.length];
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `talekits-profile-stress-${sessionId}-${idx + 1}-${dateStr}.txt`;

  console.log(`[STRESS ${sessionId}] Story ${idx + 1}/${cap} — ${profile.label}`);

  const start = Date.now();
  let storyResult;

  try {
    const outputs = await generateStory(
      profile.content,
      profile.childName,
      filename,
      plan,
      email,
      null,
      narratorVoice
    );

    const elapsed  = Math.round((Date.now() - start) / 1000);
    const outTypes = outputs.map(o => o.type).join(', ');
    console.log(`[STRESS ${sessionId}] Story ${idx + 1} done in ${elapsed}s | ${outTypes}`);

    storyResult = { status: 'ok', story: idx + 1, label: profile.label, elapsed_s: elapsed, outputs: outTypes };
  } catch (err) {
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.error(`[STRESS ${sessionId}] Story ${idx + 1} failed: ${err.message}`);
    storyResult = { status: 'error', story: idx + 1, label: profile.label, elapsed_s: elapsed, error: err.message };
  }

  const nextIndex = idx + 1;
  const isLast    = nextIndex >= cap;

  // Fire next story as a background request — don't await, respond immediately
  if (!isLast) {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `https://${req.headers.host}`;
    const nextPayload = JSON.stringify({ secret, email, plan, narratorVoice, storyIndex: nextIndex, total: cap, sessionId });

    // Fire and forget — this starts the next Vercel function invocation
    fetch(`${baseUrl}/api/stress-test`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    nextPayload,
    }).catch(err => console.error(`[STRESS] Failed to chain story ${nextIndex + 1}: ${err.message}`));

    console.log(`[STRESS ${sessionId}] Chained story ${nextIndex + 1}/${cap}`);
  } else {
    console.log(`[STRESS ${sessionId}] All ${cap} stories complete`);
  }

  return res.status(200).json({
    ...storyResult,
    sessionId,
    next:     isLast ? null : nextIndex + 1,
    remaining: isLast ? 0   : cap - nextIndex,
    complete:  isLast,
  });
};
