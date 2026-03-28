const { put } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  console.log('--- save-profile called ---');
  console.log('Method:', req.method);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('Body received:', JSON.stringify(req.body));

  try {
    const { filename, content, childName, email } = req.body;

    if (!content) {
      console.log('ERROR: No content in request body');
      return res.status(400).json({ error: 'No profile content provided' });
    }

    console.log('Attempting blob save:', filename);
    console.log('BLOB token present:', !!process.env.BLOB_READ_WRITE_TOKEN);

    const blob = await put(`profiles/${filename}`, content, {
      access: 'private',
      contentType: 'text/plain',
      addRandomSuffix: false,
    });

    console.log('Blob saved successfully:', blob.url);

    return res.status(200).json({
      success: true,
      url: blob.url,
      filename,
    });

  } catch (err) {
    console.error('ERROR saving profile:', err.message);
    console.error('Full error:', err);
    return res.status(500).json({ error: 'Failed to save profile', detail: err.message });
  }
};
