const { put }              = require('@vercel/blob');
const PDFDocument           = require('pdfkit');
const { Resend }            = require('resend');
const { generateIllustrations } = require('./generate-images');

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
   Fonts — pdfkit built-ins only (always available in serverless)
   Times-Roman / Times-Italic / Times-Bold  →  serif body (closest to Lora)
   Helvetica / Helvetica-Bold               →  sans UI (closest to Instrument Sans)
───────────────────────────────────────────────────────────── */
const fonts = {
  body:     'Times-Roman',
  italic:   'Times-Italic',
  bold:     'Times-Bold',
  sans:     'Helvetica',
  sansBold: 'Helvetica-Bold',
};

function ensureFonts() { /* no-op — built-ins need no registration */ }

/* ─────────────────────────────────────────────────────────────
   Plan output rules
───────────────────────────────────────────────────────────── */
const PLAN_OUTPUTS = {
  kit:   { storyTxt: true, illustrationsTxt: false, pdf: true,  images: false, picturebook: false },
  cub:   { storyTxt: true, illustrationsTxt: true,  pdf: true,  images: true,  picturebook: true  },
  scout: { storyTxt: true, illustrationsTxt: true,  pdf: true,  images: false, picturebook: false },
  den:   { storyTxt: true, illustrationsTxt: true,  pdf: true,  images: false, picturebook: false },
  pack:  { storyTxt: true, illustrationsTxt: true,  pdf: true,  images: false, picturebook: false },
};

/* ─────────────────────────────────────────────────────────────
   Claude system prompt
───────────────────────────────────────────────────────────── */
const SYSTEM_PROMPT = `You are a children's storybook author for Talekit, an AI-powered daily personalised storybook service. A fox named Kit is the brand mascot and can appear as a guide or background character when appropriate.

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

═══════════════════════════════════════
SELECTION RULES — follow these exactly
═══════════════════════════════════════
1. AGE SAFETY: Apply the Age Bracket Rails above before writing a single word. If a selected preference conflicts with the age bracket (e.g. complex structure for a 2–3 year old), override the preference to match the age bracket.
2. STORY LENGTH: The profile may contain one or more of "Short", "Medium", or "Long" (relative to the age bracket). If multiple lengths are listed, randomly pick exactly 1 for this story — this ensures variety across daily stories. Map the chosen length to the exact word count target below — never exceed the ceiling for the Age Bracket.
   - Ages 2–3:  Short = ~100 words  |  Medium = ~150 words  |  Long = ~200 words
   - Ages 4–5:  Short = ~200 words  |  Medium = ~275 words  |  Long = ~350 words
   - Ages 6–7:  Short = ~400 words  |  Medium = ~475 words  |  Long = ~550 words
   - Ages 8–10: Short = ~550 words  |  Medium = ~675 words  |  Long = ~800 words
   If no story length is specified, randomly pick one.
3. TONE & MOOD: Pick exactly 1 by genuine random selection. You have a strong bias toward "Gentle & Cosy" — actively fight this. Treat every option as equally likely. Roll a mental dice across all available options and commit to the result even if it surprises you.
4. STORY STRUCTURE: Randomly pick exactly 1. If it conflicts with the Age Bracket, default to the simplest appropriate structure.
5. ART STYLE: Pick exactly 1 by genuine random selection. You have a strong bias toward "Watercolour" — actively fight this. Follow these age and theme rails:
   - Ages 2–3: Prefer bold, simple styles — Hand-drawn crayon, Flat design / bold vector, Paper cut-out collage, Gouache painterly. Avoid complex or dark styles.
   - Ages 4–5: Full range of bright styles — Watercolour, Pixar/Disney 3D CGI-style, Flat design, Gouache painterly, Pencil & ink line art.
   - Ages 6–7: Full range — any style appropriate to the theme.
   - Ages 8–10: Full range including darker atmospheric styles (Dark fairy tale, Noir mystery, Retro 8-bit pixel art).
   - Science / Space / Robot themes: Lean toward Neon pop art, Low-poly geometric, Flat design / bold vector, Retro 8-bit pixel art.
   - Fantasy / Mythical / Enchanted themes: Lean toward Gouache painterly, Vintage golden age, Japanese woodblock print, Soft digital painting.
   - Adventure / Pirates themes: Lean toward Bold graphic novel, Comic book with panels, Vintage golden age.
   - Nature / Animal themes: Lean toward Watercolour, Pencil & ink line art, Oil pastel.
   - Cultural themes: Strongly prefer the matching cultural art style (Indian miniature, Chinese ink wash, African kente-inspired, etc.).
6. PROTAGONIST TYPE: Randomly pick exactly 1.
7. THEMES: Pick 1–3. When picking more than one, strongly prefer thematically correlated combinations (e.g. Mythical Creatures + Enchanted Kingdoms). For Ages 2–3 pick only 1 theme maximum.
8. EDUCATIONAL FOCUS: Pick 1–3 and weave them naturally — never as a lesson. For Ages 2–3 pick only 1.
9. PROTAGONIST PERSONALISATION: Pick exactly 1 related to the protagonist. Then roll a 33% chance — if it triggers, also pick 1 related to other characters.
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
ILLUSTRATION PROMPT RULES — sent directly to DALL-E 3
═══════════════════════════════════════
- Write EXACTLY one illustration prompt per paragraph of the story — no more, no fewer. If the story has 6 paragraphs, write 6 prompts. If it has 10, write 10. This is critical — every page must have an illustration.
- Each prompt must describe the SPECIFIC scene happening in its matching paragraph. Read the paragraph first, then write an illustration that shows exactly what is happening in that paragraph. A reader looking at the illustration should be able to follow the story.
- Each prompt must be a full descriptive paragraph in natural language — no keyword lists, no Midjourney-style parameters.
- Start every prompt with "A children's book illustration of..." to anchor the aesthetic.
- Describe the protagonist consistently in EVERY prompt using the same physical details (species, colour, size, expression) so the character looks the same across all images.
- Describe the scene in full: who is present, where they are, what is happening, lighting, mood, and camera framing.
- For Ages 2–3: always specify large, close-up, simple compositions with bold colours and minimal background detail.
- End every prompt with the art style written as a sentence, e.g. "Painted in soft watercolour with warm pastel tones."
- DALL-E 3 SAFETY: Never use words like scared, frightened, danger, attack, hurt, crying, screaming, dark, shadow, monster, villain, or evil in illustration prompts — even if that moment exists in the story text. Reframe tense or emotional scenes positively. e.g. instead of "a character looking frightened" write "a character with wide curious eyes looking surprised". Instead of "a dark stormy sky" write "a dramatic sky with silver clouds and rays of golden light breaking through". The illustration must always feel warm and safe.
- Always end with: "No text, no speech bubbles, no borders, no watermarks, safe for children."

Respond with a valid JSON object only. No markdown fences, no preamble, nothing else.

{
  "title": "Story title",
  "story": "Full story text. Use \\n\\n to separate paragraphs.",
  "illustrations": ["Full DALL-E 3 prompt for page 1", "Full DALL-E 3 prompt for page 2", "...prompts per age bracket rules"],
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
    `A Talekit story for ${childName}`,
    `Generated: ${date}`,
    '',
    story.story,
    '',
    '─'.repeat(50),
    'PARENT NOTE',
    story.parentNote,
  ].join('\n');
}

function buildIllustrationsTxt(story, childName) {
  const lines = [
    `ILLUSTRATION PROMPTS — ${story.title.toUpperCase()}`,
    '─'.repeat(50),
    `A Talekit story for ${childName}`,
    `Art style: ${story.selections?.artStyle || 'Not specified'}`,
    '',
  ];
  (story.illustrations || []).forEach((p, i) => {
    lines.push(`Page ${i + 1}`);
    lines.push(p);
    lines.push('');
  });
  return lines.join('\n');
}

/* ─────────────────────────────────────────────────────────────
   PDF builder — design-matched to the Talekit webpage
───────────────────────────────────────────────────────────── */
function buildPdf(story, childName, plan) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true });
    const chunks = [];

    doc.on('data',  c   => chunks.push(c));
    doc.on('end',   ()  => resolve(Buffer.concat(chunks)));
    doc.on('error', err => reject(err));

    ensureFonts();

    const PW   = doc.page.width;
    const PH   = doc.page.height;
    const PAD  = 56;          // outer margin
    const W    = PW - PAD * 2;
    const date = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

    /* ── Helper: horizontal rule ── */
    function rule(y, colour = C.border) {
      doc.save().moveTo(PAD, y).lineTo(PW - PAD, y)
         .lineWidth(0.5).strokeColor(colour).stroke().restore();
    }

    /* ── Helper: pill tag (selections page) ── */
    function pill(x, y, label, bg, textCol, borderCol) {
      const MAX_PILL_W = W - (x - PAD) - 10; // never exceed remaining line width
      const fontSize   = 9;
      const padding    = 20; // 10px each side

      // Measure full text width
      let textW = doc.font(fonts.sans).fontSize(fontSize).widthOfString(label);

      // If the pill would overflow the page, truncate with ellipsis
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

      return pillW + 6; // advance x
    }

    /* ── Page 1: Story ── */

    // Warm off-white background
    doc.rect(0, 0, PW, PH).fill(C.bg);

    // Top band — surface colour
    doc.rect(0, 0, PW, 110).fill(C.surface);

    // Eyebrow
    doc.font(fonts.italic).fontSize(10).fillColor(C.text3)
       .text('Talekit  —  Children\'s Storybook', PAD, 28, { width: W, align: 'center' });

    // Title — Lora Italic, large, dark
    doc.font(fonts.italic).fontSize(28).fillColor(C.text)
       .text(story.title, PAD, 46, { width: W, align: 'center', lineGap: 2 });

    // Rule under header
    rule(118, C.border);

    // Sub-header: child name + date
    doc.font(fonts.sans).fontSize(10).fillColor(C.text2)
       .text(`A story for ${childName}`, PAD, 130, { width: W / 2 });
    doc.font(fonts.sans).fontSize(10).fillColor(C.text3)
       .text(date, PAD, 130, { width: W, align: 'right' });

    // Story body
    let y = 158;
    const paragraphs = (story.story || '').split(/\n\n+/).filter(p => p.trim());

    paragraphs.forEach((para, i) => {
      if (y > PH - 100) {
        doc.addPage();
        doc.rect(0, 0, PW, PH).fill(C.bg);
        y = PAD + 20;
      }

      if (i === 0) {
        // Drop cap — first letter in Lora Bold, large
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

    // Parent note — amber card
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

      doc.roundedRect(PAD, y, W, noteH, 10)
         .fill(C.amberBg);
      doc.roundedRect(PAD, y, W, noteH, 10)
         .lineWidth(0.5).strokeColor(C.amberBorder).stroke();

      doc.font(fonts.sansBold).fontSize(9).fillColor(C.amberText)
         .text('PARENT NOTE', PAD + 16, y + 10,
           { characterSpacing: 1, width: W - 32 });

      doc.font(fonts.body).fontSize(11).fillColor(C.amberText).lineGap(4)
         .text(story.parentNote, PAD + 16, y + 24, { width: W - 32 });
    }

    /* ── Page 2: Selections ── */
    doc.addPage();
    doc.rect(0, 0, PW, PH).fill(C.bg);

    // Header band
    doc.rect(0, 0, PW, 90).fill(C.surface);

    doc.font(fonts.italic).fontSize(10).fillColor(C.text3)
       .text('Talekit  —  Story selections', PAD, 24, { width: W, align: 'center' });

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

    /* Selection rows */
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

      // Row label
      doc.font(fonts.sansBold).fontSize(9).fillColor(C.text3)
         .text(row.label.toUpperCase(), PAD, sy, { characterSpacing: 0.8 });
      sy += 14;

      // Value(s) as pills
      const values = Array.isArray(row.value) ? row.value : [row.value];
      let px = PAD;

      values.forEach(v => {
        if (!v) return;
        const textW = doc.font(fonts.sans).fontSize(9).widthOfString(v);
        const pillW = Math.min(textW + 20, W); // cap at usable width

        // Wrap to new line if pill won't fit
        if (px + pillW > PW - PAD && px > PAD) {
          px  = PAD;
          sy += 26;
        }

        px += pill(px, sy, v, row.bg, row.text, row.border);
      });

      sy += 30;
    });

    /* ── Footers on all pages ── */
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);

      // Footer background
      doc.rect(0, PH - 36, PW, 36).fill(C.surface);

      // Footer rule
      doc.moveTo(0, PH - 36).lineTo(PW, PH - 36)
         .lineWidth(0.5).strokeColor(C.border).stroke();

      // Footer text
      doc.font(fonts.sans).fontSize(9).fillColor(C.text3)
         .text(
           `Talekit  ·  ${story.title}  ·  Page ${i + 1} of ${range.count}`,
           PAD, PH - 23,
           { width: W, align: 'center' }
         );
    }

    doc.end();
  });
}

/* ─────────────────────────────────────────────────────────────
   Picture book PDF — landscape, iPad-friendly
   Left half: story text paragraph | Right half: illustration
   A4 Landscape = 841.89 × 595.28 pts
───────────────────────────────────────────────────────────── */
function buildPictureBookPdf(story, childName, imageResults) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 0, size: 'A4', layout: 'landscape', bufferPages: true });
    const chunks = [];

    doc.on('data',  c   => chunks.push(c));
    doc.on('end',   ()  => resolve(Buffer.concat(chunks)));
    doc.on('error', err => reject(err));

    ensureFonts();

    const PW     = doc.page.width;   // 841.89
    const PH     = doc.page.height;  // 595.28
    const HALF   = PW / 2;
    const PAD    = 44;
    const FOOTER = 32;
    const date   = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

    // Build a map of page number → image buffer (fetch all images upfront)
    const imageMap = {};
    (imageResults || []).forEach(img => {
      if (img.url && img.page) imageMap[img.page] = img.url;
    });

    // Split story into paragraphs — one paragraph per spread
    const paragraphs = (story.story || '').split(/\n\n+/).filter(p => p.trim());

    /* ── Helper: draw one spread ── */
    async function drawSpread(paraIndex, para, isFirst, pageIndex, totalPages) {
      // Background
      doc.rect(0, 0, PW, PH).fill(C.bg);

      // Vertical divider between halves
      doc.moveTo(HALF, PAD).lineTo(HALF, PH - FOOTER - PAD)
         .lineWidth(0.5).strokeColor(C.border).stroke();

      // ── LEFT HALF: text ──
      const textX = PAD;
      const textW = HALF - PAD * 2;
      let   ty    = PAD + 16;

      if (isFirst) {
        // Eyebrow
        doc.font(fonts.sans).fontSize(9).fillColor(C.text3)
           .text('Talekit  —  Children\'s Storybook', textX, ty, { width: textW, align: 'center' });
        ty += 16;

        // Title
        doc.font(fonts.italic).fontSize(20).fillColor(C.text).lineGap(3)
           .text(story.title, textX, ty, { width: textW, align: 'center' });
        ty = doc.y + 10;

        // Rule
        doc.moveTo(textX, ty).lineTo(HALF - PAD, ty)
           .lineWidth(0.5).strokeColor(C.border).stroke();
        ty += 14;

        // Child + date
        doc.font(fonts.sans).fontSize(9).fillColor(C.text2)
           .text(`A story for ${childName}`, textX, ty, { width: textW / 2 });
        doc.font(fonts.sans).fontSize(9).fillColor(C.text3)
           .text(date, textX, ty, { width: textW, align: 'right' });
        ty += 20;
      } else {
        // Page number top-left
        doc.font(fonts.sans).fontSize(9).fillColor(C.text3)
           .text(`${pageIndex}`, textX, ty, { width: textW });
        ty += 20;
      }

      // ── Dynamic font size based on paragraph length ──
      // Short paragraphs get larger text so the page feels full, not empty
      const wordCount  = (para || '').split(/\s+/).filter(Boolean).length;
      const bodySize   = wordCount <= 15  ? 22
                       : wordCount <= 25  ? 18
                       : wordCount <= 40  ? 15
                       : wordCount <= 60  ? 13
                       : 12;
      const lineGapVal = bodySize >= 18 ? 8 : bodySize >= 15 ? 6 : 5;

      // Vertically centre text for very short paragraphs
      const textAreaH  = PH - FOOTER - PAD * 2 - (isFirst ? 80 : 36);
      const textHeight = doc.font(fonts.body).fontSize(bodySize).heightOfString(para || '', { width: textW, lineGap: lineGapVal });
      if (!isFirst && textHeight < textAreaH * 0.5) {
        ty += Math.floor((textAreaH - textHeight) / 2);
      }

      if (isFirst && para) {
        // Drop cap — scale with body size
        const letter  = para.charAt(0);
        const rest    = para.slice(1);
        const capSize = Math.max(bodySize * 2.2, 38);
        doc.font(fonts.bold).fontSize(capSize).fillColor(C.text)
           .text(letter, textX, ty - 4, { lineBreak: false });
        const capW = doc.font(fonts.bold).fontSize(capSize).widthOfString(letter) + 5;
        doc.font(fonts.body).fontSize(bodySize).fillColor(C.text).lineGap(lineGapVal)
           .text(rest, textX + capW, ty + Math.floor(capSize * 0.3), { width: textW - capW });
      } else if (para) {
        doc.font(fonts.body).fontSize(bodySize).fillColor(C.text).lineGap(lineGapVal)
           .text(para, textX, ty, { width: textW });
      }

      // ── RIGHT HALF: illustration ──
      const imgX   = HALF + PAD;
      const imgY   = PAD;
      const imgW   = HALF - PAD * 2;
      const imgH   = PH - FOOTER - PAD * 2;

      const imgUrl = imageMap[paraIndex + 1]; // images are 1-indexed

      if (imgUrl) {
        try {
          // Fetch image buffer
          const imgRes = await fetch(imgUrl);
          if (imgRes.ok) {
            const imgBuf = Buffer.from(await imgRes.arrayBuffer());
            doc.image(imgBuf, imgX, imgY, {
              width:  imgW,
              height: imgH,
              fit:    [imgW, imgH],
              align:  'center',
              valign: 'center',
            });
          } else {
            drawImagePlaceholder(imgX, imgY, imgW, imgH, paraIndex + 1);
          }
        } catch {
          drawImagePlaceholder(imgX, imgY, imgW, imgH, paraIndex + 1);
        }
      } else {
        drawImagePlaceholder(imgX, imgY, imgW, imgH, paraIndex + 1);
      }
    }

    /* ── Helper: placeholder when image is missing ── */
    function drawImagePlaceholder(x, y, w, h, pageNum) {
      doc.roundedRect(x, y, w, h, 10)
         .fill(C.surface);
      doc.roundedRect(x, y, w, h, 10)
         .lineWidth(0.5).strokeColor(C.border).stroke();
      doc.font(fonts.sans).fontSize(10).fillColor(C.text3)
         .text(`Illustration ${pageNum}`, x, y + h / 2 - 8, { width: w, align: 'center' });
    }

    /* ── Helper: cover page ── */
    function drawCover() {
      doc.rect(0, 0, PW, PH).fill(C.surface);

      // Decorative border
      doc.roundedRect(20, 20, PW - 40, PH - 40, 14)
         .lineWidth(1).strokeColor(C.border).stroke();

      // Eyebrow
      doc.font(fonts.sans).fontSize(10).fillColor(C.text3)
         .text('Talekit  —  Children\'s Storybook', PAD, PH / 2 - 70, { width: PW - PAD * 2, align: 'center' });

      // Title
      doc.font(fonts.italic).fontSize(34).fillColor(C.text).lineGap(6)
         .text(story.title, PAD, PH / 2 - 50, { width: PW - PAD * 2, align: 'center' });

      const titleBottom = doc.y + 16;

      // Rule
      const ruleW = 120;
      doc.moveTo((PW - ruleW) / 2, titleBottom)
         .lineTo((PW + ruleW) / 2, titleBottom)
         .lineWidth(0.5).strokeColor(C.border).stroke();

      // Child name
      doc.font(fonts.sans).fontSize(12).fillColor(C.text2)
         .text(`A story for ${childName}`, PAD, titleBottom + 14, { width: PW - PAD * 2, align: 'center' });

      // Date bottom right
      doc.font(fonts.sans).fontSize(9).fillColor(C.text3)
         .text(date, PAD, PH - 48, { width: PW - PAD * 2, align: 'right' });
    }

    /* ── Helper: final page with parent note + selections summary ── */
    function drawEndPage() {
      doc.addPage();
      doc.rect(0, 0, PW, PH).fill(C.bg);

      // Left half — parent note
      const lx = PAD;
      const lw = HALF - PAD * 2;
      let   ly = PAD + 16;

      doc.font(fonts.italic).fontSize(16).fillColor(C.text)
         .text('A note for', lx, ly, { width: lw });
      ly = doc.y;
      doc.font(fonts.italic).fontSize(16).fillColor(C.text2)
         .text('parents', lx, ly, { width: lw });
      ly = doc.y + 16;

      doc.moveTo(lx, ly).lineTo(HALF - PAD, ly)
         .lineWidth(0.5).strokeColor(C.border).stroke();
      ly += 16;

      // Amber card
      const noteH = doc.font(fonts.body).fontSize(11).heightOfString(story.parentNote || '', { width: lw - 32 }) + 36;
      doc.roundedRect(lx, ly, lw, noteH, 10).fill(C.amberBg);
      doc.roundedRect(lx, ly, lw, noteH, 10).lineWidth(0.5).strokeColor(C.amberBorder).stroke();
      doc.font(fonts.sansBold).fontSize(9).fillColor(C.amberText)
         .text('PARENT NOTE', lx + 16, ly + 10, { characterSpacing: 1, width: lw - 32 });
      doc.font(fonts.body).fontSize(11).fillColor(C.amberText).lineGap(4)
         .text(story.parentNote || '', lx + 16, ly + 26, { width: lw - 32 });

      // Right half — Kit's picks summary
      const rx = HALF + PAD;
      const rw = HALF - PAD * 2;

      doc.moveTo(HALF, PAD).lineTo(HALF, PH - FOOTER - PAD)
         .lineWidth(0.5).strokeColor(C.border).stroke();

      doc.font(fonts.italic).fontSize(16).fillColor(C.text)
         .text('What Kit', rx, PAD + 16, { width: rw });
      doc.font(fonts.italic).fontSize(16).fillColor(C.text2)
         .text('picked', rx, doc.y, { width: rw });

      const sel = story.selections || {};
      let ry    = doc.y + 20;

      const rows = [
        { label: 'Themes',    value: sel.themes,          bg: C.purpleBg, text: C.purpleText, border: C.purpleBorder },
        { label: 'Art style', value: sel.artStyle,         bg: C.tealBg,   text: C.tealText,   border: C.tealBorder   },
        { label: 'Focus',     value: sel.educationalFocus, bg: C.amberBg,  text: C.amberText,  border: C.amberBorder  },
        { label: 'Tone',      value: sel.tone,             bg: C.blueBg,   text: C.blueText,   border: C.blueBorder   },
      ];

      rows.forEach(row => {
        if (!row.value || (Array.isArray(row.value) && !row.value.length)) return;
        if (ry > PH - FOOTER - 40) return;

        doc.font(fonts.sansBold).fontSize(8).fillColor(C.text3)
           .text(row.label.toUpperCase(), rx, ry, { characterSpacing: 0.8 });
        ry += 13;

        const vals = Array.isArray(row.value) ? row.value : [row.value];
        let   px   = rx;

        vals.forEach(v => {
          if (!v) return;
          const tw   = doc.font(fonts.sans).fontSize(9).widthOfString(v);
          const pw   = tw + 20;
          if (px + pw > PW - PAD) { px = rx; ry += 22; }

          doc.roundedRect(px, ry, pw, 18, 9).fill(row.bg);
          doc.roundedRect(px, ry, pw, 18, 9).lineWidth(0.5).strokeColor(row.border).stroke();
          doc.font(fonts.sans).fontSize(9).fillColor(row.text)
             .text(v, px + 10, ry + 4, { width: tw, lineBreak: false });

          px += pw + 5;
        });
        ry += 28;
      });
    }

    /* ── Build the PDF asynchronously ── */
    (async () => {
      try {
        // Cover
        drawCover();

        // One spread per paragraph
        for (let i = 0; i < paragraphs.length; i++) {
          doc.addPage();
          await drawSpread(i, paragraphs[i], i === 0, i + 1, paragraphs.length);
        }

        // End page
        drawEndPage();

        /* ── Footers on all pages except cover ── */
        const range = doc.bufferedPageRange();
        for (let i = 1; i < range.count; i++) {
          doc.switchToPage(range.start + i);
          doc.rect(0, PH - FOOTER, PW, FOOTER).fill(C.surface);
          doc.moveTo(0, PH - FOOTER).lineTo(PW, PH - FOOTER)
             .lineWidth(0.5).strokeColor(C.border).stroke();
          doc.font(fonts.sans).fontSize(9).fillColor(C.text3)
             .text(
               `Talekit  ·  ${story.title}  ·  Page ${i} of ${range.count - 1}`,
               PAD, PH - FOOTER + 11,
               { width: PW - PAD * 2, align: 'center' }
             );
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    })();
  });
}

/* ─────────────────────────────────────────────────────────────
   Email — Kit free trial delivery
───────────────────────────────────────────────────────────── */
function buildEmailHtml(childName, storyTitle, parentNote, plan = 'kit', planLabel = 'free trial') {
  const isPaid    = plan !== 'kit';
  const heading   = `I wrote ${childName} a story`;
  const intro     = isPaid
    ? `Hi! I'm Kit — the fox behind every Talekit story. I've just finished writing and illustrating today's story for <strong>${childName}</strong>, and I'm so excited to share it.`
    : `Hi! I'm Kit — the fox behind every Talekit story. I've just finished writing <strong>${childName}'s</strong> very first story, and I can't wait for them to read it.`;
  const attachMsg = isPaid
    ? `I've attached two things — the full story PDF for reading aloud, and the illustrated picture book that brings every scene to life. Open the picture book on a tablet or iPad for the best experience.`
    : `I've attached the full story as a PDF. Find a cosy spot together, open it up, and enjoy.`;
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
  const sign      = isPaid
    ? `I'll have another story ready for ${childName} tomorrow.<br/><br/><em>— Kit 🦊</em>`
    : `I hope ${childName} loves it.<br/><br/><em>— Kit 🦊</em>`;
  const footerNote = isPaid
    ? `Kit writes a new story for ${childName} every day on the Talekit ${planLabel} plan.`
    : `You received this because you signed up for a Talekit free trial.`;

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
            <p style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9C9A94;">
              Kit — Talekit Storywriter
            </p>
            <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:26px;font-weight:400;color:#1C1B18;line-height:1.25;">
              ${heading}
            </h1>
          </td>
        </tr>

        <tr>
          <td style="background:#FFFFFF;padding:36px 40px;">

            <p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1C1B18;line-height:1.7;">
              ${intro}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0;">
              <tr>
                <td style="background:#EEEDFE;border:0.5px solid #AFA9EC;border-radius:10px;padding:20px 24px;">
                  <p style="margin:0 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#9C9A94;">Today's story</p>
                  <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:20px;color:#3C3489;line-height:1.3;">${storyTitle}</p>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1C1B18;line-height:1.7;">
              ${attachMsg}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0;">
              <tr>
                <td style="background:#FAEEDA;border:0.5px solid #EF9F27;border-radius:10px;padding:16px 20px;">
                  <p style="margin:0 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:#633806;">A note for parents</p>
                  <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#633806;line-height:1.6;">${parentNote}</p>
                </td>
              </tr>
            </table>

            ${footerCta}

            <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#1C1B18;line-height:1.8;">
              ${sign}
            </p>

          </td>
        </tr>

        <tr>
          <td style="background:#F3F2EE;border-radius:0 0 14px 14px;padding:24px 40px;border-top:1px solid #E0DED8;text-align:center;">
            <p style="margin:0 0 6px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#9C9A94;line-height:1.6;">${footerNote}</p>
            <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:13px;color:#6B6860;">Talekit — a new story, every day</p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function buildEmailText(childName, storyTitle, parentNote, plan = 'kit', planLabel = 'free trial') {
  const isPaid   = plan !== 'kit';
  const attachMsg = isPaid
    ? `Two files are attached — the full story PDF and your illustrated picture book. Open the picture book on a tablet for the full illustrated experience.`
    : `The full story is attached as a PDF. Find a cosy spot and enjoy reading it together.`;
  const closing  = isPaid
    ? `You're on the Talekit ${planLabel} plan. A new story arrives every day — each one unique, always made just for ${childName}.`
    : `You're on a 7-day free trial. Visit ${process.env.NEXT_PUBLIC_BASE_URL || 'https://talekits.vercel.app'} to choose a plan and keep the stories coming.`;

  return `${childName}'s Talekit story is ready

─────────────────────────────────────
Today's story: ${storyTitle}
─────────────────────────────────────

Hi there,

${isPaid ? `Kit the fox has just written ${childName} a brand-new personalised story.` : `We've just written ${childName} their very first Talekit story.`}

${attachMsg}

PARENT NOTE
${parentNote}

${closing}

─────────────────────────────────────
Talekit — a new story, every day`;
}

async function sendStoryEmail({ to, childName, storyTitle, parentNote, plan, attachments }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping email');
    return;
  }
  if (!to) {
    console.warn('No email address — skipping email');
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  const isPaid    = plan !== 'kit';
  const planLabel = { kit: 'free trial', cub: 'Cub', scout: 'Scout', den: 'Den', pack: 'Pack' }[plan] || plan;

  const { data, error } = await resend.emails.send({
    from:    'Kit from Talekit <kit@talekits.com>',
    to:      [to],
    subject: `${storyTitle} — ${childName}'s ${isPaid ? 'first' : 'first'} Talekit story`,
    html:    buildEmailHtml(childName, storyTitle, parentNote, plan, planLabel),
    text:    buildEmailText(childName, storyTitle, parentNote, plan, planLabel),
    attachments,
  });

  if (error) {
    console.error('Resend error:', error);
    throw new Error(`Email failed: ${error.message}`);
  }

  console.log(`Email sent to ${to} | Plan: ${plan} | Attachments: ${attachments.length} | ID: ${data?.id}`);
}

async function sendPictureBookEmail({ to, childName, storyTitle, plan, pbBuffer, pbFilename }) {
  if (!process.env.RESEND_API_KEY || !to) return;

  const planLabel = { cub: 'Cub', scout: 'Scout', den: 'Den', pack: 'Pack' }[plan] || plan;
  const resend    = new Resend(process.env.RESEND_API_KEY);

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#FAFAF8;font-family:Georgia,'Times New Roman',serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#FAFAF8;">
  <tr><td align="center" style="padding:40px 16px;">
    <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">
      <tr><td style="background:#F3F2EE;border-radius:14px 14px 0 0;padding:32px 40px 24px;text-align:center;border-bottom:1px solid #E0DED8;">
        <p style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9C9A94;">Talekit — Picture Book</p>
        <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:26px;font-weight:400;color:#1C1B18;line-height:1.25;">
          ${childName}'s illustrated<br/>picture book is <em style="color:#6B6860;">ready</em>
        </h1>
      </td></tr>
      <tr><td style="background:#FFFFFF;padding:36px 40px;">
        <p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#6B6860;line-height:1.7;">Hi there,</p>
        <p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1C1B18;line-height:1.7;">
          Kit has finished illustrating <strong>${storyTitle}</strong>. The full picture book is attached — open it on a tablet or iPad in landscape mode for the best reading experience.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0;">
          <tr><td style="background:#E1F5EE;border:0.5px solid #5DCAA5;border-radius:10px;padding:16px 20px;">
            <p style="margin:0 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:#085041;">Picture book tip</p>
            <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#085041;line-height:1.6;">
              Each spread shows the story text on the left and the illustration on the right — just like a real picture book. Works beautifully on iPad, tablet, or printed at home.
            </p>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="background:#F3F2EE;border-radius:0 0 14px 14px;padding:24px 40px;border-top:1px solid #E0DED8;text-align:center;">
        <p style="margin:0 0 6px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#9C9A94;line-height:1.6;">You're on the Talekit ${planLabel} plan. A new story arrives every day.</p>
        <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:13px;color:#6B6860;">Talekit — a new story, every day</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const { error } = await resend.emails.send({
    from:    'Kit from Talekit <kit@talekits.com>',
    to:      [to],
    subject: `${storyTitle} — ${childName}'s illustrated picture book is ready`,
    html,
    text:    `${childName}'s illustrated picture book is ready\n\nKit has finished illustrating "${storyTitle}". The picture book PDF is attached — open it on a tablet in landscape mode for the best experience.\n\nTalekit — a new story, every day`,
    attachments: [{
      filename: pbFilename,
      content:  pbBuffer.toString('base64'),
    }],
  });

  if (error) throw new Error(`Picture book email failed: ${error.message}`);
}

/* ─────────────────────────────────────────────────────────────
   Main export
───────────────────────────────────────────────────────────── */
async function generateStory(profileContent, childName, profileFilename, plan = 'kit', email = null) {
  // Call Claude
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':        'application/json',
      'x-api-key':           process.env.ANTHROPIC_API_KEY,
      'anthropic-version':   '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system:     SYSTEM_PROMPT,
      messages: [{
        role:    'user',
        content: `Here is the child's story profile. Please generate a story now.\n\n${profileContent}`,
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
    pdfBuffer      = await buildPdf(story, childName, plan);
    const blob     = await put(`stories/${base}.pdf`, pdfBuffer, { ...saveOpts, contentType: 'application/pdf' });
    outputs.push({ type: 'story-pdf', filename: `${base}.pdf`, url: blob.url });
    console.log(`[GS-4] Saved story PDF`);
  }

  // Generate illustrations for plans with images enabled
  let imageResults = [];
  if (planConfig.images && story.illustrations?.length) {
    try {
      console.log(`[GS-5] Generating ${story.illustrations.length} DALL-E 3 illustrations...`);
      imageResults = await generateIllustrations(
        story.illustrations,
        base,
        story.selections?.artStyle || 'children\'s book illustration'
      );
      const saved  = imageResults.filter(i => i.url);
      const failed = imageResults.filter(i => !i.url);
      console.log(`[GS-5] Illustrations done: ${saved.length} saved, ${failed.length} failed`);
      outputs.push({ type: 'illustrations-images', count: saved.length, images: imageResults });
    } catch (err) {
      console.error(`[GS-5] Illustration generation failed: ${err.message}`);
    }
  }

  // Build picture book PDF once images are ready
  let pbBuffer = null;
  if (planConfig.picturebook && imageResults.length) {
    try {
      console.log(`[GS-6] Building picture book PDF...`);
      pbBuffer       = await buildPictureBookPdf(story, childName, imageResults);
      const pbBlob   = await put(`stories/${base}-picturebook.pdf`, pbBuffer, { ...saveOpts, contentType: 'application/pdf' });
      outputs.push({ type: 'picturebook-pdf', filename: `${base}-picturebook.pdf`, url: pbBlob.url });
      console.log(`[GS-6] Saved picture book PDF`);
    } catch (err) {
      console.error(`[GS-6] Picture book PDF failed: ${err.message}`);
    }
  }

  // Send single combined email once all PDFs are ready
  if (email) {
    try {
      const attachments = [];

      if (pdfBuffer) {
        attachments.push({
          filename: `${base}.pdf`,
          content:  pdfBuffer.toString('base64'),
        });
      }

      if (pbBuffer) {
        attachments.push({
          filename: `${base}-picturebook.pdf`,
          content:  pbBuffer.toString('base64'),
        });
      }

      if (attachments.length) {
        console.log(`[GS-7] Sending email to ${email} with ${attachments.length} attachment(s)...`);
        await sendStoryEmail({
          to:         email,
          childName,
          storyTitle: story.title,
          parentNote: story.parentNote,
          plan,
          attachments,
        });
        console.log(`[GS-7] Email sent successfully`);
      } else {
        console.warn(`[GS-7] No attachments to send — skipping email`);
      }
    } catch (err) {
      console.error(`[GS-7] Email send failed: ${err.message}`);
    }
  } else {
    console.warn(`[GS-7] No email address — skipping email`);
  }

  return outputs;
}

module.exports = { generateStory };
