const { Resend } = require('resend');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { contactName, schoolName, studentCount, yearLevels, notes, email } = req.body;

  if (!contactName || !schoolName || !studentCount) {
    return res.status(400).json({ error: 'contactName, schoolName, and studentCount are required' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn('[ENQUIRY] RESEND_API_KEY not set — logging enquiry only');
    console.log(`[ENQUIRY] Pack enquiry from ${contactName} at ${schoolName} | Students: ${studentCount} | Email: ${email}`);
    return res.status(200).json({ success: true });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  const notificationTo  = process.env.ENQUIRY_NOTIFICATION_EMAIL || 'hello@talekits.com';
  const submittedAt     = new Date().toLocaleString('en-AU', {
    timeZone: 'Australia/Melbourne',
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  // ── Internal notification to Talekits team ──────────────────────────────
  const internalHtml = `
    <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1C1B18;">
      <p style="font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#9C9A94;margin-bottom:8px;">Talekits — Pack plan enquiry</p>
      <h1 style="font-family:Georgia,serif;font-style:italic;font-size:1.5rem;font-weight:500;margin:0 0 24px;">New classroom enquiry</h1>

      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #E0DED8;color:#6B6860;width:35%;">Contact name</td>
          <td style="padding:10px 0;border-bottom:1px solid #E0DED8;font-weight:500;">${contactName}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #E0DED8;color:#6B6860;">School / organisation</td>
          <td style="padding:10px 0;border-bottom:1px solid #E0DED8;font-weight:500;">${schoolName}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #E0DED8;color:#6B6860;">Email</td>
          <td style="padding:10px 0;border-bottom:1px solid #E0DED8;">
            ${email ? `<a href="mailto:${email}" style="color:#2B5CE6;">${email}</a>` : '<span style="color:#9C9A94;">Not provided</span>'}
          </td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #E0DED8;color:#6B6860;">Number of students</td>
          <td style="padding:10px 0;border-bottom:1px solid #E0DED8;font-weight:500;">${studentCount}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #E0DED8;color:#6B6860;">Year level(s)</td>
          <td style="padding:10px 0;border-bottom:1px solid #E0DED8;">${yearLevels || '<span style="color:#9C9A94;">Not specified</span>'}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#6B6860;vertical-align:top;">Notes</td>
          <td style="padding:10px 0;">${notes || '<span style="color:#9C9A94;">None</span>'}</td>
        </tr>
      </table>

      <p style="font-size:12px;color:#9C9A94;">Submitted ${submittedAt} (Melbourne time)</p>
    </div>`;

  // ── Confirmation email to the enquirer ──────────────────────────────────
  const confirmationHtml = `
    <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1C1B18;">
      <p style="font-family:Georgia,serif;font-style:italic;font-size:1.1rem;color:#E8830A;margin-bottom:4px;">Talekits</p>
      <h1 style="font-family:Georgia,serif;font-style:italic;font-size:1.5rem;font-weight:500;margin:0 0 16px;">Thanks, ${contactName}</h1>
      <p style="font-size:15px;color:#6B6860;line-height:1.7;margin:0 0 20px;">
        We've received your enquiry for <strong style="color:#1C1B18;">${schoolName}</strong> and will be in touch within 1–2 business days to discuss pricing, bulk options, and a free trial for your class.
      </p>
      <div style="background:#FAEEDA;border:1px solid #EF9F27;border-radius:10px;padding:16px 20px;margin-bottom:28px;">
        <p style="font-size:11px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:#633806;margin:0 0 6px;">Your enquiry summary</p>
        <p style="font-size:13px;color:#633806;margin:0;line-height:1.6;">
          ${schoolName} &nbsp;·&nbsp; ${studentCount} students${yearLevels ? ' &nbsp;·&nbsp; ' + yearLevels : ''}
        </p>
      </div>
      <p style="font-size:13px;color:#9C9A94;line-height:1.6;">
        Questions in the meantime? Reply to this email and we'll get back to you.<br/>
        — The Talekits team
      </p>
    </div>`;

  try {
    // Send internal notification
    await resend.emails.send({
      from:    'Kit from Talekits <kit@talekits.com>',
      to:      [notificationTo],
      subject: `Pack enquiry — ${schoolName} (${studentCount} students)`,
      html:    internalHtml,
      text:    `New Pack enquiry\n\nContact: ${contactName}\nSchool: ${schoolName}\nEmail: ${email || 'not provided'}\nStudents: ${studentCount}\nYear levels: ${yearLevels || 'not specified'}\nNotes: ${notes || 'none'}\n\nSubmitted: ${submittedAt}`,
    });
    console.log(`[ENQUIRY] Internal notification sent | School: ${schoolName} | Contact: ${contactName}`);

    // Send confirmation to enquirer (only if they provided an email)
    if (email) {
      await resend.emails.send({
        from:    'Kit from Talekits <kit@talekits.com>',
        to:      [email],
        subject: `We've received your Talekits enquiry`,
        html:    confirmationHtml,
        text:    `Hi ${contactName},\n\nThanks for your enquiry about Talekits for ${schoolName}. We'll be in touch within 1–2 business days to discuss pricing and a free trial for your class.\n\nYour enquiry: ${studentCount} students${yearLevels ? ', ' + yearLevels : ''}.\n\n— The Talekits team`,
      });
      console.log(`[ENQUIRY] Confirmation sent to ${email}`);
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[ENQUIRY] Email send failed:', err.message);
    // Still return 200 — the enquiry data was valid, email failure shouldn't break the frontend confirmation screen
    return res.status(200).json({ success: true, emailError: err.message });
  }
};
