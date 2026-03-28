const Stripe = require('stripe');

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

  const { planId, childName, email, filename } = req.body;

  if (!planId || !PLANS[planId]) {
    return res.status(400).json({ error: 'Invalid plan selected' });
  }

  const plan = PLANS[planId];
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `https://${req.headers.host}`;

  try {
    // Kit is a free trial — create subscription with trial, no upfront charge
    if (planId === 'kit') {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer_email: email || undefined,
        line_items: [{
          price: process.env.STRIPE_PRICE_CUB, // Trial converts to Cub after 7 days
          quantity: 1,
        }],
        subscription_data: {
          trial_period_days: 7,
          metadata: { childName, filename, plan: 'kit' },
        },
        metadata: { childName, filename, plan: 'kit' },
        success_url: `${baseUrl}/success?plan=kit&child=${encodeURIComponent(childName || '')}`,
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
      metadata: { childName, filename, plan: planId },
      subscription_data: {
        metadata: { childName, filename, plan: planId },
      },
      success_url: `${baseUrl}/success?plan=${planId}&child=${encodeURIComponent(childName || '')}`,
      cancel_url:  `${baseUrl}/?cancelled=true`,
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session', detail: err.message });
  }
};
