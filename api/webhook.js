const Stripe = require('stripe');
const { put, del, list } = require('@vercel/blob');
const { generateStory } = require('./generate-story');

// Disable body parser so Stripe signature verification works
module.exports.config = { api: { bodyParser: false } };

// Allow up to 300 seconds — image generation takes time
module.exports.maxDuration = 300;

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe    = Stripe(process.env.STRIPE_SECRET_KEY);
  const rawBody   = await getRawBody(req);
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // Only act on successful checkout completions
  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session  = event.data.object;
  const filename = session.metadata?.filename;
  const plan     = session.metadata?.plan;
  const child    = session.metadata?.childName;
  const email    = session.customer_email || session.metadata?.email || null;

  if (!filename) {
    console.warn('No filename in session metadata — skipping');
    return res.status(200).json({ received: true });
  }

  // Respond to Stripe immediately — must reply within 30s or Stripe retries
  res.status(200).json({ received: true });

  // Continue processing asynchronously after responding
  try {
    // 1. Find and fetch the pending profile
    const { blobs } = await list({ prefix: `pending/${filename}` });

    if (!blobs.length) {
      console.warn(`No pending profile found for: ${filename}`);
      return;
    }

    const pendingBlob    = blobs[0];
    const profileContent = await fetch(pendingBlob.url).then(r => r.text());

    // 2. Confirm profile — save to profiles/
    const confirmed = await put(`profiles/${filename}`, profileContent, {
      access: 'public',
      contentType: 'text/plain',
      addRandomSuffix: false,
    });
    await del(pendingBlob.url);
    console.log(`Profile confirmed: ${filename} | Plan: ${plan} | Child: ${child}`);

    // 3. Generate story and plan-appropriate output files
    console.log(`Generating story for: ${child} | Plan: ${plan} | Email: ${email}`);
    const outputs = await generateStory(profileContent, child, filename, plan, email);
    outputs.forEach(o => console.log(`Output saved: ${o.type} → ${o.url}`));

  } catch (err) {
    console.error('Post-checkout processing error:', err.message);
  }
};

