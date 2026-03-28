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

  // Save profile first
  try {
    await put(`profiles/${filename}`, content, {
      access:          'public',
      contentType:     'text/plain',
      addRandomSuffix: false,
    });
    console.log(`Kit profile saved: ${filename} | Child: ${childName} | Email: ${email}`);
  } catch (err) {
    console.error('Failed to save profile:', err.message);
    return res.status(500).json({ error: 'Failed to save profile' });
  }

  // Generate story and send email — must complete before responding
  // so Vercel does not terminate the function early
  try {
    console.log(`Generating trial story for: ${childName}`);
    const outputs = await generateStory(content, childName, filename, 'kit', email);
    outputs.forEach(o => console.log(`Output saved: ${o.type} → ${o.url}`));
  } catch (err) {
    console.error('Story generation failed:', err.message);
    // Still return success — profile is saved, email may arrive later via retry
  }

  return res.status(200).json({ success: true });
};
