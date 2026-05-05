'use strict';

const Stripe = require('stripe');
const { getClient, getUserFromToken } = require('../../lib/supabase');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * POST /api/stripe/portal
 * Header : Authorization: Bearer <access_token>
 *
 * Crée une session Stripe Customer Portal et retourne l'URL.
 * Permet à l'utilisateur de gérer son abonnement (annuler, changer de plan,
 * mettre à jour sa carte bancaire) directement sur l'interface Stripe.
 */
module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'Paiement non configuré.' });
  }

  const token = (req.headers?.['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Token invalide ou expiré.' });

  const supabase = getClient();
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .single();

  if (!sub?.stripe_customer_id) {
    return res.status(404).json({ error: 'Aucun abonnement payant trouvé.' });
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const appUrl = process.env.APP_URL || 'https://immodata-france.vercel.app';

  const portalSession = await stripe.billingPortal.sessions.create({
    customer:   sub.stripe_customer_id,
    return_url: `${appUrl}/app`,
  });

  return res.status(200).json({ url: portalSession.url });
};
