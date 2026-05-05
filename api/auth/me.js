'use strict';

const { getClient, getUserFromToken } = require('../../lib/supabase');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * GET /api/auth/me
 * Header : Authorization: Bearer <access_token>
 *
 * Retourne l'utilisateur connecté + son abonnement + ses clés API (masquées).
 */
module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const token = (req.headers?.['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Token invalide ou expiré. Reconnectez-vous.' });

  const supabase = getClient();

  // Récupérer subscription et clés en parallèle
  const [subResult, keysResult] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('plan, status, current_period_end, stripe_customer_id')
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('api_keys')
      .select('id, key_prefix, name, plan, requests_today, requests_total, last_used_at, is_active, created_at, reset_date')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
  ]);

  const subscription = subResult.data ?? { plan: 'free', status: 'active' };
  const keys = (keysResult.data ?? []).map(k => {
    // Reset compteur journalier si nécessaire (affichage uniquement)
    const today = new Date().toISOString().slice(0, 10);
    return {
      ...k,
      requests_today: k.reset_date !== today ? 0 : k.requests_today,
    };
  });

  const planLimits = { free: 100, starter: 1_000, pro: 10_000 };

  return res.status(200).json({
    user: { id: user.id, email: user.email },
    subscription: {
      plan:               subscription.plan ?? 'free',
      status:             subscription.status ?? 'active',
      limit_per_day:      planLimits[subscription.plan ?? 'free'],
      current_period_end: subscription.current_period_end ?? null,
    },
    api_keys: keys,
  });
};
