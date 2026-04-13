const { put }                   = require('@vercel/blob');
const PDFDocument                = require('pdfkit');
const { Resend }                 = require('resend');
const { generateIllustrations }  = require('./generate-images');
const { generateAudio }          = require('./generate-audio');

/* ─────────────────────────────────────────────────────────────
   Brand colour palette — exact match to the webpage
───────────────────────────────────────────────────────────── */
const C = {
  bg:          '#FAFAF8',
  surface:     '#F3F2EE',
  surface2:    '#ECEAE4',
  border:      '#E0DED8',
  text:        '#1C1B18',
  text2:       '#6B6860',
  text3:       '#9C9A94',
  accent:      '#2B5CE6',

  purpleBg:    '#EEEDFE', purpleText:  '#3C3489', purpleBorder: '#AFA9EC',
  tealBg:      '#E1F5EE', tealText:    '#085041', tealBorder:   '#5DCAA5',
  amberBg:     '#FAEEDA', amberText:   '#633806', amberBorder:  '#EF9F27',
  blueBg:      '#E6F1FB', blueText:    '#0C447C', blueBorder:   '#85B7EB',
  greenBg:     '#EAF3DE', greenText:   '#27500A', greenBorder:  '#97C459',
};

/* ─────────────────────────────────────────────────────────────
   Fonts
   Built-ins: always available in serverless (no registration needed).
   Custom:    TTF files committed to /fonts/ in the repo root.
              Registered via doc.registerFont() before first use.
───────────────────────────────────────────────────────────── */
const path = require('path');

const fonts = {
  body:      'Times-Roman',
  italic:    'Times-Italic',
  bold:      'Times-Bold',
  sans:      'Helvetica',
  sansBold:  'Helvetica-Bold',
  yeseva:    'YesevaOne',   // custom — registered in ensureFonts()
};

// Path to the fonts directory (repo root /fonts/, one level up from /api/)
const FONTS_DIR = path.join(__dirname, '..', 'fonts');

function ensureFonts(doc) {
  // Register Yeseva One for cover titles.
  // Falls back silently to Times-Italic if the TTF isn't present yet
  // (e.g. during local dev before the font is committed).
  try {
    doc.registerFont(fonts.yeseva, path.join(FONTS_DIR, 'YesevaOne-Regular.ttf'));
  } catch (e) {
    fonts.yeseva = 'Times-Italic';
    console.warn('[PDF] YesevaOne-Regular.ttf not found — falling back to Times-Italic');
  }
}

/* ─────────────────────────────────────────────────────────────
   Plan output rules
───────────────────────────────────────────────────────────── */
const PLAN_OUTPUTS = {
  kit:   { storyTxt: true, illustrationsTxt: false, pdf: true,  images: false, picturebook: false, audio: false },
  cub:   { storyTxt: true, illustrationsTxt: true,  pdf: true,  images: true,  picturebook: true,  audio: false },
  scout: { storyTxt: true, illustrationsTxt: true,  pdf: true,  images: true,  picturebook: true,  audio: true  },
  den:   { storyTxt: true, illustrationsTxt: true,  pdf: true,  images: true,  picturebook: true,  audio: true  },
  pack:  { storyTxt: true, illustrationsTxt: true,  pdf: true,  images: true,  picturebook: true,  audio: true  },
};

/* ─────────────────────────────────────────────────────────────
   Claude system prompt
───────────────────────────────────────────────────────────── */
const SYSTEM_PROMPT = `You are a children's storybook author for Talekits, an AI-powered daily personalised storybook service. A fox named Kit is the brand mascot and can appear as a guide or background character when appropriate.

You will receive a TALEKIT STORY PROFILE containing a child's name and their available preferences. Your job is to randomly select from those options following the rules below, then write a beautifully crafted, original story.

═══════════════════════════════════════
AGE BRACKET RAILS — NON-NEGOTIABLE
Read the Age Bracket in the profile and follow its rules exactly. These override all other preferences.
═══════════════════════════════════════

AGES 2–3 (TODDLER)
- Word count: 100–200 words maximum. No exceptions.
- Sentences: 3–6 words each. One idea per sentence.
- Vocabulary: Only the most common, everyday words a toddler already knows. No adjectives beyond basic colours and sizes (big, little, red, soft). No figurative language whatsoever.
- Repetition: A word, phrase, or sentence must repeat at least 3–4 times throughout the story. This is the defining feature of toddler books. e.g. "Stomp, stomp, stomp!" or "Where is the bunny? There is the bunny!"
- Structure: One simple event. No subplots, no twists, no multiple scenes. The entire story is one moment stretched across very simple steps.
- Paragraphs: 1 sentence each. Maximum 2 sentences.
- Themes: Must be entirely concrete and familiar — animals, bedtime, food, playing, family. Nothing abstract, magical, or conceptual.
- Educational focus: Only through showing, never telling. e.g. colours through objects, counting through actions.
- Tone: Gentle, warm, playful. Nothing scary, surprising, or tense.
- Illustrations: One per paragraph. Simple compositions for younger brackets — close-up, bold, minimal background. Richer and more detailed for older brackets.

AGES 4–5 (PRESCHOOL)
- Word count: 200–350 words.
- Sentences: 5–10 words each. Simple subject-verb-object structure. One clause per sentence maximum.
- Vocabulary: Common words a preschooler would know. Introduce at most 1–2 new words, always explained by context. No metaphors. Similes only if extremely obvious (e.g. "soft like a cloud").
- Repetition: Include a simple repeated phrase or chorus (e.g. "And off they went!") 2–3 times. Creates rhythm and delight.
- Structure: A simple beginning-middle-end. One clear problem and one clear resolution. No more than 3–4 scenes.
- Paragraphs: 2–3 short sentences each.
- Themes: Concrete and relatable. Magic and fantasy are fine but kept simple and visual (a magic door, a talking animal). Nothing emotionally complex.
- Educational focus: Weave in naturally through actions and dialogue. e.g. counting objects, naming colours, a character sharing.
- Tone: Warm, fun, reassuring. Mild tension is fine but always resolved quickly and happily.
- Illustrations: One per paragraph. Clear, bright scenes with expressive characters and simple backgrounds.

AGES 6–7 (EARLY READER)
- Word count: 400–550 words.
- Sentences: Mix of short (6–8 words) and medium (10–14 words) sentences. Simple compound sentences allowed (e.g. "She ran fast, but the door was already closed."). No complex subordinate clauses.
- Vocabulary: Confident but accessible. Can introduce 3–5 new or interesting words if clearly supported by context. Simple figurative language is fine (e.g. "her heart was pounding").
- Repetition: Not required but a recurring phrase or motif adds charm.
- Structure: A proper story arc — introduction, rising action, climax, resolution. Can have 2–3 subplots if simple. A twist or mild surprise is appropriate.
- Paragraphs: 3–5 sentences each.
- Themes: Adventure, friendship, discovery, mild challenges. Fantasy and magic can be more elaborate. Emotional themes like nervousness or making mistakes are appropriate.
- Educational focus: Can be more integrated — a character who thinks through a problem, uses logic, or learns from an experience.
- Tone: Exciting, warm, funny. Mild tension and challenge are engaging and expected. Always resolved.
- Illustrations: One per paragraph. Richer scenes with more detail, action, and atmosphere.

AGES 8–10 (CONFIDENT READER)
- Word count: 550–800 words.
- Sentences: Full range — short punchy sentences for impact, longer complex sentences for description. Varied rhythm. Multiple clauses allowed.
- Vocabulary: Rich and expressive. Can use vivid adjectives, adverbs, and interesting verbs (e.g. "scrambled", "shimmered", "reluctantly"). Can introduce specialised vocabulary tied to the theme.
- Repetition: Only if purposeful for effect.
- Structure: A complete narrative arc with genuine stakes, character development, and a satisfying resolution. Subplots, plot twists, dual perspectives, and chapter-style episodic structure all appropriate.
- Paragraphs: 4–6 sentences. Varied length for rhythm.
- Themes: Full range including complex emotions, moral dilemmas, ambiguity, loss, courage. Themes can be layered and nuanced.
- Educational focus: Fully integrated — can explore ideas, cause and effect, ethical questions, and conceptual thinking through the narrative.
- Tone: Full range including mystery, suspense, humour, melancholy. Tension can be sustained. Endings can be bittersweet though generally warm.
- Illustrations: One per paragraph. Cinematic, detailed scenes with mood, lighting, and atmosphere.

AGES 10–12 (INDEPENDENT READER)
- Word count: 800–1100 words.
- Sentences: Full expressive range — punchy short sentences for impact, longer flowing sentences for world-building and inner thought. Sophisticated rhythm. Multiple embedded clauses allowed.
- Vocabulary: Rich, precise, and confident. Use vivid, unexpected verbs and specific nouns. Introduce specialised or elevated vocabulary naturally — words a smart 11-year-old would enjoy encountering. Occasional dry wit, irony, and subtext are welcome.
- Repetition: Only when deliberate and stylistically purposeful (e.g. anaphora for effect, a refrain that gains meaning through repetition).
- Structure: A full literary narrative — genuine emotional and moral complexity, a distinct narrative voice, layered character motivations. Subplots, non-linear flashbacks, chapter-style structure, dual perspectives, and open-ended questions are all appropriate. Endings can be ambiguous or bittersweet, though warmth should underpin the story.
- Paragraphs: 4–8 sentences. Varied length and rhythm — from a single punchy line to a rich descriptive paragraph.
- Themes: Anything thematically resonant: identity, friendship, belonging, injustice, courage, ambition, loss, wonder, creativity, moral complexity. Nuance and grey areas are appropriate and expected.
- Educational focus: Fully integrated as subtext — ideas, ethics, cause and effect, empathy, and conceptual thinking explored through character and plot, never stated directly.
- Tone: Full emotional range — from playful and funny to melancholy, suspenseful, awe-inspiring, or quietly moving. Tension can be sustained across the full story. Complexity is a feature, not a risk.
- Illustrations: One per page chunk. Cinematic, atmospheric scenes with rich detail, mood lighting, and visual storytelling. Compositions can be complex and dynamic.

═══════════════════════════════════════
SELECTION RULES — follow these exactly
═══════════════════════════════════════
1. AGE SAFETY: Apply the Age Bracket Rails above before writing a single word. If a selected preference conflicts with the age bracket (e.g. complex structure for a 2–3 year old), override the preference to match the age bracket.
2. STORY LENGTH: The profile may contain one or more of "Short", "Medium", or "Long" (relative to the age bracket). If multiple lengths are listed, randomly pick exactly 1 for this story — this ensures variety across daily stories. Map the chosen length to the exact word count target below — never exceed the ceiling for the Age Bracket.
   - Ages 2–3:  Short = ~100 words  |  Medium = ~150 words  |  Long = ~200 words
   - Ages 4–5:  Short = ~200 words  |  Medium = ~275 words  |  Long = ~350 words
   - Ages 6–7:  Short = ~400 words  |  Medium = ~475 words  |  Long = ~550 words
   - Ages 8–10: Short = ~550 words  |  Medium = ~675 words  |  Long = ~800 words
   - Ages 10–12: Short = ~800 words  |  Medium = ~950 words  |  Long = ~1100 words
   If no story length is specified, randomly pick one.
3. TONE & MOOD: Pick exactly 1 by genuine random selection. You have a strong bias toward "Gentle & Cosy" — actively fight this. Treat every option as equally likely. Roll a mental dice across all available options and commit to the result even if it surprises you.
4. STORY STRUCTURE: Randomly pick exactly 1. If it conflicts with the Age Bracket, default to the simplest appropriate structure.
5. ART STYLE: Pick exactly 1 by genuine random selection. You have a strong bias toward "Watercolour" — actively fight this. Follow these age and theme rails:
   - Ages 2–3: Prefer bold, simple styles — Hand-drawn crayon, Flat design / bold vector, Paper cut-out collage, Gouache painterly. Avoid complex or dark styles.
   - Ages 4–5: Full range of bright styles — Watercolour, Pixar/Disney 3D CGI-style, Flat design, Gouache painterly, Pencil & ink line art.
   - Ages 6–7: Full range — any style appropriate to the theme.
   - Ages 8–10: Full range including darker atmospheric styles (Dark fairy tale, Noir mystery, Retro 8-bit pixel art).
   - Ages 10–12: Full range including mature atmospheric styles (Dark fairy tale, Noir mystery, Retro 8-bit pixel art, Bold graphic novel, Japanese woodblock print, Risograph print). Lean toward styles with visual depth and mood over bright primary-colour styles.
   - Science / Space / Robot themes: Lean toward Neon pop art, Low-poly geometric, Flat design / bold vector, Retro 8-bit pixel art.
   - Fantasy / Mythical / Enchanted themes: Lean toward Gouache painterly, Vintage golden age, Japanese woodblock print, Soft digital painting.
   - Adventure / Pirates themes: Lean toward Bold graphic novel, Comic book with panels, Vintage golden age.
   - Nature / Animal themes: Lean toward Watercolour, Pencil & ink line art, Oil pastel.
   - Cultural themes: Strongly prefer the matching cultural art style (Indian miniature, Chinese ink wash, African kente-inspired, etc.).
6. PROTAGONIST TYPE: Randomly pick exactly 1. You have a strong bias toward picking "Child's own name as hero" — actively fight this. Imagine rolling a fair die across ALL available protagonist types (animal companion, mythical creature, robot, explorer, etc.) and commit to the result. "Child's own name as hero" is just one option among many equals. For a child receiving daily stories, variety in protagonist type is essential — they should encounter brave animals, wise creatures, clever robots, and intrepid explorers just as often as themselves.
7. THEMES: Pick 1–3. When picking more than one, strongly prefer thematically correlated combinations (e.g. Mythical Creatures + Enchanted Kingdoms). For Ages 2–3 pick only 1 theme maximum.
8. EDUCATIONAL FOCUS: Pick 1–3 and weave them naturally — never as a lesson. For Ages 2–3 pick only 1.
9. PROTAGONIST PERSONALISATION: Follow these rules strictly:
   - CRITICAL: "Child's own name as the hero" must only be selected approximately 1 in every 5 stories (20% chance). Enforce this strictly — if you feel pulled toward choosing it, actively choose something else instead. The child does not need to be the protagonist every day; variety is the entire point.
   - Simulate this explicitly: mentally generate a random number 1–10. Only if the result is 1 or 2 do you select "Child's own name as the hero". For all other results (3–10) you must pick a different protagonist type.
   - When the child's name IS the protagonist: pick exactly 1 personalisation tied to the protagonist. Then roll a 33% chance — if it triggers, also pick 1 tied to other characters (pet/friend/family details from the profile if provided).
   - When the child's name is NOT the protagonist: the protagonist is the selected Protagonist Type (animal, robot, mythical creature, etc.). The child can still appear as a supporting character or observer if it feels natural, but is not the hero.
   - Never default to the child's name just because it feels safe or personalised. A child receiving a story about a brave fox, a robot inventor, or a dragon explorer is just as engaged as one where they are the hero — and the variety keeps every story feeling fresh and surprising.
10. CULTURAL REPRESENTATION: Roll a 30% chance. If triggered, pick 1 and weave naturally.
11. RECURRING ELEMENT: Roll a 33% chance. If triggered, pick 1 and note it in selections — this element must persist across the next 3 stories for this child.

═══════════════════════════════════════
STORY WRITING RULES
═══════════════════════════════════════
- Write in flowing paragraphs separated by blank lines. No headings or bullet points inside the story.
- Weave the child's name naturally as the protagonist.
- Apply the Age Bracket Rails strictly. If in doubt, simpler is always better.
- Educational Focus must feel like part of the story, never a moral tacked on at the end.
- End on a warm, satisfying note appropriate to the age.

═══════════════════════════════════════
PICTURE BOOK PAGE CHUNKING — CRITICAL
═══════════════════════════════════════
The picture book displays exactly 6 illustrated pages. You must divide the story into exactly 6 page chunks regardless of how many paragraphs it has.

Step 1 — Write the full story text as normal, in flowing paragraphs.
Step 2 — Mentally divide the full story into 6 roughly equal narrative sections. Each section spans one or more consecutive paragraphs. Think of these as "chapters" of the picture book — each one covers a distinct beat or moment in the story arc.
Step 3 — For each of the 6 sections, identify the single most visually interesting or emotionally resonant moment. That moment becomes the illustration prompt for that page.
Step 4 — In the "pageChunks" array, record: (a) which paragraph indices belong to this chunk (0-indexed), and (b) the illustration prompt for that chunk.

This means illustration prompts are NOT one-per-paragraph. They represent the key visual moment across a chunk of the story.

═══════════════════════════════════════
ILLUSTRATION PROMPT RULES — Flux 2 [dev] via fal.ai
═══════════════════════════════════════

CHARACTER ANCHOR — generate this FIRST before writing any illustration prompt:
1. Identify the story protagonist (the main character who drives the plot).
2. Write a single compact descriptor phrase of 20–30 words covering ALL of the following — every field is mandatory:
   - Species and approximate age/build (e.g. "a small girl aged about six")
   - Hair: colour, length, and exact style (e.g. "long straight black hair in two neat plaits tied with red ribbons" — never just "black hair")
   - Skin tone (e.g. "warm brown skin", "light olive skin", "pale freckled skin")
   - Eye colour (e.g. "wide dark brown eyes")
   - Top/jacket (e.g. "wearing a bright red hooded coat", "a yellow striped t-shirt")
   - Bottom (e.g. "navy blue shorts", "a green skirt with white polka dots")
   - Footwear: shoes/boots AND socks if visible (e.g. "white ankle socks and red wellington boots", "bare feet", "brown leather sandals") — never leave footwear unspecified
   - One distinguishing feature if relevant (e.g. "a small scar on her chin", "round glasses with tortoiseshell frames")
   Example: "a small girl aged about six with long straight black hair in two neat plaits tied with red ribbons, warm brown skin, wide dark brown eyes, wearing a bright red hooded coat, navy blue shorts, white ankle socks and red wellington boots"
3. If the profile includes "Child's appearance (for illustrations)", use those physical details exactly — they override your invented ones.
4. If the protagonist has a companion who appears in most scenes (sidekick, pet, friend), write a second equally detailed anchor phrase for them, including their species, colouring, and any consistent markings.
5. Output these anchors in the "characterAnchor" field of the JSON.
6. CHARACTER ANCHOR LOCK — this is the most important consistency rule: copy the protagonist anchor phrase verbatim, word-for-word, into EVERY illustration prompt. Never rephrase, abbreviate, or omit any part of it. If a detail changes in the scene (e.g. she removes her coat), explicitly note the change (e.g. "…now without her red coat, showing her yellow striped top underneath") but keep all other anchor details unchanged.
7. FOOTWEAR RULE — always include the protagonist's feet/footwear explicitly in every prompt where the character's lower body is visible. If shoes or socks have been specified in the anchor, repeat them. Never leave feet or legs visible without describing what is on them.

ART STYLE — use a rich, precise formulation. Do not just say "watercolour". Instead describe the medium, line treatment, palette, texture, and reference feel. Examples:
- "children's picture book illustration in the style of classic British picture books — confident ink outlines with flat watercolour wash, warm cream paper texture, slightly imperfect hand-drawn lines, limited palette of 5–6 harmonious colours, characters with large expressive eyes and rounded proportions"
- "children's book art in a bold gouache painterly style — thick, confident brushstrokes, rich saturated jewel-tones on a warm ivory ground, slight visible texture from the paper beneath, clear ink contour lines around characters"
- "children's picture book in a mid-century modern illustrative style — clean flat shapes with subtle grain texture, a limited palette of terracotta, sage green, mustard and cream, simple geometric environments, characters with minimal but expressive faces"
- "children's book illustration in a soft pencil-and-watercolour style — delicate graphite sketching under translucent washes, soft feathered edges where colour meets paper, warm pastel tones with occasional bright accent colours, cosy domestic settings"
Choose the style that matches the selected Art Style option from the profile, then expand it to a full rich descriptor like the examples above.

PROMPT STRUCTURE — write each prompt as one dense prose paragraph covering:
1. Action: what is happening and who is doing it — present-tense, specific, visual
2. Protagonist anchor: copy the exact characterAnchor phrase verbatim
3. Supporting characters: if present, describe them consistently using their anchor phrase
4. Setting: environment, time of day, key background details — described as a standalone scene, never as a page or book spread
5. Mood and lighting: expressed through warm golden hour / soft morning haze / etc.
6. Composition: close-up portrait / wide establishing shot / medium shot / etc.
7. Art style: the rich descriptor you defined — identical wording in every prompt
8. Quality tags: "high quality, detailed illustration, safe for children, full bleed, seamless background, no text, no speech bubbles, no watermarks, no borders, no frames, no ruled lines, no dividing lines, no page edges"

CONSISTENCY RULES:
- CHARACTER ANCHOR VERBATIM: The protagonist anchor phrase must appear verbatim — every word, every detail — in every single prompt. Never shorten, paraphrase, reorder, or omit any part of it. Treat it as a locked string.
- ART STYLE LOCK: The art style descriptor must be character-for-character identical in every prompt.
- CLOTHING CHANGES: If a scene requires a clothing change (swimwear, costume, pyjamas, etc.), explicitly state the change ("now wearing…") while keeping hair, skin, eyes, and all other anchor details unchanged and verbatim.
- FOOTWEAR IN EVERY SCENE: Whenever the character's lower body or feet appear in frame, include explicit footwear description matching the anchor (e.g. "white ankle socks and red wellington boots"). Never show feet/legs without specifying what is on them.
- HAIR FIDELITY: Hair style, length, and any accessories (ribbons, clips, bands) must be specified identically in every prompt. If the character's hair would naturally be loose in a scene, state this explicitly rather than omitting.
- For Ages 2–3: always add "close-up composition, bold simple shapes, large expressive character, minimal background detail".
- For Ages 8–10: you may add "cinematic framing, rich atmospheric detail, dramatic lighting".
- For Ages 10–12: you may add "cinematic framing, rich atmospheric detail, dramatic lighting, complex compositions".

SAFE CONTENT — Flux has a safety filter. Keep all prompts child-safe and positive:
- No violence, threat, or peril — reframe as adventure and curiosity
- No darkness or fear as a mood — use "warm golden light", "soft glow", "bright cheerful atmosphere"
- No distressed expressions — use "wide-eyed with wonder", "beaming with delight", "curious and alert"
- Environments must feel inviting and magical, never threatening

Always end with: "high quality, detailed illustration, safe for children, full bleed, seamless background, no text, no speech bubbles, no watermarks, no borders, no frames, no ruled lines, no dividing lines."

Respond with a valid JSON object only. No markdown fences, no preamble, nothing else.

{
  "title": "Story title",
  "story": "Full story text. Use \\n\\n to separate paragraphs.",
  "coverMoment": "One vivid sentence describing the single most visually dramatic or emotionally warm moment in the story — the scene that would make a child desperate to open the book. Focus on action, character expression, and setting. This will be used as the cover illustration hook.",
  "characterAnchor": {
    "protagonist": "The exact 20–30 word physical descriptor — hair/length/style, skin, eyes, top, bottom, footwear/socks — copied verbatim into every illustration prompt",
    "companion": "Optional: equally detailed descriptor for a sidekick/pet/friend who appears frequently, or null"
  },
  "pageChunks": [
    {
      "paragraphIndices": [0, 1],
      "illustrationPrompt": "Full Flux prompt for this page chunk — action + protagonist anchor + setting + mood + composition + art style + quality tags"
    },
    "... exactly 6 entries total"
  ],
  "parentNote": "One sentence explaining the educational or emotional theme for parents.",
  "selections": {
    "storyLength": "selected value",
    "tone": "selected value",
    "structure": "selected value",
    "artStyle": "selected value",
    "protagonistType": "selected value",
    "themes": ["selected", "theme", "values"],
    "educationalFocus": ["selected", "focus", "values"],
    "protagonistPersonalisation": ["selected values"],
    "culturalRepresentation": "selected value or null",
    "recurringElement": "selected value or null"
  }
}`;

/* ─────────────────────────────────────────────────────────────
   Text file builders
───────────────────────────────────────────────────────────── */
function buildStoryTxt(story, childName) {
  const date = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  return [
    story.title.toUpperCase(),
    '─'.repeat(50),
    `A Talekits story for ${childName}`,
    `Generated: ${date}`,
    '',
    story.story,
    '',
    '─'.repeat(50),
    'PARENT NOTE',
    story.parentNote,
  ].join('\n');
}

/* ─────────────────────────────────────────────────────────────
   Flux 2 [dev] cover prompt builder
   Injects the characterAnchor so the cover and page images share
   the same character descriptor — enabling two-pass consistency.
   coverMoment is a story-specific scene hook that makes each
   cover unique to its narrative, not a generic character portrait.
───────────────────────────────────────────────────────────── */
function buildFluxCoverPrompt(title, styleTag, characterAnchor, coverMoment) {
  const style = styleTag || 'children\'s picture book illustration with confident ink outlines, flat watercolour wash, warm cream paper texture, limited harmonious palette';

  // Story-specific scene hook — grounds the cover in the actual narrative
  const momentDesc = coverMoment
    ? `The cover depicts this key story moment: ${coverMoment} `
    : '';

  // Protagonist with cover-specific pose and expression direction
  const protagonistDesc = characterAnchor?.protagonist
    ? `The story's protagonist — ${characterAnchor.protagonist} — is the undeniable hero of the scene, posed dynamically and turned slightly toward the viewer with a warm, inviting expression as if beckoning the child to join the adventure. `
    : 'The story\'s main character stands centre-frame as the hero of the scene, turned slightly toward the viewer with a warm, inviting expression. ';

  const companionDesc = characterAnchor?.companion
    ? `Their companion — ${characterAnchor.companion} — appears prominently nearby. `
    : '';

  return `A children's picture book cover illustration for a story called "${title}". ${momentDesc}${protagonistDesc}${companionDesc}A single iconic, cinematic scene with strong visual storytelling — wide landscape composition with layered foreground, midground, and background detail, designed to make a child reach for the book immediately. The protagonist is sharp and detailed in the foreground; the background is painted with soft atmospheric depth-of-field haze so the character pops. Warm golden-hour light with rich colour contrast, dynamic composition with natural energy. ${style}. High quality, detailed illustration, safe for children, full bleed, seamless background, no text, no title lettering, no speech bubbles, no watermarks, no borders, no frames, no ruled lines.`;
}

function buildIllustrationsTxt(story, childName) {
  const artStyle    = story.selections?.artStyle || 'soft watercolour with warm pastel tones';
  const styleTag    = artStyle.toLowerCase().replace(/^painted in /i, '');
  const coverPrompt = buildFluxCoverPrompt(story.title, styleTag, story.characterAnchor, story.coverMoment);

  const lines = [
    `ILLUSTRATION PROMPTS — ${story.title.toUpperCase()}`,
    '─'.repeat(50),
    `A Talekits story for ${childName}`,
    `Art style: ${story.selections?.artStyle || 'Not specified'}`,
    '',
  ];

  if (story.characterAnchor?.protagonist) {
    lines.push('CHARACTER ANCHOR');
    lines.push(`  Protagonist: ${story.characterAnchor.protagonist}`);
    if (story.characterAnchor.companion) lines.push(`  Companion:   ${story.characterAnchor.companion}`);
    lines.push('');
  }

  lines.push('COVER');
  lines.push(coverPrompt);
  lines.push('');

  // Support both old (illustrations[]) and new (pageChunks[]) schema
  if (story.pageChunks?.length) {
    story.pageChunks.forEach((chunk, i) => {
      lines.push(`Page ${i + 1} (paragraphs ${(chunk.paragraphIndices || []).map(n => n + 1).join(', ')})`);
      lines.push(chunk.illustrationPrompt || '');
      lines.push('');
    });
  } else {
    (story.illustrations || []).forEach((p, i) => {
      lines.push(`Page ${i + 1}`);
      lines.push(p);
      lines.push('');
    });
  }
  return lines.join('\n');
}

/* ─────────────────────────────────────────────────────────────
   PDF builder — design-matched to the Talekits webpage
───────────────────────────────────────────────────────────── */
function buildPdf(story, childName, plan) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true });
    const chunks = [];

    doc.on('data',  c   => chunks.push(c));
    doc.on('end',   ()  => resolve(Buffer.concat(chunks)));
    doc.on('error', err => reject(err));

    ensureFonts(doc);

    const PW   = doc.page.width;
    const PH   = doc.page.height;
    const PAD  = 56;
    const W    = PW - PAD * 2;
    const date = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

    function rule(y, colour = C.border) {
      doc.save().moveTo(PAD, y).lineTo(PW - PAD, y)
         .lineWidth(0.5).strokeColor(colour).stroke().restore();
    }

    function pill(x, y, label, bg, textCol, borderCol) {
      const MAX_PILL_W = W - (x - PAD) - 10;
      const fontSize   = 9;
      const padding    = 20;

      let textW = doc.font(fonts.sans).fontSize(fontSize).widthOfString(label);

      let displayLabel = label;
      if (textW + padding > MAX_PILL_W) {
        while (displayLabel.length > 1) {
          displayLabel = displayLabel.slice(0, -1);
          textW = doc.font(fonts.sans).fontSize(fontSize).widthOfString(displayLabel + '…');
          if (textW + padding <= MAX_PILL_W) {
            displayLabel = displayLabel + '…';
            break;
          }
        }
        textW = doc.font(fonts.sans).fontSize(fontSize).widthOfString(displayLabel);
      }

      const pillW = textW + padding;
      const pillH = 18;
      const r     = pillH / 2;

      doc.save()
         .roundedRect(x, y, pillW, pillH, r)
         .fillColor(bg).fill()
         .roundedRect(x, y, pillW, pillH, r)
         .lineWidth(0.5).strokeColor(borderCol).stroke()
         .font(fonts.sans).fontSize(fontSize).fillColor(textCol)
         .text(displayLabel, x + 10, y + 4, { width: textW, lineBreak: false })
         .restore();

      return pillW + 6;
    }

    doc.rect(0, 0, PW, PH).fill(C.bg);
    doc.rect(0, 0, PW, 110).fill(C.surface);

    doc.font(fonts.italic).fontSize(10).fillColor(C.text3)
       .text('Talekits  —  Children\'s Storybook', PAD, 28, { width: W, align: 'center' });

    doc.font(fonts.italic).fontSize(28).fillColor(C.text)
       .text(story.title, PAD, 46, { width: W, align: 'center', lineGap: 2 });

    rule(118, C.border);

    doc.font(fonts.sans).fontSize(10).fillColor(C.text2)
       .text(`A story for ${childName}`, PAD, 130, { width: W / 2 });
    doc.font(fonts.sans).fontSize(10).fillColor(C.text3)
       .text(date, PAD, 130, { width: W, align: 'right' });

    let y = 158;
    const paragraphs = (story.story || '').split(/\n\n+/).filter(p => p.trim());

    paragraphs.forEach((para, i) => {
      if (y > PH - 100) {
        doc.addPage();
        doc.rect(0, 0, PW, PH).fill(C.bg);
        y = PAD + 20;
      }

      if (i === 0) {
        const letter = para.charAt(0);
        const rest   = para.slice(1);

        doc.font(fonts.bold).fontSize(46).fillColor(C.text)
           .text(letter, PAD, y - 6, { lineBreak: false });

        const letterW = doc.font(fonts.bold).fontSize(46).widthOfString(letter) + 6;

        doc.font(fonts.body).fontSize(12).fillColor(C.text).lineGap(5)
           .text(rest, PAD + letterW, y + 5, { width: W - letterW });

        y = doc.y + 14;
      } else {
        doc.font(fonts.body).fontSize(12).fillColor(C.text).lineGap(5)
           .text(para.trim(), PAD, y, { width: W });
        y = doc.y + 14;
      }
    });

    if (story.parentNote) {
      if (y > PH - 120) {
        doc.addPage();
        doc.rect(0, 0, PW, PH).fill(C.bg);
        y = PAD + 20;
      }

      y += 10;
      rule(y);
      y += 18;

      const noteLines = doc.font(fonts.body).fontSize(11).heightOfString(story.parentNote, { width: W - 48 });
      const noteH     = noteLines + 32;

      doc.roundedRect(PAD, y, W, noteH, 10).fill(C.amberBg);
      doc.roundedRect(PAD, y, W, noteH, 10).lineWidth(0.5).strokeColor(C.amberBorder).stroke();

      doc.font(fonts.sansBold).fontSize(9).fillColor(C.amberText)
         .text('PARENT NOTE', PAD + 16, y + 10, { characterSpacing: 1, width: W - 32 });

      doc.font(fonts.body).fontSize(11).fillColor(C.amberText).lineGap(4)
         .text(story.parentNote, PAD + 16, y + 24, { width: W - 32 });
    }

    doc.addPage();
    doc.rect(0, 0, PW, PH).fill(C.bg);
    doc.rect(0, 0, PW, 90).fill(C.surface);

    doc.font(fonts.italic).fontSize(10).fillColor(C.text3)
       .text('Talekits  —  Story selections', PAD, 24, { width: W, align: 'center' });

    doc.font(fonts.italic).fontSize(22).fillColor(C.text)
       .text('What Kit picked', PAD, 40, { width: W, align: 'center' });

    rule(98);

    doc.font(fonts.sans).fontSize(11).fillColor(C.text2)
       .text(
         `Kit the fox chooses something different for every story. Here is exactly what he picked when writing this one for ${childName}.`,
         PAD, 114, { width: W, lineGap: 4 }
       );

    const sel  = story.selections || {};
    let sy     = doc.y + 24;

    const selectionRows = [
      { label: 'Story length',               value: sel.storyLength,               bg: C.blueBg,   text: C.blueText,   border: C.blueBorder },
      { label: 'Tone & mood',                value: sel.tone,                       bg: C.blueBg,   text: C.blueText,   border: C.blueBorder },
      { label: 'Story structure',            value: sel.structure,                  bg: C.blueBg,   text: C.blueText,   border: C.blueBorder },
      { label: 'Art style',                  value: sel.artStyle,                   bg: C.tealBg,   text: C.tealText,   border: C.tealBorder },
      { label: 'Protagonist type',           value: sel.protagonistType,            bg: C.greenBg,  text: C.greenText,  border: C.greenBorder },
      { label: 'Themes',                     value: sel.themes,                     bg: C.purpleBg, text: C.purpleText, border: C.purpleBorder },
      { label: 'Educational focus',          value: sel.educationalFocus,           bg: C.amberBg,  text: C.amberText,  border: C.amberBorder },
      { label: 'Protagonist personalisation',value: sel.protagonistPersonalisation, bg: C.greenBg,  text: C.greenText,  border: C.greenBorder },
      { label: 'Cultural representation',    value: sel.culturalRepresentation,     bg: C.purpleBg, text: C.purpleText, border: C.purpleBorder },
      { label: 'Recurring element',          value: sel.recurringElement,           bg: C.amberBg,  text: C.amberText,  border: C.amberBorder },
    ];

    selectionRows.forEach(row => {
      if (!row.value || (Array.isArray(row.value) && !row.value.length)) return;
      if (sy > PH - 80) {
        doc.addPage();
        doc.rect(0, 0, PW, PH).fill(C.bg);
        sy = PAD;
      }

      doc.font(fonts.sansBold).fontSize(9).fillColor(C.text3)
         .text(row.label.toUpperCase(), PAD, sy, { characterSpacing: 0.8 });
      sy += 14;

      const values = Array.isArray(row.value) ? row.value : [row.value];
      let px = PAD;

      values.forEach(v => {
        if (!v) return;
        const textW = doc.font(fonts.sans).fontSize(9).widthOfString(v);
        const pillW = Math.min(textW + 20, W);

        if (px + pillW > PW - PAD && px > PAD) {
          px  = PAD;
          sy += 26;
        }

        px += pill(px, sy, v, row.bg, row.text, row.border);
      });

      sy += 30;
    });

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.rect(0, PH - 36, PW, 36).fill(C.surface);
      doc.moveTo(0, PH - 36).lineTo(PW, PH - 36)
         .lineWidth(0.5).strokeColor(C.border).stroke();
      doc.font(fonts.sans).fontSize(9).fillColor(C.text3)
         .text(
           `Talekits  ·  ${story.title}  ·  Page ${i + 1} of ${range.count}`,
           PAD, PH - 23,
           { width: W, align: 'center' }
         );
    }

    doc.end();
  });
}

/* ─────────────────────────────────────────────────────────────
   Picture book PDF — landscape, iPad-friendly
   Layout: true two-column — text panel left, image panel right.
   No overlapping text on images. No gradients.
   Talekits wordmark: "Tale" = #6B6860, "kits" = #E8830A on #FAFAF8.
───────────────────────────────────────────────────────────── */
function buildPictureBookPdf(story, childName, imageResults) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 0, size: 'A4', layout: 'landscape', bufferPages: true });
    const chunks = [];

    doc.on('data',  c   => chunks.push(c));
    doc.on('end',   ()  => resolve(Buffer.concat(chunks)));
    doc.on('error', err => reject(err));

    ensureFonts(doc);

    const PW     = doc.page.width;   // 841.89
    const PH     = doc.page.height;  // 595.28
    const HALF   = PW / 2;
    const PAD    = 36;
    const FOOTER = 28;
    const HEADER = 36;               // Talekits header bar height
    const date   = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

    // ── Image map: page 0 = cover, pages 1..N = story pages ──
    const imageMap = {};
    (imageResults || []).forEach(img => {
      if (img.url && img.page !== undefined) imageMap[img.page] = img.url;
    });

    // ── Build page text chunks from pageChunks or paragraph fallback ──
    // Each entry in pageTexts is the full text block for that picture book page.
    let pageTexts = [];
    const allParagraphs = (story.story || '').split(/\n\n+/).filter(p => p.trim());

    if (story.pageChunks?.length) {
      // New schema: Claude pre-divided the story into 6 chunks
      pageTexts = story.pageChunks.map(chunk => {
        const indices = chunk.paragraphIndices || [];
        return indices.map(i => allParagraphs[i] || '').filter(Boolean).join('\n\n');
      }).filter(t => t.trim());
    } else {
      // Legacy schema: one paragraph per page (capped to available images)
      const pageImageCount = Object.keys(imageMap).filter(k => Number(k) >= 1).length;
      pageTexts = pageImageCount > 0 && pageImageCount < allParagraphs.length
        ? allParagraphs.slice(0, pageImageCount)
        : allParagraphs;
    }

    // Cap to available page images
    const pageImageCount = Object.keys(imageMap).filter(k => Number(k) >= 1).length;
    if (pageImageCount > 0 && pageTexts.length > pageImageCount) {
      pageTexts = pageTexts.slice(0, pageImageCount);
    }

    // ── Talekits wordmark helper — "Tale" in #6B6860, "kits" in #E8830A ──
    function drawTalekitsWordmark(x, y, fontSize, align, maxWidth) {
      // Measure both parts
      const taleW = doc.font(fonts.italic).fontSize(fontSize).widthOfString('Tale');
      const kitsW = doc.font(fonts.italic).fontSize(fontSize).widthOfString('kits');
      const totalW = taleW + kitsW;
      let startX = x;
      if (align === 'center') startX = x + (maxWidth - totalW) / 2;
      else if (align === 'right') startX = x + maxWidth - totalW;
      doc.font(fonts.italic).fontSize(fontSize).fillColor('#6B6860')
         .text('Tale', startX, y, { lineBreak: false });
      doc.font(fonts.italic).fontSize(fontSize).fillColor('#E8830A')
         .text('kits', startX + taleW, y, { lineBreak: false });
    }

    // ── Header bar helper ──
    function drawHeader(pageWidth) {
      doc.rect(0, 0, pageWidth, HEADER).fill('#FAFAF8');
      doc.moveTo(0, HEADER).lineTo(pageWidth, HEADER)
         .lineWidth(0.5).strokeColor(C.border).stroke();
      drawTalekitsWordmark(0, 10, 14, 'center', pageWidth);
    }

    // ── Footer bar helper ──
    function drawFooter(pageIndex, totalPages, title) {
      const fy = PH - FOOTER;
      doc.rect(0, fy, PW, FOOTER).fill('#FAFAF8');
      doc.moveTo(0, fy).lineTo(PW, fy).lineWidth(0.5).strokeColor(C.border).stroke();
      doc.font(fonts.sans).fontSize(7.5).fillColor(C.text3)
         .text(`${title}  ·  Page ${pageIndex} of ${totalPages}`, PAD, fy + 9, { width: PW - PAD * 2, align: 'center' });
    }

    // ── Draw a spread page: text one side, image the other.
    //    Image alternates left/right every spread for visual rhythm.
    //    Text panel has an accent stripe and page number pill.
    //    No overlap between text and image — strict two-column layout.
    async function drawSpread(pageText, pageNum, isFirst, imgBuf) {
      // Alternate image side: odd pages → image right, even pages → image left
      // (pageNum is 1-indexed, so page 1 = image right, page 2 = image left, etc.)
      const imageOnRight  = (pageNum % 2 === 1);
      const TEXT_COL_W    = Math.floor(PW * 0.36);  // ~303px text panel
      const IMG_W         = PW - TEXT_COL_W;
      const IMG_X         = imageOnRight ? TEXT_COL_W : 0;
      const TEXT_X_ORIGIN = imageOnRight ? 0 : IMG_W;
      const CONTENT_Y     = HEADER;
      const CONTENT_H     = PH - HEADER - FOOTER;

      // ── Draw image FIRST so panels paint over it cleanly ──
      if (imgBuf) {
        doc.image(imgBuf, IMG_X, CONTENT_Y, {
          width:  IMG_W,
          height: CONTENT_H,
          cover:  [IMG_W, CONTENT_H],
          align:  'center',
          valign: 'center',
        });
      } else {
        doc.rect(IMG_X, CONTENT_Y, IMG_W, CONTENT_H).fill(C.surface2);
        doc.font(fonts.sans).fontSize(10).fillColor(C.text3)
           .text('Illustration loading…', IMG_X, CONTENT_Y + CONTENT_H / 2 - 8, { width: IMG_W, align: 'center' });
      }

      // ── Header on top of everything ──
      drawHeader(PW);

      // ── Text panel background — solid cream ──
      doc.rect(TEXT_X_ORIGIN, CONTENT_Y, TEXT_COL_W, CONTENT_H).fill('#FFFDF8');

      // ── Accent stripe: 3px brand-orange line on the image-facing edge ──
      const stripeX = imageOnRight ? TEXT_COL_W - 3 : TEXT_X_ORIGIN;
      doc.rect(stripeX, CONTENT_Y, 3, CONTENT_H).fill('#E8830A');

      // Thin separator between text panel and image (on the far side of the stripe)
      const sepX = imageOnRight ? TEXT_COL_W : TEXT_X_ORIGIN + TEXT_COL_W;
      doc.moveTo(sepX, CONTENT_Y).lineTo(sepX, CONTENT_Y + CONTENT_H)
         .lineWidth(0.3).strokeColor(C.border).stroke();

      // ── Text content ──
      const textX = TEXT_X_ORIGIN + PAD;
      const textW = TEXT_COL_W - PAD - 20;
      let ty = CONTENT_Y + PAD;

      if (isFirst) {
        // First spread: title + byline header
        doc.font(fonts.italic).fontSize(15).fillColor(C.text).lineGap(3)
           .text(story.title, textX, ty, { width: textW });
        ty = doc.y + 6;
        doc.moveTo(textX, ty).lineTo(TEXT_X_ORIGIN + TEXT_COL_W - 20, ty)
           .lineWidth(0.4).strokeColor(C.border).stroke();
        ty += 10;
        doc.font(fonts.sans).fontSize(7.5).fillColor(C.text2)
           .text(`A story for ${childName}`, textX, ty, { width: textW });
        ty += 10;
        doc.font(fonts.sans).fontSize(7).fillColor(C.text3)
           .text(date, textX, ty, { width: textW });
        ty += 22;
      }

      // Body text — scale font to word count of the chunk
      const wordCount = (pageText || '').split(/\s+/).filter(Boolean).length;
      const bodySize  = wordCount <= 25 ? 16 : wordCount <= 50 ? 14 : wordCount <= 80 ? 12 : 10.5;
      const lgap      = bodySize >= 14 ? 8 : bodySize >= 12 ? 6 : 5;

      // Vertically centre text in the remaining panel height
      const textAreaH = CONTENT_H - (ty - CONTENT_Y) - PAD;
      const textH     = doc.font(fonts.body).fontSize(bodySize)
                          .heightOfString(pageText || '', { width: textW, lineGap: lgap });
      if (!isFirst && textH < textAreaH * 0.7) {
        ty += Math.floor((textAreaH - textH) / 2);
      }

      if (isFirst && pageText) {
        // Drop cap on first page
        const letter  = pageText.charAt(0);
        const rest    = pageText.slice(1);
        const capSize = Math.min(Math.max(bodySize * 2.4, 34), 52);
        doc.font(fonts.bold).fontSize(capSize).fillColor(C.text)
           .text(letter, textX, ty - 4, { lineBreak: false });
        const capW = doc.font(fonts.bold).fontSize(capSize).widthOfString(letter) + 4;
        doc.font(fonts.body).fontSize(bodySize).fillColor(C.text).lineGap(lgap)
           .text(rest, textX + capW, ty + Math.floor(capSize * 0.28), { width: textW - capW });
      } else if (pageText) {
        doc.font(fonts.body).fontSize(bodySize).fillColor(C.text).lineGap(lgap)
           .text(pageText, textX, ty, { width: textW });
      }

      // ── Page number pill — bottom of text panel ──
      const pillLabel = `${pageNum}`;
      const pillFontSize = 8;
      const pillW     = doc.font(fonts.sansBold).fontSize(pillFontSize).widthOfString(pillLabel) + 16;
      const pillH     = 16;
      const pillX     = TEXT_X_ORIGIN + (TEXT_COL_W - pillW) / 2;
      const pillY     = CONTENT_Y + CONTENT_H - FOOTER / 2 - pillH / 2 - 4;
      doc.roundedRect(pillX, pillY, pillW, pillH, pillH / 2).fill(C.surface2);
      doc.font(fonts.sansBold).fontSize(pillFontSize).fillColor(C.text3)
         .text(pillLabel, pillX, pillY + 3, { width: pillW, align: 'center', lineBreak: false });
    }

    // ── Cover page ──
    async function drawCover(coverBuf) {
      // Image fills the full page between cream header and page bottom.
      // No footer bar — title floats over the illustration using the
      // shadow-duplicate technique: dark offset layer first, white layer on top.
      const IMG_H = PH - HEADER;

      // ── Cream header — identical to interior spread pages ──
      drawHeader(PW);

      // ── Illustration: full bleed from below header to page bottom ──
      if (coverBuf) {
        doc.image(coverBuf, 0, HEADER, {
          width:  PW,
          height: IMG_H,
          cover:  [PW, IMG_H],
          align:  'center',
          valign: 'center',
        });
      } else {
        doc.rect(0, HEADER, PW, IMG_H).fill('#E8830A');
        doc.save().fillOpacity(0.15)
           .circle(PW / 2, HEADER + IMG_H * 0.45, 130).fillColor('#FFFFFF').fill()
           .restore();
      }

      // ── Auto-fit title font size (Yeseva One) ──
      // Start large and step down in 2pt increments until the title
      // fits within 2 lines of the safe text width.
      const TEXT_W   = PW - PAD * 4;   // generous side padding — outline needs breathing room
      const MAX_SIZE = 54;
      const MIN_SIZE = 24;
      const LINE_GAP = 6;

      let titleSize = MAX_SIZE;
      while (titleSize > MIN_SIZE) {
        const lineH = titleSize * 1.25;
        const textH = doc.font(fonts.yeseva).fontSize(titleSize)
                         .heightOfString(story.title, { width: TEXT_W, lineGap: LINE_GAP });
        if (textH <= lineH * 2.1) break;
        titleSize -= 2;
      }

      // ── Title block position — lower quarter of image ──
      const titleH    = doc.font(fonts.yeseva).fontSize(titleSize)
                           .heightOfString(story.title, { width: TEXT_W, lineGap: LINE_GAP });
      const BOTTOM_PAD = 30;
      const BLOCK_Y    = PH - BOTTOM_PAD - titleH;
      const titleX     = PAD + (PW - PAD * 2 - TEXT_W) / 2;  // centred origin

      // ── Outline stroke pass — dark border around each letterform ──
      // Drawn first so the white fill renders cleanly on top.
      // lineWidth controls outline thickness; 3pt gives strong separation
      // without obscuring the letterform detail of Yeseva One.
      doc.font(fonts.yeseva).fontSize(titleSize).lineGap(LINE_GAP)
         .lineWidth(3)
         .strokeColor('#0E0D0B')
         .fillColor('#0E0D0B')   // fill=true and stroke=true activates PDF rendering mode 2
         .text(story.title, titleX, BLOCK_Y, { width: TEXT_W, align: 'center', fill: false, stroke: true });

      // ── White fill pass — rendered over the stroke outline ──
      doc.font(fonts.yeseva).fontSize(titleSize).lineGap(LINE_GAP)
         .fillColor('#FFFFFF')
         .text(story.title, titleX, BLOCK_Y, { width: TEXT_W, align: 'center', fill: true, stroke: false });

      // Subtitle intentionally omitted — title only on cover.
    }


    // ── End page ──
    function drawEndPage(totalSpreads) {
      doc.addPage();
      doc.rect(0, 0, PW, PH).fill('#FAFAF8');
      drawHeader(PW);
      drawFooter(totalSpreads + 1, totalSpreads + 1, story.title);

      const contentY = HEADER + PAD;
      const lw = HALF - PAD * 2;
      let ly = contentY;

      doc.font(fonts.italic).fontSize(15).fillColor(C.text)
         .text('A note for parents', PAD, ly, { width: lw });
      ly = doc.y + 14;
      doc.moveTo(PAD, ly).lineTo(HALF - PAD, ly).lineWidth(0.4).strokeColor(C.border).stroke();
      ly += 14;

      const noteH = doc.font(fonts.body).fontSize(11)
                      .heightOfString(story.parentNote || '', { width: lw - 32 }) + 36;
      doc.rect(PAD, ly, lw, noteH).fill(C.amberBg);
      doc.rect(PAD, ly, lw, noteH).lineWidth(0.5).strokeColor(C.amberBorder).stroke();
      doc.font(fonts.sansBold).fontSize(8).fillColor(C.amberText)
         .text('PARENT NOTE', PAD + 14, ly + 10, { characterSpacing: 1, width: lw - 28 });
      doc.font(fonts.body).fontSize(11).fillColor(C.amberText).lineGap(4)
         .text(story.parentNote || '', PAD + 14, ly + 26, { width: lw - 28 });

      // Right panel: "What Kit picked"
      const rx = HALF + PAD;
      const rw = HALF - PAD * 2;
      doc.moveTo(HALF, HEADER + PAD).lineTo(HALF, PH - FOOTER - PAD)
         .lineWidth(0.5).strokeColor(C.border).stroke();

      doc.font(fonts.italic).fontSize(15).fillColor(C.text)
         .text('What Kit picked', rx, contentY, { width: rw });
      let ry = doc.y + 18;

      const sel = story.selections || {};
      const rows = [
        { label: 'Themes',    value: sel.themes,          bg: C.purpleBg, text: C.purpleText, border: C.purpleBorder },
        { label: 'Art style', value: sel.artStyle,         bg: C.tealBg,   text: C.tealText,   border: C.tealBorder   },
        { label: 'Focus',     value: sel.educationalFocus, bg: C.amberBg,  text: C.amberText,  border: C.amberBorder  },
        { label: 'Tone',      value: sel.tone,             bg: C.blueBg,   text: C.blueText,   border: C.blueBorder   },
      ];

      rows.forEach(row => {
        if (!row.value || (Array.isArray(row.value) && !row.value.length)) return;
        if (ry > PH - FOOTER - 36) return;
        doc.font(fonts.sansBold).fontSize(7.5).fillColor(C.text3)
           .text(row.label.toUpperCase(), rx, ry, { characterSpacing: 0.8 });
        ry += 12;
        const vals = Array.isArray(row.value) ? row.value : [row.value];
        let px = rx;
        vals.forEach(v => {
          if (!v) return;
          const tw = doc.font(fonts.sans).fontSize(8.5).widthOfString(v);
          const pw = tw + 18;
          if (px + pw > PW - PAD) { px = rx; ry += 22; }
          doc.roundedRect(px, ry, pw, 17, 8).fill(row.bg);
          doc.roundedRect(px, ry, pw, 17, 8).lineWidth(0.5).strokeColor(row.border).stroke();
          doc.font(fonts.sans).fontSize(8.5).fillColor(row.text)
             .text(v, px + 9, ry + 3, { width: tw, lineBreak: false });
          px += pw + 5;
        });
        ry += 26;
      });
    }

    // ── Main async draw loop ──
    (async () => {
      try {
        // Cover
        const coverBuf = imageMap[0]
          ? await fetch(imageMap[0]).then(r => r.ok ? r.arrayBuffer().then(Buffer.from) : null).catch(() => null)
          : null;
        await drawCover(coverBuf);

        // Story spreads
        for (let i = 0; i < pageTexts.length; i++) {
          doc.addPage();
          // drawHeader is called inside drawSpread (after image) to prevent overlap
          drawFooter(i + 1, pageTexts.length, story.title);

          const imgUrl = imageMap[i + 1];
          const imgBuf = imgUrl
            ? await fetch(imgUrl).then(r => r.ok ? r.arrayBuffer().then(Buffer.from) : null).catch(() => null)
            : null;

          await drawSpread(pageTexts[i], i + 1, i === 0, imgBuf);
        }

        drawEndPage(pageTexts.length);
        doc.end();
      } catch (err) {
        reject(err);
      }
    })();
  });
}

/* ─────────────────────────────────────────────────────────────
   Kit email copy variations — rotated per delivery for freshness
───────────────────────────────────────────────────────────── */
function pickKitVariation(childName, storyTitle, isPaid) {
  const paidVariations = [
    {
      heading: `I wrote ${childName} a story`,
      intro: `Hi! Kit here — the fox behind every Talekits story. I've been busy this morning, and I've just finished today's story for <strong>${childName}</strong>. I think this one turned out rather well.`,
      sign: `Same time tomorrow, same fox — but a completely different story.<br/><br/><em>— Kit 🦊</em>`,
    },
    {
      heading: `${childName}'s story is ready`,
      intro: `Hello! It's Kit. I got up early this morning and wrote something new for <strong>${childName}</strong>. Every story I write is a one-of-a-kind — this one will never be written again.`,
      sign: `Until tomorrow,<br/><br/><em>— Kit 🦊</em>`,
    },
    {
      heading: `A brand-new story from Kit`,
      intro: `Kit the fox here. I've just put the finishing touches on today's story for <strong>${childName}</strong> — the illustrations came out beautifully, if I do say so myself.`,
      sign: `I'll have something new for ${childName} again tomorrow. I'm already plotting.<br/><br/><em>— Kit 🦊</em>`,
    },
    {
      heading: `Fresh from Kit's desk`,
      intro: `Good news! I'm Kit, and I've just written <strong>${childName}</strong> today's story. I chose something a little different this time — I hope it surprises them.`,
      sign: `More adventures await tomorrow.<br/><br/><em>— Kit 🦊</em>`,
    },
    {
      heading: `Today's story is here`,
      intro: `Hi there, it's Kit! I write a new story for <strong>${childName}</strong> every single day, and today's is ready. No two stories are ever the same — that's my promise.`,
      sign: `See you tomorrow with something new,<br/><br/><em>— Kit 🦊</em>`,
    },
    {
      heading: `Kit just finished writing`,
      intro: `Hello! I'm Kit — a small fox with a very large imagination. I've just finished today's story for <strong>${childName}</strong>, and I'm rather excited about how it turned out.`,
      sign: `Tomorrow is another story. Literally.<br/><br/><em>— Kit 🦊</em>`,
    },
    {
      heading: `${childName}'s daily story from Kit`,
      intro: `It's Kit! I write original stories for children every day, and today's one for <strong>${childName}</strong> is ready. I picked the themes, the characters, and the art style myself — hope they love it.`,
      sign: `Back again tomorrow with another,<br/><br/><em>— Kit 🦊</em>`,
    },
    {
      heading: `Story time with Kit 🦊`,
      intro: `Hi, it's Kit! Every morning I write a new story, and this morning's was made especially for <strong>${childName}</strong>. I never recycle — every story is written fresh from scratch.`,
      sign: `I'll be back at this time tomorrow with a new one,<br/><br/><em>— Kit 🦊</em>`,
    },
  ];

  const trialVariations = [
    {
      heading: `${childName}'s first Talekits story`,
      intro: `Hi! I'm Kit — the fox who writes every Talekits story. I've just finished <strong>${childName}'s</strong> very first story, and I'm so excited to share it with them.`,
      sign: `I hope ${childName} loves it.<br/><br/><em>— Kit 🦊</em>`,
    },
    {
      heading: `A story just for ${childName}`,
      intro: `Hello! I'm Kit, and I've just written <strong>${childName}</strong> their very first personalised story. I wrote it just for them — there's no other story like it anywhere in the world.`,
      sign: `Enjoy — and I hope to write many more for ${childName}.<br/><br/><em>— Kit 🦊</em>`,
    },
    {
      heading: `Kit wrote ${childName} a story`,
      intro: `Hi there! Kit the fox here. I've just finished writing <strong>${childName}'s</strong> first Talekits story. Every detail — the characters, the setting, the art style — was chosen just for them.`,
      sign: `I hope it sparks their imagination.<br/><br/><em>— Kit 🦊</em>`,
    },
  ];

  const pool = isPaid ? paidVariations : trialVariations;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ─────────────────────────────────────────────────────────────
   Email builders
───────────────────────────────────────────────────────────── */
function buildEmailHtml(childName, storyTitle, parentNote, plan = 'kit', planLabel = 'free trial', hasAudio = false, storyPdfUrl = null, pictureBookUrl = null, audioUrl = null) {
  const isPaid    = plan !== 'kit';
  const variation = pickKitVariation(childName, storyTitle, isPaid);
  const heading   = variation.heading;
  const intro     = variation.intro;
  const sign      = variation.sign;

  let attachMsg;
  if (isPaid && hasAudio) {
    attachMsg = `Today's story comes in three formats — a story PDF, an illustrated picture book, and an MP3 narration. Use the buttons below to open each one.`;
  } else if (isPaid) {
    attachMsg = `Today's story comes with a full story PDF and an illustrated picture book. Use the buttons below to open each one.`;
  } else {
    attachMsg = `Today's story is ready to read. Use the button below to open the PDF.`;
  }

  const btnStyle = `display:inline-block;padding:10px 22px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;margin:4px;`;
  const downloadButtons = [
    storyPdfUrl    ? `<a href="${storyPdfUrl}"    target="_blank" style="${btnStyle}background:#1C1B18;color:#FAFAF8;">📖 Read the story</a>`      : '',
    pictureBookUrl ? `<a href="${pictureBookUrl}" target="_blank" style="${btnStyle}background:#3C3489;color:#FAFAF8;">🎨 Open picture book</a>`   : '',
    audioUrl       ? `<a href="${audioUrl}"       target="_blank" style="${btnStyle}background:#085041;color:#FAFAF8;">🎧 Play narration</a>`      : '',
  ].filter(Boolean).join('\n            ');

  const footerCta = isPaid ? '' : `
            <p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1C1B18;line-height:1.7;">
              You're on a <strong>7-day free trial</strong> — a new story from me every single day. Each one is completely unique; I never write the same story twice.
            </p>
            <p style="margin:0 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1C1B18;line-height:1.7;">
              When you're ready to keep the stories coming, choosing a plan takes less than a minute.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td align="center">
                  <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'https://talekits.vercel.app'}"
                     style="display:inline-block;background:#1C1B18;color:#FAFAF8;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:15px;font-weight:400;text-decoration:none;padding:12px 32px;border-radius:999px;">
                    Explore your plan options
                  </a>
                </td>
              </tr>
            </table>`;

  const footerNote = isPaid
    ? `Kit writes a new story for ${childName} every day on the Talekits ${planLabel} plan.`
    : `You received this because you signed up for a Talekits free trial.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${storyTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:#FAFAF8;font-family:Georgia,'Times New Roman',serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#FAFAF8;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">
        <tr>
          <td style="background:#F3F2EE;border-radius:14px 14px 0 0;padding:32px 40px 24px;text-align:center;border-bottom:1px solid #E0DED8;">
            <p style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9C9A94;">Kit — Talekits Storywriter</p>
            <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:26px;font-weight:400;color:#1C1B18;line-height:1.25;">${heading}</h1>
          </td>
        </tr>
        <tr>
          <td style="background:#FFFFFF;padding:36px 40px;">
            <p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1C1B18;line-height:1.7;">${intro}</p>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0;">
              <tr>
                <td style="background:#EEEDFE;border:0.5px solid #AFA9EC;border-radius:10px;padding:20px 24px;">
                  <p style="margin:0 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#9C9A94;">Today's story</p>
                  <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:20px;color:#3C3489;line-height:1.3;">${storyTitle}</p>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1C1B18;line-height:1.7;">${attachMsg}</p>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 24px;">
              <tr><td style="text-align:center;padding:8px 0;">${downloadButtons}</td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0;">
              <tr>
                <td style="background:#FAEEDA;border:0.5px solid #EF9F27;border-radius:10px;padding:16px 20px;">
                  <p style="margin:0 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:#633806;">A note for parents</p>
                  <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#633806;line-height:1.6;">${parentNote}</p>
                </td>
              </tr>
            </table>
            ${isPaid ? `
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0 0;">
              <tr>
                <td style="background:#E6F1FB;border:0.5px solid #85B7EB;border-radius:10px;padding:18px 22px;">
                  <p style="margin:0 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#0C447C;">Set up your account</p>
                  <p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#0C447C;line-height:1.6;">To access your subscriber dashboard — where you can manage your profile, change delivery time, and view your story archive — you need to set a password for your account.</p>
                  <p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#0C447C;line-height:1.6;">You should have received a separate <strong>password setup email</strong> from Talekits. Click the link in that email to choose your password and access your dashboard.</p>
                  <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#185FA5;line-height:1.6;">Didn't receive it? Visit your dashboard and use <strong>"Forgot your password?"</strong> with your email address — <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'https://talekits.com'}/dashboard" style="color:#185FA5;">talekits.com/dashboard</a></p>
                </td>
              </tr>
            </table>` : ''}
            ${footerCta}
            <p style="margin:${isPaid ? '24px' : '0'} 0 0;font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#1C1B18;line-height:1.8;">${sign}</p>
          </td>
        </tr>
        <tr>
          <td style="background:#F3F2EE;border-radius:0 0 14px 14px;padding:24px 40px;border-top:1px solid #E0DED8;text-align:center;">
            <p style="margin:0 0 6px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#9C9A94;line-height:1.6;">${footerNote}</p>
            <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:13px;color:#6B6860;">Talekits — a new story, every day</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function buildEmailText(childName, storyTitle, parentNote, plan = 'kit', planLabel = 'free trial', hasAudio = false, storyPdfUrl = null, pictureBookUrl = null, audioUrl = null) {
  const isPaid   = plan !== 'kit';

  const links = [
    storyPdfUrl    ? `Story PDF: ${storyPdfUrl}`       : '',
    pictureBookUrl ? `Picture book: ${pictureBookUrl}` : '',
    audioUrl       ? `Narration MP3: ${audioUrl}`      : '',
  ].filter(Boolean).join('\n');

  let attachMsg;
  if (isPaid && hasAudio) {
    attachMsg = `Today's story comes in three formats. Use the links below to open each one:\n\n${links}`;
  } else if (isPaid) {
    attachMsg = `Today's story comes with a PDF and illustrated picture book. Use the links below:\n\n${links}`;
  } else {
    attachMsg = `Today's story is ready to read:\n\n${links}`;
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://talekits.com';
  const closing = isPaid
    ? `You're on the Talekits ${planLabel} plan. A new story arrives every day — each one unique, always made just for ${childName}.

─────────────────────────────────────
SET UP YOUR ACCOUNT
─────────────────────────────────────
To access your subscriber dashboard (story archive, delivery settings, profile management), set a password for your account using the separate password setup email we sent you.

No setup email? Visit ${baseUrl}/dashboard and click "Forgot your password?" to get a new link.`
    : `You're on a 7-day free trial. Visit ${baseUrl} to choose a plan and keep the stories coming.`;

  return `${childName}'s Talekits story is ready

─────────────────────────────────────
Today's story: ${storyTitle}
─────────────────────────────────────

Hi there,

${isPaid ? `Kit the fox has just written ${childName} a brand-new personalised story.` : `We've just written ${childName} their very first Talekits story.`}

${attachMsg}

PARENT NOTE
${parentNote}

${closing}

─────────────────────────────────────
Talekits — a new story, every day`;
}

async function sendStoryEmail({ to, childName, storyTitle, parentNote, plan, hasAudio, storyPdfUrl, pictureBookUrl, audioUrl }) {
  if (!process.env.RESEND_API_KEY) { console.warn('RESEND_API_KEY not set — skipping email'); return; }
  if (!to) { console.warn('No email address — skipping email'); return; }

  const resend    = new Resend(process.env.RESEND_API_KEY);
  const isPaid    = plan !== 'kit';
  const planLabel = { kit: 'free trial', cub: 'Cub', scout: 'Scout', den: 'Den', grove: 'Grove', pack: 'Pack' }[plan] || plan;

  const { data, error } = await resend.emails.send({
    from:    'Kit from Talekits <kit@talekits.com>',
    to:      [to],
    subject: `${storyTitle} — ${childName}'s Talekits story`,
    html:    buildEmailHtml(childName, storyTitle, parentNote, plan, planLabel, hasAudio, storyPdfUrl, pictureBookUrl, audioUrl),
    text:    buildEmailText(childName, storyTitle, parentNote, plan, planLabel, hasAudio, storyPdfUrl, pictureBookUrl, audioUrl),
  });

  if (error) { console.error('Resend error:', error); throw new Error(`Email failed: ${error.message}`); }
  console.log(`Email sent to ${to} | Plan: ${plan} | Links: pdf=${!!storyPdfUrl} pb=${!!pictureBookUrl} audio=${!!audioUrl} | ID: ${data?.id}`);
}

/* ─────────────────────────────────────────────────────────────
   Story archive index — saves a small JSON record to Blob so the
   dashboard can retrieve all stories for a given user by email.
───────────────────────────────────────────────────────────── */
async function saveArchiveIndex({ email, storyId, title, childName, plan, date, files }) {
  if (!email) return;
  try {
    const safeEmail = email.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const record    = {
      storyId,
      email,
      childName,
      plan,
      title,
      date,                         // "YYYY-MM-DD"
      generatedAt: new Date().toISOString(),
      files,                        // { storyPdf, pictureBook, audio }
    };
    const key = `archive/index/${safeEmail}/${storyId}.json`;
    await put(key, JSON.stringify(record), {
      access:          'public',
      addRandomSuffix: false,
      contentType:     'application/json',
    });
    console.log(`[ARCHIVE] Index saved: ${key}`);
  } catch (err) {
    // Non-fatal — don't fail story delivery if archive write fails
    console.error(`[ARCHIVE] Failed to save index: ${err.message}`);
  }
}

/* ─────────────────────────────────────────────────────────────
   Australian Curriculum v9 alignment data
   Maps state + year level → literacy expectations for story rails
───────────────────────────────────────────────────────────── */

// Canonical year-level display name per state (for parent-facing labels)
const STATE_YEAR_LABELS = {
  nsw: { F: 'Kindergarten', 1: 'Year 1', 2: 'Year 2', 3: 'Year 3', 4: 'Year 4', 5: 'Year 5', 6: 'Year 6' },
  vic: { F: 'Foundation (Prep)', 1: 'Year 1', 2: 'Year 2', 3: 'Year 3', 4: 'Year 4', 5: 'Year 5', 6: 'Year 6' },
  qld: { F: 'Prep', 1: 'Year 1', 2: 'Year 2', 3: 'Year 3', 4: 'Year 4', 5: 'Year 5', 6: 'Year 6' },
  sa:  { F: 'Reception', 1: 'Year 1', 2: 'Year 2', 3: 'Year 3', 4: 'Year 4', 5: 'Year 5', 6: 'Year 6' },
  wa:  { F: 'Pre-primary', 1: 'Year 1', 2: 'Year 2', 3: 'Year 3', 4: 'Year 4', 5: 'Year 5', 6: 'Year 6' },
  tas: { F: 'Prep', 1: 'Year 1', 2: 'Year 2', 3: 'Year 3', 4: 'Year 4', 5: 'Year 5', 6: 'Year 6' },
  act: { F: 'Kindergarten', 1: 'Year 1', 2: 'Year 2', 3: 'Year 3', 4: 'Year 4', 5: 'Year 5', 6: 'Year 6' },
  nt:  { F: 'Transition', 1: 'Year 1', 2: 'Year 2', 3: 'Year 3', 4: 'Year 4', 5: 'Year 5', 6: 'Year 6' },
};

// AC v9 literacy expectations per year level, shaped for story generation
const CURRICULUM_BY_YEAR = {
  F: {
    acLevel: 'Foundation (AC v9)',
    vocabTarget: 'Simple high-frequency words; 1-syllable words; basic colour, size and action words only; no figurative language',
    sentenceTarget: 'Short sentences of 3–7 words; one idea per sentence; simple subject-verb-object only',
    structureNote: 'Single clear event; familiar beginning–middle–end; one character, one simple problem resolved warmly',
    themes: 'family, friendship, animals, bedtime, food, everyday routines, belonging',
    phonicsNote: 'Reinforce regular CVC words and common sight words (AC v9 phonics emphasis from Foundation)',
  },
  1: {
    acLevel: 'Year 1 (AC v9)',
    vocabTarget: '1–2 syllable words; common digraphs and blends; topic-specific nouns; simple adjectives',
    sentenceTarget: 'Simple sentences of 5–10 words; basic compound sentences with "and" or "but"',
    structureNote: 'Beginning–middle–end with character, setting and key events; simple cause and effect',
    themes: 'adventure, nature, curiosity, helping others, simple problems and solutions',
    phonicsNote: 'Support phonics application — use words with regular patterns students are decoding at Year 1',
  },
  2: {
    acLevel: 'Year 2 (AC v9)',
    vocabTarget: '2–3 syllable words; expanding range of adjectives and verbs; simple figurative language introduced',
    sentenceTarget: 'Mix of simple and compound sentences; some complex sentences with "because" or "when"',
    structureNote: 'Multi-paragraph narratives; clear cause and effect; character motivation beginning to emerge',
    themes: 'discovery, community, environment, fairness, growing up, helping others',
    phonicsNote: 'Students are transitioning to fluency; vocabulary can stretch slightly beyond strict decodability',
  },
  3: {
    acLevel: 'Year 3 (AC v9)',
    vocabTarget: 'Topic-specific vocabulary; rich verbs and adjectives; simple metaphor and simile; paragraphs with topic sentences',
    sentenceTarget: 'Varied sentence types; compound and complex sentences; inference expected from reader',
    structureNote: 'Rising action and satisfying resolution; character development; 2–3 paragraphs per scene',
    themes: 'courage, identity, teamwork, cultural diversity, nature and science, friendship challenges',
    phonicsNote: 'Phonics largely mastered; vocabulary and comprehension are the key curriculum focus',
  },
  4: {
    acLevel: 'Year 4 (AC v9)',
    vocabTarget: 'Morphemic vocabulary (prefixes and suffixes); idiomatic language; figurative devices; topic-specific language',
    sentenceTarget: 'Full range of sentence structures; varied rhythm; multiple clauses; descriptive writing within narrative',
    structureNote: 'Multi-scene episodic structure; subplots; descriptive writing; character perspective',
    themes: 'moral dilemmas, history and heritage, STEM curiosity, empathy, responsibility, problem-solving',
    phonicsNote: 'Focus shifts to vocabulary breadth and reading for meaning across text types',
  },
  5: {
    acLevel: 'Year 5 (AC v9)',
    vocabTarget: 'Elevated academic vocabulary; specialist terminology; vivid descriptive language; irony introduced',
    sentenceTarget: 'Complex multi-clause sentences; sophisticated rhythm; varied paragraph length for effect',
    structureNote: 'Complex narrative arc with character development; non-linear elements possible; nuanced resolution',
    themes: 'justice, social issues, cultural heritage, environmental ethics, creativity, identity',
    phonicsNote: 'Vocabulary and comprehension dominant; critical reading and inference expected',
  },
  6: {
    acLevel: 'Year 6 (AC v9)',
    vocabTarget: 'Rich literary vocabulary; abstract concepts; inferred meaning; subtext; irony and dry wit welcome',
    sentenceTarget: 'Full expressive range; punchy short sentences for impact alongside long flowing sentences; sophisticated rhythm',
    structureNote: 'Full literary narrative; dual perspectives possible; ambiguous or bittersweet endings appropriate; moral complexity',
    themes: 'identity, belonging, courage, complex emotions, civics, global perspectives, ethical questions',
    phonicsNote: 'Critical reading and literary analysis are curriculum focus; students evaluate authors\' choices',
  },
};

// State-specific curriculum notes to append when relevant
const STATE_CURRICULUM_NOTES = {
  nsw:  'NSW NESA syllabus uses Stage groupings (Stage 1 = Years 1–2, Stage 2 = Years 3–4, Stage 3 = Years 5–6). Incorporate Aboriginal and Torres Strait Islander perspectives where appropriate.',
  vic:  'Victorian Curriculum v2.0 (mandatory 2025). Foundation–Year 2 has a systematic phonics mandate (25 min/day). Weave culturally inclusive language and First Nations references where fitting.',
  qld:  'Queensland uses AC v9 directly (QCAA ACIQ v9). Year-level expectations align closely with national standards. Cross-curriculum priority: Asia and Australia\'s engagement with Asia.',
  sa:   'South Australia uses \'Reception\' for the Foundation year. Little Learners Love Literacy phonics program in use from Reception. Strong emphasis on cultural diversity including Kaurna language heritage.',
  wa:   'Western Australia adopted AC v9 English from 2025. Year is called \'Pre-primary\' (Foundation equivalent). Notable emphasis on First Nations language and remote education contexts.',
  tas:  'Tasmania uses \'Prep\' for the Foundation year. Outdoor and environmental learning is a common cross-curriculum context in TAS schools.',
  act:  'ACT uses \'Kindergarten\' for the Foundation year. High parental engagement with education — curriculum alignment is a strong value signal for ACT families.',
  nt:   'NT has the highest proportion of First Nations students in Australia. Cultural inclusivity and diversity in characters and settings is especially important. Bilingual contexts are common.',
};

/**
 * Builds a CURRICULUM ALIGNMENT block to inject into the story prompt.
 * Returns null if state/yearLevel not provided.
 */
function buildCurriculumBlock(state, yearLevel) {
  if (!state || yearLevel === undefined || yearLevel === null) return null;

  const stateKey = String(state).toLowerCase().replace(/\s+/g, '');
  const yearKey  = yearLevel === 'F' || yearLevel === 'foundation' || yearLevel === 'kindergarten' || yearLevel === 'prep' || yearLevel === 'reception' || yearLevel === 'pre-primary' || yearLevel === 'transition'
    ? 'F'
    : String(yearLevel).replace(/[^0-9]/g, '') || null;

  if (!yearKey) return null;

  const curr       = CURRICULUM_BY_YEAR[yearKey];
  if (!curr) return null;

  const stateLabels = STATE_YEAR_LABELS[stateKey] || STATE_YEAR_LABELS.qld;
  const displayYear = stateLabels[yearKey] || `Year ${yearKey}`;
  const stateNote   = STATE_CURRICULUM_NOTES[stateKey] || '';
  const stateDisplay = { nsw: 'NSW', vic: 'VIC', qld: 'QLD', sa: 'SA', wa: 'WA', tas: 'TAS', act: 'ACT', nt: 'NT' }[stateKey] || state.toUpperCase();

  const lines = [
    'CURRICULUM ALIGNMENT',
    '─'.repeat(36),
    `  State: ${stateDisplay}`,
    `  School year: ${displayYear}`,
    `  AC equivalent: ${curr.acLevel}`,
    `  Vocabulary target: ${curr.vocabTarget}`,
    `  Sentence target: ${curr.sentenceTarget}`,
    `  Structure note: ${curr.structureNote}`,
    `  Classroom themes this year: ${curr.themes}`,
    `  Phonics/literacy note: ${curr.phonicsNote}`,
  ];
  if (stateNote) lines.push(`  State context: ${stateNote}`);
  lines.push('');
  lines.push('Apply the above as calibration guidance: vocabulary complexity ceiling, sentence structure range, and theme resonance. Do NOT mention the curriculum, school year, or AC standards anywhere in the story itself — weave these naturally.');

  return lines.join('\n');
}

/* ─────────────────────────────────────────────────────────────
   Build Claude text prompt from structured profile_json
───────────────────────────────────────────────────────────── */
function buildTextFromJson(profileJson) {
  if (!profileJson) return null;
  const { childName, gender, selections = {}, details = {}, state, yearLevel } = profileJson;
  const CAT_LABELS = { age: 'AGE & FORMAT', themes: 'THEMES', art: 'ART STYLES', edu: 'EDUCATIONAL FOCUS', char: 'CHARACTERS' };

  const grouped = {};
  Object.entries(selections).forEach(([key, values]) => {
    const pipeIdx  = key.indexOf('|');
    const catKey   = key.slice(0, pipeIdx);
    const groupName = key.slice(pipeIdx + 1);
    if (!grouped[catKey]) grouped[catKey] = {};
    grouped[catKey][groupName] = Array.isArray(values) ? values : [values];
  });

  const lines = ['TALEKIT STORY PROFILE', '─'.repeat(36)];
  if (childName) lines.push(`Child's name: ${childName}`);
  if (gender)    lines.push(`Child's gender: ${gender}`);

  // Surface child appearance for illustration character anchoring
  const childAppearance = details["Child's own name as the hero"]?.trim();
  if (childAppearance) lines.push(`Child's appearance (for illustrations): ${childAppearance}`);

  lines.push(`Created: ${new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}`);
  lines.push('');

  Object.entries(CAT_LABELS).forEach(([catKey, label]) => {
    if (!grouped[catKey]) return;
    lines.push(label);
    Object.entries(grouped[catKey]).forEach(([groupName, values]) => {
      lines.push(`  ${groupName}: ${values.join(', ')}`);
      values.forEach(val => {
        if (details[val]) lines.push(`    → ${val}: ${details[val]}`);
      });
    });
    lines.push('');
  });

  // Append curriculum alignment block if state + yearLevel are set
  const currBlock = buildCurriculumBlock(state, yearLevel);
  if (currBlock) {
    lines.push('');
    lines.push(currBlock);
  }

  return lines.join('\n').trimEnd();
}

/* ─────────────────────────────────────────────────────────────
   Main export
───────────────────────────────────────────────────────────── */
async function generateStory(profileContent, childName, profileFilename, plan = 'kit', email = null, profileJson = null, narratorVoice = 'au_female') {
  const promptText = (profileJson && buildTextFromJson(profileJson)) || profileContent;
  if (!promptText) throw new Error('No profile content for story generation');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system:     SYSTEM_PROMPT,
      messages: [{
        role:    'user',
        content: `Here is the child's story profile. Please generate a story now.\n\n${promptText}`,
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Anthropic API error ${response.status}`);
  }

  const data    = await response.json();
  const rawText = (data.content || []).map(c => c.text || '').join('');

  let story;
  try {
    const cleaned = rawText.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/```\s*$/,'').trim();
    story = JSON.parse(cleaned);
  } catch {
    throw new Error('Story response could not be parsed as JSON');
  }

  console.log(`[GS-1] Story parsed: "${story.title}" | ${story.illustrations?.length || 0} illustration prompts`);

  const base       = profileFilename.replace('talekits-profile-', 'talekits-story-').replace('.txt', '');
  const outputs    = [];
  const planConfig = PLAN_OUTPUTS[plan] || PLAN_OUTPUTS.kit;
  const saveOpts   = { access: 'public', addRandomSuffix: false };

  if (planConfig.storyTxt) {
    const txt  = buildStoryTxt(story, childName);
    const blob = await put(`stories/${base}.txt`, txt, { ...saveOpts, contentType: 'text/plain' });
    outputs.push({ type: 'story-txt', filename: `${base}.txt`, url: blob.url });
    console.log(`[GS-2] Saved story txt`);
  }

  if (planConfig.illustrationsTxt) {
    const txt  = buildIllustrationsTxt(story, childName);
    const blob = await put(`stories/${base}-illustrations.txt`, txt, { ...saveOpts, contentType: 'text/plain' });
    outputs.push({ type: 'illustrations-txt', filename: `${base}-illustrations.txt`, url: blob.url });
    console.log(`[GS-3] Saved illustrations txt`);
  }

  let pdfBuffer = null;
  if (planConfig.pdf) {
    console.log(`[GS-4] Building story PDF...`);
    pdfBuffer  = await buildPdf(story, childName, plan);
    const blob = await put(`stories/${base}.pdf`, pdfBuffer, { ...saveOpts, contentType: 'application/pdf' });
    outputs.push({ type: 'story-pdf', filename: `${base}.pdf`, url: blob.url });
    console.log(`[GS-4] Saved story PDF`);
  }

  let audioBuffer   = null;
  let audioFilename = null;
  if (planConfig.audio && story.story) {
    try {
      console.log(`[GS-4b] Generating ElevenLabs narration...`);
      const audio = await generateAudio(story.title, story.story, childName, base, narratorVoice);
      audioBuffer   = audio.buffer;
      audioFilename = audio.filename;
      outputs.push({ type: 'audio-mp3', filename: audio.filename, url: audio.url });
      console.log(`[GS-4b] Audio saved: ${audio.filename} (${Math.round(audioBuffer.length / 1024)}KB)`);
    } catch (err) {
      console.error(`[GS-4b] Audio generation failed: ${err.message}`);
    }
  }

  let imageResults = [];
  const hasPageChunks = story.pageChunks?.length > 0;
  const hasIllustrations = story.illustrations?.length > 0;

  if (planConfig.images && (hasPageChunks || hasIllustrations)) {
    try {
      const artStyle    = story.selections?.artStyle || 'soft watercolour with warm pastel tones';
      const styleTag    = artStyle.toLowerCase().replace(/^painted in /i, '');
      const coverPrompt = buildFluxCoverPrompt(story.title, styleTag, story.characterAnchor, story.coverMoment);

      // Extract page illustration prompts — prefer new pageChunks schema
      let pageIllustrations;
      if (hasPageChunks) {
        // New schema: Claude pre-divided into exactly 6 chunks
        pageIllustrations = story.pageChunks
          .slice(0, 6)
          .map(chunk => chunk.illustrationPrompt)
          .filter(Boolean);
      } else {
        // Legacy schema: one prompt per paragraph, capped at 6
        const paragraphCount = (story.story || '').split(/\n\n+/).filter(p => p.trim()).length;
        pageIllustrations = story.illustrations.slice(0, Math.min(paragraphCount, 6));
      }

      const allPrompts = [coverPrompt, ...pageIllustrations];

      const loraUrl = (profileJson?.charCustom && profileJson?.charCustomPhotosUploaded && profileJson?.loraUrl)
        ? profileJson.loraUrl
        : null;

      console.log(`[GS-5] Generating ${allPrompts.length} illustrations (1 cover + ${pageIllustrations.length} pages, schema: ${hasPageChunks ? 'pageChunks' : 'legacy'})${loraUrl ? ' [LoRA]' : ''}...`);
      const allResults = await generateIllustrations(
        allPrompts,
        base,
        artStyle,
        undefined,
        loraUrl,
        story.characterAnchor   // Pass 0: style portrait for IP-Adapter consistency
      );

      // generateIllustrations now returns page: 0 for cover, page: 1..N for story pages
      imageResults = allResults;

      const saved  = allResults.filter(i => i.url);
      const failed = allResults.filter(i => !i.url);
      console.log(`[GS-5] Illustrations done: ${saved.length} saved, ${failed.length} failed`);
      outputs.push({ type: 'illustrations-images', count: saved.length, images: imageResults });
    } catch (err) {
      console.error(`[GS-5] Illustration generation failed: ${err.message}`);
    }
  }

  let pbBuffer = null;
  if (planConfig.picturebook && imageResults.length) {
    try {
      console.log(`[GS-6] Building picture book PDF...`);
      pbBuffer     = await buildPictureBookPdf(story, childName, imageResults);
      const pbBlob = await put(`stories/${base}-picturebook.pdf`, pbBuffer, { ...saveOpts, contentType: 'application/pdf' });
      outputs.push({ type: 'picturebook-pdf', filename: `${base}-picturebook.pdf`, url: pbBlob.url });
      console.log(`[GS-6] Saved picture book PDF`);
    } catch (err) {
      console.error(`[GS-6] Picture book PDF failed: ${err.message}`);
    }
  }

  const storyPdfUrl    = outputs.find(o => o.type === 'story-pdf')?.url      || null;
  const pictureBookUrl = outputs.find(o => o.type === 'picturebook-pdf')?.url || null;
  const audioUrl       = outputs.find(o => o.type === 'audio-mp3')?.url       || null;

  if (email) {
    try {
      if (storyPdfUrl || pictureBookUrl || audioUrl) {
        console.log(`[GS-7] Sending email to ${email} with download links | audio:${!!audioUrl} picturebook:${!!pictureBookUrl}`);
        await sendStoryEmail({
          to:            email,
          childName,
          storyTitle:    story.title,
          parentNote:    story.parentNote,
          plan,
          hasAudio:      !!audioUrl,
          storyPdfUrl,
          pictureBookUrl,
          audioUrl,
        });
        console.log(`[GS-7] Email sent successfully`);
      } else {
        console.warn(`[GS-7] No output URLs available — skipping email`);
      }
    } catch (err) {
      console.error(`[GS-7] Email send failed: ${err.message}`);
    }
  } else {
    console.warn(`[GS-7] No email address — skipping email`);
  }

  // ── Save archive index record ──────────────────────────────
  // This is what populates the Story Archive in the dashboard.
  // Non-fatal if it fails — story delivery is not affected.
  const dateStr = new Date().toISOString().slice(0, 10);
  await saveArchiveIndex({
    email,
    storyId:   base,
    title:     story.title,
    childName,
    plan,
    date:      dateStr,
    files: {
      storyPdf:    storyPdfUrl    || null,
      pictureBook: pictureBookUrl || null,
      audio:       audioUrl       || null,
    },
  });
  // ───────────────────────────────────────────────────────────

  return outputs;
}

module.exports = { generateStory };
