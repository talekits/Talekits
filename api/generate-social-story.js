const { put, del } = require('@vercel/blob');
const PDFDocument   = require('pdfkit');
const { Resend }    = require('resend');

/* ─────────────────────────────────────────────────────────────
   Social campaign story generator
   Completely isolated from the main pipeline.
   Triggered by: ManyChat webhook when email + child details captured.
   Outputs: text-only story PDF delivered via Resend.
   No illustrations, no audio, no picture book.
   Protagonist is always the child (name as hero, 100% of the time).
   Profile is temporary — deleted when subscriber signs up.
───────────────────────────────────────────────────────────── */

/* ─── Brand colours (match generate-story.js) ─── */
const C = {
  bg:         '#FAFAF8',
  surface:    '#F3F2EE',
  border:     '#E0DED8',
  text:       '#1C1B18',
  text2:      '#6B6860',
  text3:      '#9C9A94',
  amberBg:    '#FAEEDA',
  amberText:  '#633806',
  amberBorder:'#EF9F27',
  purpleBg:   '#EEEDFE',
  purpleText: '#3C3489',
  purpleBorder:'#AFA9EC',
};

const fonts = {
  body:     'Times-Roman',
  italic:   'Times-Italic',
  bold:     'Times-Bold',
  sans:     'Helvetica',
  sansBold: 'Helvetica-Bold',
};

/* ─────────────────────────────────────────────────────────────
   Age mapping — convert plain age integer to Age Bracket string
   Used by Claude prompt. No curriculum or state needed.
───────────────────────────────────────────────────────────── */
function ageToBracket(age) {
  const n = parseInt(age, 10);
  if (n <= 3)  return 'Ages 2-3 (Toddler)';
  if (n <= 5)  return 'Ages 4-5 (Preschool)';
  if (n <= 7)  return 'Ages 6-7 (Early Reader)';
  if (n <= 10) return 'Ages 8-10 (Confident Reader)';
  return 'Ages 10-12 (Independent Reader)';
}

/* ─────────────────────────────────────────────────────────────
   Age to word count targets for this pipeline.
   Claude picks randomly within range.
───────────────────────────────────────────────────────────── */
function ageToWordCount(age) {
  const n = parseInt(age, 10);
  if (n <= 3)  return { min: 100,  max: 200  };
  if (n <= 5)  return { min: 200,  max: 350  };
  if (n <= 7)  return { min: 400,  max: 550  };
  if (n <= 10) return { min: 550,  max: 800  };
  return               { min: 800,  max: 1100 };
}

/* ─────────────────────────────────────────────────────────────
   Build a minimal TALEKIT STORY PROFILE for the social pipeline.
   Key differences from main pipeline:
     - Child is always the protagonist (no dice roll)
     - All themes, tones, story lengths kept in (Claude still picks randomly)
     - No curriculum block, no state, no year level
     - Prompt is intentionally simpler — just enough context for a great story
───────────────────────────────────────────────────────────── */
function buildSocialProfile(childName, age, commentDetails = '') {
  const bracket   = ageToBracket(age);
  const wc        = ageToWordCount(age);
  const detailsLine = commentDetails.trim()
    ? `Additional details from child's parent: ${commentDetails.trim()}`
    : '';

  return [
    'TALEKIT STORY PROFILE',
    '─'.repeat(36),
    `Child's name: ${childName}`,
    `Age: ${age}`,
    `Age Bracket: ${bracket}`,
    `Word count target: ${wc.min}${String.fromCharCode(8211)}${wc.max} words`,
    detailsLine,
    '',
    'PROTAGONIST RULE (OVERRIDE)',
    '─'.repeat(36),
    `The child's name (${childName}) MUST be the protagonist of this story. Do not roll the normal protagonist dice. ${childName} is always the hero. Ignore rule 9 in SELECTION RULES and always select "Child's own name as the hero" for protagonist type.`,
    '',
    'SELECTION RULES (apply normally)',
    '─'.repeat(36),
    'Pick randomly from all available options for:',
    '  Themes (1-3): Adventures, Friendship, Discovery, Family, Nature, Animals, Space, Magic, Mystery, Courage, Creativity, Helping others',
    '  Tone: Warm & Cosy, Funny & Playful, Exciting & Adventurous, Gently Spooky, Heartfelt & Moving, Silly & Absurd, Calm & Reflective',
    '  Story Structure: Linear journey, Problem and solution, Circular ending, Episodic adventures, Discovery arc',
    '  Story Length: Short, Medium, or Long (within the age bracket word count target above)',
    '  Educational Focus (1-2): Kindness, Curiosity, Bravery, Sharing, Problem-solving, Creativity, Empathy, Perseverance',
    '  Art Style: pick any age-appropriate style (used for parentNote only — no illustrations generated)',
    '',
    'Do NOT mention curriculum, year levels, or educational standards anywhere in the story itself.',
    '',
    'OUTPUT FORMAT',
    '─'.repeat(36),
    'Respond with a valid JSON object only. No markdown fences. Fields required:',
    '  title, story (paragraphs separated by \\n\\n), parentNote, selections (storyLength, tone, themes, educationalFocus)',
    'Do NOT include: pageChunks, illustrations, characterAnchor (no images generated in this pipeline).',
  ].filter(s => s !== null).join('\n');
}

/* ─────────────────────────────────────────────────────────────
   Claude system prompt for social pipeline
   Shares the age bracket rails from main generate-story.js
   but strips out all illustration-related rules.
───────────────────────────────────────────────────────────── */
const SOCIAL_SYSTEM_PROMPT = `You are a children's storybook author for Talekits, an AI-powered personalised storybook service. A fox named Kit is the brand mascot.

You will receive a TALEKIT STORY PROFILE. Your job is to write a beautifully crafted, original story following the rules below.

═══════════════════════════════════════
AGE BRACKET RAILS — NON-NEGOTIABLE
═══════════════════════════════════════

AGES 2-3 (TODDLER)
- Word count: 100-200 words maximum.
- Sentences: 3-6 words each. One idea per sentence.
- Vocabulary: Only the most common, everyday words. No figurative language.
- Repetition: A phrase must repeat 3-4 times throughout the story.
- Structure: One simple event. No subplots, no twists.
- Paragraphs: 1-2 sentences each.
- Themes: Concrete and familiar — animals, bedtime, food, playing, family.
- Tone: Gentle, warm, playful.

AGES 4-5 (PRESCHOOL)
- Word count: 200-350 words.
- Sentences: 5-10 words. Simple subject-verb-object. One clause per sentence.
- Vocabulary: Common preschooler words. At most 1-2 new words explained by context. No metaphors.
- Repetition: A simple repeated phrase 2-3 times.
- Structure: Simple beginning-middle-end. One clear problem, one resolution.
- Paragraphs: 2-3 short sentences.
- Tone: Warm, fun, reassuring.

AGES 6-7 (EARLY READER)
- Word count: 400-550 words.
- Sentences: Mix of short (6-8 words) and medium (10-14 words). Simple compound sentences allowed.
- Vocabulary: Confident but accessible. 3-5 new words supported by context.
- Structure: Proper story arc — introduction, rising action, climax, resolution.
- Paragraphs: 3-5 sentences each.
- Tone: Exciting, warm, funny.

AGES 8-10 (CONFIDENT READER)
- Word count: 550-800 words.
- Sentences: Full range — short punchy for impact, longer for description. Multiple clauses allowed.
- Vocabulary: Rich and expressive. Vivid adjectives, adverbs, interesting verbs.
- Structure: Complete narrative arc with genuine stakes and character development.
- Paragraphs: 4-6 sentences.
- Tone: Full range including mystery, suspense, humour.

AGES 10-12 (INDEPENDENT READER)
- Word count: 800-1100 words.
- Sentences: Full expressive range. Sophisticated rhythm. Multiple embedded clauses.
- Vocabulary: Rich, precise, confident. Unexpected verbs, specific nouns. Occasional irony and subtext.
- Structure: Full literary narrative — genuine emotional complexity, layered character motivations.
- Paragraphs: 4-8 sentences. Varied length.
- Tone: Full emotional range from playful to melancholy, suspenseful, awe-inspiring.

═══════════════════════════════════════
STORY WRITING RULES
═══════════════════════════════════════
- Write in flowing paragraphs separated by blank lines. No headings or bullet points inside the story.
- The child named in the profile is ALWAYS the protagonist. Weave their name naturally throughout.
- Apply the Age Bracket Rails strictly.
- Educational focus must feel like part of the story, never a moral tacked on at the end.
- End on a warm, satisfying note appropriate to the age.
- Do NOT mention curriculum, schooling, or educational standards in the story.

Respond with valid JSON only. No markdown fences, no preamble.

{
  "title": "Story title",
  "story": "Full story text. Use \\n\\n to separate paragraphs.",
  "parentNote": "One sentence for parents explaining the theme or value explored.",
  "selections": {
    "storyLength": "Short / Medium / Long",
    "tone": "selected tone",
    "themes": ["theme1", "theme2"],
    "educationalFocus": ["focus1"]
  }
}`;

/* ─────────────────────────────────────────────────────────────
   Generate story via Claude
───────────────────────────────────────────────────────────── */
async function callClaude(childName, age, commentDetails) {
  const profile = buildSocialProfile(childName, age, commentDetails);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 3000,
      system:     SOCIAL_SYSTEM_PROMPT,
      messages: [{
        role:    'user',
        content: `Here is the child's story profile. Please generate a story now.\n\n${profile}`,
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Anthropic API error ${response.status}`);
  }

  const data    = await response.json();
  const rawText = (data.content || []).map(c => c.text || '').join('');

  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/,       '')
    .replace(/```\s*$/,       '')
    .trim();

  return JSON.parse(cleaned);
}

/* ─────────────────────────────────────────────────────────────
   Build text-only story PDF — same design as main pipeline's buildPdf
   but without selections page (no art style, no illustration data).
───────────────────────────────────────────────────────────── */
function buildSocialPdf(story, childName) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true });
    const chunks = [];

    doc.on('data',  c   => chunks.push(c));
    doc.on('end',   ()  => resolve(Buffer.concat(chunks)));
    doc.on('error', err => reject(err));

    const PW  = doc.page.width;
    const PH  = doc.page.height;
    const PAD = 56;
    const W   = PW - PAD * 2;
    const date = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

    function rule(y, colour = C.border) {
      doc.save().moveTo(PAD, y).lineTo(PW - PAD, y)
         .lineWidth(0.5).strokeColor(colour).stroke().restore();
    }

    /* Header */
    doc.rect(0, 0, PW, PH).fill(C.bg);
    doc.rect(0, 0, PW, 110).fill(C.surface);

    doc.font(fonts.italic).fontSize(10).fillColor(C.text3)
       .text('Talekits  \u2014  Your personalised story', PAD, 28, { width: W, align: 'center' });

    doc.font(fonts.italic).fontSize(28).fillColor(C.text)
       .text(story.title, PAD, 46, { width: W, align: 'center', lineGap: 2 });

    rule(118, C.border);

    doc.font(fonts.sans).fontSize(10).fillColor(C.text2)
       .text(`A story for ${childName}`, PAD, 130, { width: W / 2 });
    doc.font(fonts.sans).fontSize(10).fillColor(C.text3)
       .text(date, PAD, 130, { width: W, align: 'right' });

    /* Story body */
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

    /* Parent note */
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

      y = doc.y + 24;
    }

    /* Talekits CTA page */
    doc.addPage();
    doc.rect(0, 0, PW, PH).fill(C.bg);
    doc.rect(0, 0, PW, 90).fill(C.surface);

    doc.font(fonts.italic).fontSize(10).fillColor(C.text3)
       .text('Talekits  \u2014  Keep the stories coming', PAD, 24, { width: W, align: 'center' });

    doc.font(fonts.italic).fontSize(22).fillColor(C.text)
       .text('Want a new story every day?', PAD, 40, { width: W, align: 'center' });

    rule(98);

    const ctaBody = [
      `${childName} loved this story. Imagine a brand-new one waiting in your inbox every single morning.`,
      '',
      'Kit (that\'s our fox) writes a completely original story for your child every day. Different characters, different worlds, different adventures. Your child is always welcome as the hero.',
      '',
      'Try it free for 7 days at talekits.com',
      '',
      'Kit plan  \u2014  Free (7 days, no credit card)',
      'A daily text story, personalised for your child.',
      '',
      'Cub  \u2014  $9.99 / month',
      'Daily story + full audiobook narration.',
      '',
      'Scout  \u2014  $14.99 / month',
      'Daily story + illustrated picture book PDF + audiobook.',
      '',
      'Den  \u2014  $24.99 / month',
      'Everything in Scout, for up to 3 children.',
    ].join('\n');

    doc.font(fonts.body).fontSize(12).fillColor(C.text).lineGap(5)
       .text(ctaBody, PAD, 122, { width: W });

    /* Page footers */
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.rect(0, PH - 36, PW, 36).fill(C.surface);
      doc.moveTo(0, PH - 36).lineTo(PW, PH - 36)
         .lineWidth(0.5).strokeColor(C.border).stroke();
      doc.font(fonts.sans).fontSize(9).fillColor(C.text3)
         .text(
           `Talekits  \u00b7  ${story.title}  \u00b7  Page ${i + 1} of ${range.count}`,
           PAD, PH - 23,
           { width: W, align: 'center' }
         );
    }

    doc.end();
  });
}

/* ─────────────────────────────────────────────────────────────
   Delivery email — social campaign flavour
   Distinct from the main pipeline's sendStoryEmail.
   Warm, gift-like, plan overview with clear trial CTA.
───────────────────────────────────────────────────────────── */
function buildSocialEmailHtml(childName, storyTitle, parentNote, storyPdfUrl) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.talekits.com';
  const btnStyle = 'display:inline-block;background:#E8830A;color:#FAFAF8;font-family:Georgia,"Times New Roman",serif;font-style:italic;font-size:15px;font-weight:400;text-decoration:none;padding:12px 32px;border-radius:999px;';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${childName}'s story from Talekits</title>
</head>
<body style="margin:0;padding:0;background-color:#FAFAF8;font-family:Georgia,'Times New Roman',serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#FAFAF8;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">

        <tr>
          <td style="background:#F3F2EE;border-radius:14px 14px 0 0;padding:32px 40px 24px;text-align:center;border-bottom:1px solid #E0DED8;">
            <p style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#9C9A94;">Kit the Fox, Talekits Storywriter</p>
            <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:26px;font-weight:400;color:#1C1B18;line-height:1.25;">${childName}'s story is here</h1>
          </td>
        </tr>

        <tr>
          <td style="background:#FFFFFF;padding:36px 40px;">
            <p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1C1B18;line-height:1.7;">
              Hi! I'm Kit, the fox who writes every Talekits story. I saw your comment and I couldn't wait to write this one.
            </p>
            <p style="margin:0 0 24px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1C1B18;line-height:1.7;">
              It's called <em>"${storyTitle}"</em> and it belongs to ${childName}. There's no other story like it anywhere in the world.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 28px;">
              <tr>
                <td style="background:#EEEDFE;border:0.5px solid #AFA9EC;border-radius:10px;padding:20px 24px;">
                  <p style="margin:0 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#9C9A94;">Today's story</p>
                  <p style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:20px;color:#3C3489;line-height:1.3;">${storyTitle}</p>
                  <a href="${storyPdfUrl}" target="_blank" style="${btnStyle}">Read ${childName}'s story</a>
                </td>
              </tr>
            </table>

            ${parentNote ? `
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 28px;">
              <tr>
                <td style="background:#FAEEDA;border:0.5px solid #EF9F27;border-radius:10px;padding:16px 20px;">
                  <p style="margin:0 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:#633806;">A note for parents</p>
                  <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#633806;line-height:1.6;">${parentNote}</p>
                </td>
              </tr>
            </table>` : ''}

            <p style="margin:0 0 12px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1C1B18;line-height:1.7;">
              This was a gift from us. But imagine if a brand-new story arrived for ${childName} every morning, written around their world.
            </p>
            <p style="margin:0 0 6px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1C1B18;line-height:1.7;">That's exactly what Talekits does. Here's how it works:</p>

            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:16px 0 28px;">
              <tr><td style="padding:8px 0;border-bottom:1px solid #E0DED8;">
                <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#1C1B18;line-height:1.6;">
                  <strong style="color:#E8830A;">Kit (free, 7 days)</strong> &mdash; A daily text story for ${childName}. No credit card needed.
                </p>
              </td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid #E0DED8;">
                <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#1C1B18;line-height:1.6;">
                  <strong>Cub &mdash; $9.99/month</strong> &mdash; Daily story + audiobook narration.
                </p>
              </td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid #E0DED8;">
                <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#1C1B18;line-height:1.6;">
                  <strong>Scout &mdash; $14.99/month</strong> &mdash; Daily story + illustrated picture book PDF + audiobook.
                </p>
              </td></tr>
              <tr><td style="padding:8px 0;">
                <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#1C1B18;line-height:1.6;">
                  <strong>Den &mdash; $24.99/month</strong> &mdash; Everything in Scout, for up to 3 children.
                </p>
              </td></tr>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 32px;">
              <tr>
                <td align="center">
                  <a href="${baseUrl}/start" style="display:inline-block;background:#1C1B18;color:#FAFAF8;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:15px;font-weight:400;text-decoration:none;padding:12px 32px;border-radius:999px;">
                    Start ${childName}'s free trial
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#1C1B18;line-height:1.8;">
              I hope ${childName} loves their story. I'd love to write many more for them.<br/><br/>
              <em>Kit the Fox 🦊</em>
            </p>
          </td>
        </tr>

        <tr>
          <td style="background:#F3F2EE;border-radius:0 0 14px 14px;padding:24px 40px;border-top:1px solid #E0DED8;text-align:center;">
            <p style="margin:0 0 6px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#9C9A94;line-height:1.6;">You received this because you requested a personalised story for ${childName} on social media.</p>
            <p style="margin:0 0 6px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#9C9A94;line-height:1.6;">To unsubscribe from future emails, reply with "unsubscribe".</p>
            <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:13px;color:#6B6860;">Talekits &mdash; a new story, every day</p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/* ─────────────────────────────────────────────────────────────
   Save temporary profile to Blob
   Key: social-temp/{safeEmail}.json
   Deleted when subscriber signs up for any plan.
───────────────────────────────────────────────────────────── */
async function saveTempProfile(email, childName, age, commentDetails) {
  const safeEmail = email.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const key       = `social-temp/${safeEmail}.json`;

  const profile = {
    email,
    childName,
    age: parseInt(age, 10),
    commentDetails: commentDetails || '',
    source:         'social-campaign',
    createdAt:      new Date().toISOString(),
  };

  await put(key, JSON.stringify(profile), {
    access:          'public',
    contentType:     'application/json',
    addRandomSuffix: false,
  });

  console.log(`[SOCIAL] Temp profile saved: ${key}`);
  return key;
}

/* ─────────────────────────────────────────────────────────────
   Delete temporary profile from Blob
   Called from webhook.js when this email signs up for a plan.
───────────────────────────────────────────────────────────── */
async function deleteTempProfile(email) {
  try {
    const safeEmail = email.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const key       = `social-temp/${safeEmail}.json`;
    await del(key);
    console.log(`[SOCIAL] Temp profile deleted: ${key}`);
  } catch (err) {
    // Non-fatal — profile may already be gone
    console.warn(`[SOCIAL] Could not delete temp profile for ${email}: ${err.message}`);
  }
}

/* ─────────────────────────────────────────────────────────────
   Main handler — called by Vercel serverless function
   Expected body: { email, childName, age, commentDetails? }
   commentDetails: raw comment text from social post (name + extras)
───────────────────────────────────────────────────────────── */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, childName, age, commentDetails = '' } = req.body || {};

  if (!email || !childName || age === undefined || age === null) {
    return res.status(400).json({ error: 'email, childName and age are required' });
  }

  const ageNum = parseInt(age, 10);
  if (isNaN(ageNum) || ageNum < 2 || ageNum > 12) {
    return res.status(400).json({ error: 'age must be a number between 2 and 12' });
  }

  console.log(`[SOCIAL-1] Request: childName=${childName} age=${ageNum} email=${email}`);

  try {
    /* 1. Save temporary profile */
    await saveTempProfile(email, childName, ageNum, commentDetails);

    /* 2. Generate story via Claude */
    console.log(`[SOCIAL-2] Calling Claude for ${childName}, age ${ageNum}...`);
    const story = await callClaude(childName, ageNum, commentDetails);
    console.log(`[SOCIAL-2] Story generated: "${story.title}"`);

    /* 3. Build PDF */
    console.log(`[SOCIAL-3] Building PDF...`);
    const pdfBuffer = await buildSocialPdf(story, childName);

    /* 4. Save PDF to Blob */
    const safeEmail = email.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const safeChild = childName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const ts        = Date.now();
    const blobKey   = `social-stories/${safeEmail}-${safeChild}-${ts}.pdf`;

    const blob = await put(blobKey, pdfBuffer, {
      access:          'public',
      contentType:     'application/pdf',
      addRandomSuffix: false,
    });

    console.log(`[SOCIAL-4] PDF saved: ${blob.url}`);

    /* 5. Send email via Resend */
    if (!process.env.RESEND_API_KEY) {
      console.warn('[SOCIAL-5] RESEND_API_KEY not set — skipping email');
    } else {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const html   = buildSocialEmailHtml(childName, story.title, story.parentNote, blob.url);

      const { error } = await resend.emails.send({
        from:    'Kit from Talekits <kit@talekits.com>',
        to:      [email],
        subject: `${childName}'s story is here`,
        html,
        text:    `Hi! Kit here. I just wrote ${childName} a personalised story called "${story.title}". Read it here: ${blob.url}\n\nWant a new story every day? Try Talekits free at ${process.env.NEXT_PUBLIC_BASE_URL || 'https://www.talekits.com'}/start`,
      });

      if (error) {
        console.error(`[SOCIAL-5] Resend error: ${error.message}`);
      } else {
        console.log(`[SOCIAL-5] Email sent to ${email}`);
      }
    }

    return res.status(200).json({
      success:    true,
      storyTitle: story.title,
      pdfUrl:     blob.url,
    });

  } catch (err) {
    console.error(`[SOCIAL] Handler error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
};

/* ─────────────────────────────────────────────────────────────
   Named export for use in webhook.js
   Call this when a social-campaign subscriber signs up.
───────────────────────────────────────────────────────────── */
module.exports.deleteTempProfile = deleteTempProfile;
