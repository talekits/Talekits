const { put }     = require('@vercel/blob');
const PDFDocument  = require('pdfkit');
const path         = require('path');
const fs           = require('fs');
const { Resend }   = require('resend');

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

  // Category colours
  purpleBg:    '#EEEDFE', purpleText:  '#3C3489', purpleBorder: '#AFA9EC',
  tealBg:      '#E1F5EE', tealText:    '#085041', tealBorder:   '#5DCAA5',
  amberBg:     '#FAEEDA', amberText:   '#633806', amberBorder:  '#EF9F27',
  blueBg:      '#E6F1FB', blueText:    '#0C447C', blueBorder:   '#85B7EB',
  greenBg:     '#EAF3DE', greenText:   '#27500A', greenBorder:  '#97C459',
};

/* ─────────────────────────────────────────────────────────────
   Plan output rules
───────────────────────────────────────────────────────────── */
const PLAN_OUTPUTS = {
  kit:   { storyTxt: true, illustrationsTxt: false, pdf: true },
  cub:   { storyTxt: true, illustrationsTxt: true,  pdf: true },
  scout: { storyTxt: true, illustrationsTxt: true,  pdf: true },
  den:   { storyTxt: true, illustrationsTxt: true,  pdf: true },
  pack:  { storyTxt: true, illustrationsTxt: true,  pdf: true },
};

/* ─────────────────────────────────────────────────────────────
   Font loading
   @fontsource packages include WOFF2 files which pdfkit/fontkit
   supports natively. Paths are relative to project root.
───────────────────────────────────────────────────────────── */
function loadFont(pkg, file) {
  try {
    const fontPath = path.resolve(process.cwd(), `node_modules/@fontsource/${pkg}/files/${file}`);
    return fs.readFileSync(fontPath);
  } catch {
    console.warn(`Font not found: ${pkg}/${file} — falling back to built-in`);
    return null;
  }
}

let fontsLoaded = false;
let fonts = {};

function ensureFonts(doc) {
  if (fontsLoaded) return;

  const loraReg  = loadFont('lora', 'lora-latin-400-normal.woff2');
  const loraItal = loadFont('lora', 'lora-latin-400-italic.woff2');
  const loraBold = loadFont('lora', 'lora-latin-700-normal.woff2');
  const sansReg  = loadFont('instrument-sans', 'instrument-sans-latin-400-normal.woff2');
  const sansSemi = loadFont('instrument-sans', 'instrument-sans-latin-600-normal.woff2');

  if (loraReg)  { doc.registerFont('Lora',            loraReg);  fonts.body   = 'Lora'; }
  else          { fonts.body   = 'Times-Roman'; }

  if (loraItal) { doc.registerFont('Lora-Italic',     loraItal); fonts.italic = 'Lora-Italic'; }
  else          { fonts.italic = 'Times-Italic'; }

  if (loraBold) { doc.registerFont('Lora-Bold',       loraBold); fonts.bold   = 'Lora-Bold'; }
  else          { fonts.bold   = 'Times-Bold'; }

  if (sansReg)  { doc.registerFont('Sans',            sansReg);  fonts.sans   = 'Sans'; }
  else          { fonts.sans   = 'Helvetica'; }

  if (sansSemi) { doc.registerFont('Sans-Semi',       sansSemi); fonts.sansBold = 'Sans-Semi'; }
  else          { fonts.sansBold = 'Helvetica-Bold'; }

  fontsLoaded = true;
}

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
- Each illustration prompt should describe: characters present, setting, action happening, mood, and the chosen art style.

Respond with a valid JSON object only. No markdown fences, no preamble, nothing else.

{
  "title": "Story title",
  "story": "Full story text. Use \\n\\n to separate paragraphs.",
  "illustrations": ["Page 1: ...", "Page 2: ...", "...8 to 10 prompts total"],
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

    ensureFonts(doc);

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
       .text('What Claude picked', PAD, 40, { width: W, align: 'center' });

    rule(98);

    doc.font(fonts.sans).fontSize(11).fillColor(C.text2)
       .text(
         `Every story Claude generates uses random selection from ${childName}'s saved preferences. Here is exactly what was chosen for this story.`,
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
    from:    'Talekits <onboarding@resend.dev>',
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
