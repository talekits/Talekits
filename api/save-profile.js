const { put } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { filename, content, childName, email } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'No profile content provided' });
    }

    const blob = await put(`profiles/${filename}`, content, {
      access: 'public',
      contentType: 'text/plain',
      addRandomSuffix: false,
    });

    console.log(`Profile saved: ${filename} | Child: ${childName} | Email: ${email}`);

    return res.status(200).json({
      success: true,
      url: blob.url,
      filename,
    });

  } catch (err) {
    console.error('Error saving profile:', err);
    return res.status(500).json({ error: 'Failed to save profile', detail: err.message });
  }
};
