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

SELECTION RULES — follow these exactly:
1. AGE SAFETY: All content, vocabulary, themes, and concepts must strictly match the Age Bracket. This is non-negotiable.
2. STORY LENGTH: Randomly pick exactly 1 from the available options.
3. TONE & MOOD: Randomly pick exactly 1.
4. STORY STRUCTURE: Randomly pick exactly 1.
5. ART STYLE: Randomly pick exactly 1 (used for illustration prompts).
6. PROTAGONIST TYPE: Randomly pick exactly 1.
7. THEMES: Pick 1-3. When picking more than one, strongly prefer thematically correlated combinations (e.g. Mythical Creatures + Enchanted Kingdoms, or Ocean Creatures + Underwater Realms).
8. EDUCATIONAL FOCUS: Pick 1-3 and weave them naturally into the story — never as a lesson, always as part of the narrative.
9. PROTAGONIST PERSONALISATION: Pick exactly 1 related to the protagonist. Then roll a 33% chance — if it triggers, also pick 1 related to other characters.
10. CULTURAL REPRESENTATION: Roll a 30% chance. If triggered, pick 1 and weave naturally.
11. RECURRING ELEMENT: Roll a 33% chance. If triggered, pick 1 and note it in selections — this element must persist across the next 3 stories for this child.

STORY WRITING RULES:
- Write in flowing paragraphs separated by blank lines. No headings or bullet points inside the story.
- Weave the child's name naturally as the protagonist.
- Match vocabulary and sentence complexity to the Age Bracket and Reading Level.
- Educational Focus must feel like part of the story, never a moral tacked on at the end.
- End on a warm, satisfying note.

ILLUSTRATION PROMPT RULES — these prompts are sent directly to DALL-E 3:
- Write 8-10 prompts, one per page spread.
- Each prompt must be a full descriptive paragraph in natural language — no keyword lists, no Midjourney-style parameters.
- Start every prompt with "A children's book illustration of..." to anchor the aesthetic.
- Describe the protagonist consistently in EVERY prompt using the same physical details (species, colour, size, expression) so the character looks the same across all images.
- Describe the scene in full: who is present, where they are, what is happening, lighting, mood, and camera framing.
- End every prompt with the art style written as a sentence, e.g. "Painted in soft watercolour with warm pastel tones." — never as a keyword.
- Always end with: "No text, no speech bubbles, no borders, no watermarks, safe for children."
- Example of a correct prompt: "A children's book illustration of a small red fox named Kit with bright amber eyes and a bushy white-tipped tail, standing at the entrance to a glowing underground burrow carved from the roots of an ancient oak tree. Warm golden lantern light spills out from the doorway, casting long soft shadows on the mossy forest floor. Kit looks back over his shoulder with a curious, excited expression. Wide landscape composition. Painted in soft watercolour with warm pastel tones, reminiscent of classic picture book illustration. No text, no speech bubbles, no borders, no watermarks, safe for children."

Respond with a valid JSON object only. No markdown fences, no preamble, nothing else.

{
  "title": "Story title",
  "story": "Full story text. Use \\n\\n to separate paragraphs.",
  "illustrations": ["Full DALL-E 3 prompt for page 1", "Full DALL-E 3 prompt for page 2", "...8 to 10 prompts"],
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
      const textW = doc.font(fonts.sans).fontSize(9).widthOfString(label);
      const pillW = textW + 20;
      const pillH = 18;
      const r     = pillH / 2;

      doc.save()
         .roundedRect(x, y, pillW, pillH, r)
         .fillColor(bg).fill()
         .roundedRect(x, y, pillW, pillH, r)
         .lineWidth(0.5).strokeColor(borderCol).stroke()
         .font(fonts.sans).fontSize(9).fillColor(textCol)
         .text(label, x + 10, y + 4, { width: textW, lineBreak: false })
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
        const pillW = textW + 20;

        if (px + pillW > PW - PAD) {
          px  = PAD;
          sy += 24;
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

      // Paragraph text
      const bodySize = 13;
      if (isFirst && para) {
        // Drop cap
        const letter  = para.charAt(0);
        const rest    = para.slice(1);
        const capSize = 42;
        doc.font(fonts.bold).fontSize(capSize).fillColor(C.text)
           .text(letter, textX, ty - 4, { lineBreak: false });
        const capW = doc.font(fonts.bold).fontSize(capSize).widthOfString(letter) + 5;
        doc.font(fonts.body).fontSize(bodySize).fillColor(C.text).lineGap(5)
           .text(rest, textX + capW, ty + 6, { width: textW - capW });
      } else if (para) {
        doc.font(fonts.body).fontSize(bodySize).fillColor(C.text).lineGap(6)
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
function buildEmailHtml(childName, storyTitle, parentNote, trialDaysLeft = 7) {
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

        <!-- Header -->
        <tr>
          <td style="background:#F3F2EE;border-radius:14px 14px 0 0;padding:32px 40px 24px;text-align:center;border-bottom:1px solid #E0DED8;">
            <p style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9C9A94;">
              Talekit — Children's Storybook
            </p>
            <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:26px;font-weight:400;color:#1C1B18;line-height:1.25;">
              ${childName}'s first story<br/>is <em style="color:#6B6860;">ready</em>
            </h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#FFFFFF;padding:36px 40px;">

            <p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#6B6860;line-height:1.7;">
              Hi there,
            </p>

            <p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1C1B18;line-height:1.7;">
              We've just written <strong>${childName}</strong> their very first Talekit story — and we think they're going to love it.
            </p>

            <!-- Story title card -->
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0;">
              <tr>
                <td style="background:#EEEDFE;border:0.5px solid #AFA9EC;border-radius:10px;padding:20px 24px;">
                  <p style="margin:0 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#9C9A94;">
                    Today's story
                  </p>
                  <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:20px;color:#3C3489;line-height:1.3;">
                    ${storyTitle}
                  </p>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1C1B18;line-height:1.7;">
              The full story is attached to this email as a PDF — designed to be read together at bedtime, on the weekend, or whenever the moment feels right. Open it up, find a cosy spot, and enjoy.
            </p>

            <!-- Parent note -->
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0;">
              <tr>
                <td style="background:#FAEEDA;border:0.5px solid #EF9F27;border-radius:10px;padding:16px 20px;">
                  <p style="margin:0 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:#633806;">
                    Parent note
                  </p>
                  <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#633806;line-height:1.6;">
                    ${parentNote}
                  </p>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1C1B18;line-height:1.7;">
              You're currently on your <strong>${trialDaysLeft}-day free trial</strong>. Every day a brand-new story lands — each one personalised, never repeated, always made just for ${childName}.
            </p>

            <p style="margin:0 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1C1B18;line-height:1.7;">
              When you're ready to keep the stories coming, choosing a plan takes less than a minute.
            </p>

            <!-- CTA -->
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td align="center">
                  <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'https://talekits.vercel.app'}"
                     style="display:inline-block;background:#1C1B18;color:#FAFAF8;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:15px;font-weight:400;text-decoration:none;padding:12px 32px;border-radius:999px;">
                    Explore your plan options
                  </a>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F3F2EE;border-radius:0 0 14px 14px;padding:24px 40px;border-top:1px solid #E0DED8;text-align:center;">
            <p style="margin:0 0 6px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#9C9A94;line-height:1.6;">
              You received this because you signed up for a Talekit free trial.
            </p>
            <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:13px;color:#6B6860;">
              Talekit — a new story, every day
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function buildEmailText(childName, storyTitle, parentNote, trialDaysLeft = 7) {
  return `${childName}'s first Talekit story is ready

─────────────────────────────────────
Today's story: ${storyTitle}
─────────────────────────────────────

Hi there,

We've just written ${childName} their very first Talekit story — and we think they're going to love it.

The full story is attached to this email as a PDF. Find a cosy spot, open it up, and enjoy reading it together.

PARENT NOTE
${parentNote}

You're currently on your ${trialDaysLeft}-day free trial. Every day a brand-new story lands — each one personalised, never repeated, always made just for ${childName}.

When you're ready to keep the stories coming, visit ${process.env.NEXT_PUBLIC_BASE_URL || 'https://talekits.vercel.app'} to choose your plan.

─────────────────────────────────────
Talekit — a new story, every day
You received this because you signed up for a free trial.`;
}

async function sendStoryEmail({ to, childName, storyTitle, parentNote, pdfBuffer, pdfFilename }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping email');
    return;
  }
  if (!to) {
    console.warn('No email address — skipping email');
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  const { data, error } = await resend.emails.send({
    from:    'Talekit <onboarding@resend.dev>',
    to:      [to],
    subject: `${storyTitle} — ${childName}'s first Talekit story`,
    html:    buildEmailHtml(childName, storyTitle, parentNote),
    text:    buildEmailText(childName, storyTitle, parentNote),
    attachments: [
      {
        filename: pdfFilename,
        content:  pdfBuffer.toString('base64'),
      },
    ],
  });

  if (error) {
    console.error('Resend error:', error);
    throw new Error(`Email failed: ${error.message}`);
  }

  console.log(`Email sent to ${to} | ID: ${data?.id}`);
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

  const base       = profileFilename.replace('talekits-profile-', 'talekits-story-').replace('.txt', '');
  const outputs    = [];
  const planConfig = PLAN_OUTPUTS[plan] || PLAN_OUTPUTS.kit;
  const saveOpts   = { access: 'public', addRandomSuffix: false };

  if (planConfig.storyTxt) {
    const txt  = buildStoryTxt(story, childName);
    const blob = await put(`stories/${base}.txt`, txt, { ...saveOpts, contentType: 'text/plain' });
    outputs.push({ type: 'story-txt', filename: `${base}.txt`, url: blob.url });
    console.log(`Saved: ${base}.txt`);
  }

  if (planConfig.illustrationsTxt) {
    const txt  = buildIllustrationsTxt(story, childName);
    const blob = await put(`stories/${base}-illustrations.txt`, txt, { ...saveOpts, contentType: 'text/plain' });
    outputs.push({ type: 'illustrations-txt', filename: `${base}-illustrations.txt`, url: blob.url });
    console.log(`Saved: ${base}-illustrations.txt`);
  }

  let pdfBuffer = null;
  if (planConfig.pdf) {
    pdfBuffer      = await buildPdf(story, childName, plan);
    const blob     = await put(`stories/${base}.pdf`, pdfBuffer, { ...saveOpts, contentType: 'application/pdf' });
    outputs.push({ type: 'story-pdf', filename: `${base}.pdf`, url: blob.url });
    console.log(`Saved: ${base}.pdf`);
  }

  // Generate illustrations for plans with images enabled
  let imageResults = [];
  if (planConfig.images && story.illustrations?.length) {
    try {
      console.log(`Generating ${story.illustrations.length} illustrations for: ${childName}`);
      imageResults = await generateIllustrations(
        story.illustrations,
        base,
        story.selections?.artStyle || 'children\'s book illustration'
      );
      const saved  = imageResults.filter(i => i.url);
      const failed = imageResults.filter(i => !i.url);
      console.log(`Illustrations: ${saved.length} saved, ${failed.length} failed`);
      outputs.push({ type: 'illustrations-images', count: saved.length, images: imageResults });
    } catch (err) {
      console.error('Illustration generation failed:', err.message);
    }
  }

  // Build picture book PDF (landscape, iPad-friendly) once images are ready
  if (planConfig.picturebook && imageResults.length) {
    try {
      console.log(`Building picture book PDF for: ${childName}`);
      const pbBuffer = await buildPictureBookPdf(story, childName, imageResults);
      const pbBlob   = await put(`stories/${base}-picturebook.pdf`, pbBuffer, { ...saveOpts, contentType: 'application/pdf' });
      outputs.push({ type: 'picturebook-pdf', filename: `${base}-picturebook.pdf`, url: pbBlob.url });
      console.log(`Saved: ${base}-picturebook.pdf`);
    } catch (err) {
      console.error('Picture book PDF failed:', err.message);
    }
  }

  // Send story by email for Kit (free trial) — PDF attached
  if (plan === 'kit' && pdfBuffer && email) {
    try {
      await sendStoryEmail({
        to:          email,
        childName,
        storyTitle:  story.title,
        parentNote:  story.parentNote,
        pdfBuffer,
        pdfFilename: `${base}.pdf`,
      });
    } catch (err) {
      // Log but don't throw — a failed email shouldn't fail the whole generation
      console.error('Email send failed:', err.message);
    }
  }

  return outputs;
}

module.exports = { generateStory };
