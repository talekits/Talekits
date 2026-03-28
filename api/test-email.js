const { Resend } = require('resend');

module.exports = async function handler(req, res) {
  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY not set' });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  const { data, error } = await resend.emails.send({
    from:    'Kit from Talekit <kit@talekits.com>',
    to:      [req.query.to || 'test@example.com'],
    subject: 'Talekit email test',
    html:    '<p>If you received this, email sending is working correctly.</p>',
    text:    'If you received this, email sending is working correctly.',
  });

  if (error) {
    console.error('Test email error:', error);
    return res.status(500).json({ error });
  }

  return res.status(200).json({ success: true, id: data?.id });
};
