'use strict';

const Stripe = require('stripe');
const { getClient, getUserFromToken } = require('../../lib/supabase');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Plans → Price IDs Stripe (à configurer dans Vercel env vars)
const PLAN_PRICES = {
  starter: process.env.STRIPE_PRICE_STARTER, // ex: price_1Pxxx
  pro:     process.env.STRIPE_PRICE_PRO,     // ex: price_1Pyyy
};

/**
 * POST /api/stripe/checkout
 * Header : Authorization: Bearer <access_token>
 * Body   : { plan: "starter" | "pro" }
 *
 * Crée une session Stripe Checkout et retourne l'URL de paiement.
 * Après paiement, Stripe redirige vers APP_URL/app?success=true
 * et déclenche le webhook /api/stripe/webhook pour mettre à jour la DB.
 *
 * Variables d'environnement requises :
 *   STRIPE_SECRET_KEY      sk_live_... ou sk_test_...
 *   STRIPE_PRICE_STARTER   price_... (9€/mois dans Stripe dashboard)
 *   STRIPE_PRICE_PRO       price_... (29€/mois dans Stripe dashboard)
 *   APP_URL                https://immodata-france.vercel.app
 */
module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'Paiement non configuré. Contactez le support.' });
  }

  const token = (req.headers?.['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Token invalide ou expiré.' });

  const { plan } = req.body || {};
  if (!plan || !PLAN_PRICES[plan]) {
    return res.status(400).json({ error: 'Plan invalide. Choisissez "starter" ou "pro".' });
  }

  const priceId = PLAN_PRICES[plan];
  if (!priceId) {
    return res.status(503).json({ error: `Plan ${plan} non configuré. Contactez le support.` });
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = getClient();
  const appUrl = process.env.APP_URL || 'https://immodata-france.vercel.app';

  // Récupérer ou créer le customer Stripe
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id, plan')
    .eq('user_id', user.id)
    .single();

  let customerId = sub?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;
    // Enregistrer le customer ID
    await supabase.from('subscriptions').upsert(
      { user_id: user.id, stripe_customer_id: customerId, plan: 'free', status: 'active' },
      { onConflict: 'user_id' }
    );
  }

  // Créer la session Checkout
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/app?success=true&plan=${plan}`,
    cancel_url:  `${appUrl}/app?cancelled=true`,
    allow_promotion_codes: true,
    metadata: { user_id: user.id, plan },
  });

  return res.status(200).json({ url: session.url });
};
