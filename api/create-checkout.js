const Stripe = require('stripe');
const { put } = require('@vercel/blob');
const bcrypt  = require('bcryptjs');

const PLANS = {
  kit:   { name: 'Kit',   trialDays: 7,  priceEnvKey: null },
  cub:   { name: 'Cub',   trialDays: 0,  priceEnvKey: 'STRIPE_PRICE_CUB' },
  scout: { name: 'Scout', trialDays: 0,  priceEnvKey: 'STRIPE_PRICE_SCOUT' },
  den:   { name: 'Den',   trialDays: 0,  priceEnvKey: 'STRIPE_PRICE_DEN' },
  grove: { name: 'Grove', trialDays: 0,  priceEnvKey: 'STRIPE_PRICE_GROVE' },
  pack:  { name: 'Pack',  trialDays: 0,  priceEnvKey: 'STRIPE_PRICE_PACK' },
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { planId, childName, email, gender, password, filename, content, profileJson, narratorVoice, charCustom } = req.body;

  if (!planId || !PLANS[planId]) {
    return res.status(400).json({ error: 'Invalid plan selected' });
  }
  if (!content) {
    return res.status(400).json({ error: 'No profile content provided' });
  }

  const plan    = PLANS[planId];
  const stripe  = Stripe(process.env.STRIPE_SECRET_KEY);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `https://${req.headers.host}`;

  try {
    let passwordHash = '';
    if (password && planId !== 'kit') {
      passwordHash = await bcrypt.hash(password, 10);
    }

    // Save profile text as pending
    console.log(`[CC-1] Saving pending profile: pending/${filename}`);
    const blobResult = await put(`pending/${filename}`, content, {
      access: 'public', contentType: 'text/plain', addRandomSuffix: false,
    });
    console.log(`[CC-2] Pending profile saved: ${blobResult.url}`);

    // Save profileJson alongside — same filename with .json extension
    if (profileJson) {
      const jsonFilename = filename.replace('.txt', '.json');
      await put(`pending/${jsonFilename}`, JSON.stringify(profileJson), {
        access: 'public', contentType: 'application/json', addRandomSuffix: false,
      });
      console.log(`[CC-2b] Pending profile JSON saved: pending/${jsonFilename}`);
    }

    // Shared metadata for all plans
    const meta = {
      childName:    childName || '',
      gender:       gender    || '',
      filename,
      plan:         planId,
      email:        email     || '',
      passwordHash,
      narratorVoice: narratorVoice || 'au_female',
      charCustom:    charCustom ? 'true' : 'false',
    };

    // Paid plans
    const priceId = process.env[plan.priceEnvKey];
    if (!priceId) {
      return res.status(500).json({ error: `Price ID not configured for plan: ${planId}` });
    }

    console.log(`[CC-3] Creating Stripe session | Plan: ${planId} | Child: ${childName} | Email: ${email}`);

    // Build line items — always the subscription, plus optional one-time char customisation
    const lineItems = [{ price: priceId, quantity: 1 }];
    if (charCustom) {
      // One-time $14.99 charge for character customisation
      // Requires a pre-created one-time price in Stripe, or use inline price_data
      lineItems.push({
        price_data: {
          currency:     'aud',
          product_data: {
            name:        'Character Customisation',
            description: 'Make the protagonist look like your child. Upload photos in your dashboard after signup.',
          },
          unit_amount: 1499, // $14.99 AUD in cents
        },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode:           'subscription',
      customer_email: email || undefined,
      line_items:     lineItems,
      metadata:       meta,
      subscription_data: { metadata: meta },
      success_url: `${baseUrl}/success?plan=${planId}&child=${encodeURIComponent(childName || '')}&email=${encodeURIComponent(email || '')}`,
      cancel_url:  `${baseUrl}/?cancelled=true`,
    });
    console.log(`[CC-4] Stripe session created: ${session.id}`);

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Checkout error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session', detail: err.message });
  }
};
