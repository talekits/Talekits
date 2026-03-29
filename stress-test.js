const { generateStory } = require('./generate-story');

module.exports.maxDuration = 300;

/* ─────────────────────────────────────────────────────────────
   POST /api/stress-test
   Body: { secret, email, count, plan, narratorVoice }

   Generates `count` full stories sequentially and emails each one.
   Streams progress as newline-delimited JSON so you can watch in real time.
   Protected by CRON_SECRET (same secret used by the scheduler).
─────────────────────────────────────────────────────────────── */

// 7 varied profiles — different ages, themes, art styles and tones
// so each story comes out genuinely different
const TEST_PROFILES = [
  {
    childName: 'James',
    gender:    'boy',
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
    childName: 'James',
    gender:    'boy',
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
    childName: 'James',
    gender:    'boy',
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
    childName: 'James',
    gender:    'boy',
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
    childName: 'James',
    gender:    'boy',
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
    childName: 'James',
    gender:    'boy',
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
    childName: 'James',
    gender:    'boy',
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

  const { secret, email, count = 7, plan = 'scout', narratorVoice = 'au_female' } = req.body;

  // Auth check
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorised — wrong secret' });
  }

  if (!email) {
    return res.status(400).json({ error: 'email required' });
  }

  const total   = Math.min(parseInt(count) || 7, 10); // cap at 10
  const results = [];

  // Stream progress as newline-delimited JSON
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');

  const log = (obj) => {
    res.write(JSON.stringify(obj) + '\n');
    console.log('[STRESS]', JSON.stringify(obj));
  };

  log({ event: 'start', total, plan, email, narratorVoice, timestamp: new Date().toISOString() });

  for (let i = 0; i < total; i++) {
    const profile  = TEST_PROFILES[i % TEST_PROFILES.length];
    const dateStr  = new Date().toISOString().slice(0, 10);
    const filename = `talekits-profile-stress-${i + 1}-${dateStr}.txt`;
    const storyNum = i + 1;

    log({ event: 'story_start', story: storyNum, total, profile: profile.content.split('\n')[0].trim() });

    const start = Date.now();
    try {
      const outputs = await generateStory(
        profile.content,
        profile.childName,
        filename,
        plan,
        email,
        null,            // profileJson — use text content directly for this test
        narratorVoice
      );

      const elapsed  = Math.round((Date.now() - start) / 1000);
      const outTypes = outputs.map(o => o.type).join(', ');

      log({ event: 'story_done', story: storyNum, elapsed_s: elapsed, outputs: outTypes });
      results.push({ story: storyNum, status: 'ok', elapsed_s: elapsed, outputs: outTypes });

    } catch (err) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      log({ event: 'story_error', story: storyNum, elapsed_s: elapsed, error: err.message });
      results.push({ story: storyNum, status: 'error', elapsed_s: elapsed, error: err.message });
    }

    // Brief pause between stories to avoid rate limits
    if (i < total - 1) {
      log({ event: 'pause', message: `Waiting 3s before story ${storyNum + 1}…` });
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  const succeeded = results.filter(r => r.status === 'ok').length;
  const failed    = results.filter(r => r.status === 'error').length;

  log({
    event:     'complete',
    total,
    succeeded,
    failed,
    timestamp: new Date().toISOString(),
    results,
  });

  res.end();
};
