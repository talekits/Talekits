const Stripe = require('stripe');
const { put } = require('@vercel/blob');

const PLANS = {
  kit:   { name: 'Kit',   trialDays: 7,  priceEnvKey: null },
  cub:   { name: 'Cub',   trialDays: 0,  priceEnvKey: 'STRIPE_PRICE_CUB' },
  scout: { name: 'Scout', trialDays: 0,  priceEnvKey: 'STRIPE_PRICE_SCOUT' },
  den:   { name: 'Den',   trialDays: 0,  priceEnvKey: 'STRIPE_PRICE_DEN' },
  pack:  { name: 'Pack',  trialDays: 0,  priceEnvKey: 'STRIPE_PRICE_PACK' },
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { planId, childName, email, filename, content } = req.body;

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
    // Save profile as pending — only moved to profiles/ after checkout is confirmed
    await put(`pending/${filename}`, content, {
      access: 'public',
      contentType: 'text/plain',
      addRandomSuffix: false,
    });
    console.log(`Profile saved as pending: ${filename}`);

    // Kit — free trial, converts to Cub after 7 days
    if (planId === 'kit') {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer_email: email || undefined,
        line_items: [{ price: process.env.STRIPE_PRICE_CUB, quantity: 1 }],
        subscription_data: {
          trial_period_days: 7,
          metadata: { childName, filename, plan: 'kit' },
        },
        metadata: { childName, filename, plan: 'kit', email: email || '' },
        success_url: `${baseUrl}/success?plan=kit&child=${encodeURIComponent(childName || '')}&email=${encodeURIComponent(email || '')}`,
        cancel_url:  `${baseUrl}/?cancelled=true`,
      });
      return res.status(200).json({ url: session.url });
    }

    // Paid plans
    const priceId = process.env[plan.priceEnvKey];
    if (!priceId) {
      return res.status(500).json({ error: `Price ID not configured for plan: ${planId}` });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { childName, filename, plan: planId, email: email || '' },
      subscription_data: {
        metadata: { childName, filename, plan: planId, email: email || '' },
      },
      success_url: `${baseUrl}/success?plan=${planId}&child=${encodeURIComponent(childName || '')}&email=${encodeURIComponent(email || '')}`,
      cancel_url:  `${baseUrl}/?cancelled=true`,
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Checkout error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session', detail: err.message });
  }
};
