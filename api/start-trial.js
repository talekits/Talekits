const { put } = require('@vercel/blob');
const { generateStory } = require('./generate-story');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { filename, content, childName, email } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'No profile content provided' });
  }

  // Respond immediately so the user sees the success message right away
  // Story generation happens asynchronously after the response
  res.status(200).json({ success: true });

  // Save confirmed profile directly — no pending step needed, no payment to wait for
  try {
    await put(`profiles/${filename}`, content, {
      access:          'public',
      contentType:     'text/plain',
      addRandomSuffix: false,
    });
    console.log(`Kit trial profile saved: ${filename} | Child: ${childName} | Email: ${email}`);
  } catch (err) {
    console.error('Failed to save trial profile:', err.message);
    return;
  }

  // Generate story and send email
  try {
    console.log(`Generating trial story for: ${childName}`);
    const outputs = await generateStory(content, childName, filename, 'kit', email);
    outputs.forEach(o => console.log(`Output saved: ${o.type} → ${o.url}`));
  } catch (err) {
    console.error('Trial story generation failed:', err.message);
  }
};
