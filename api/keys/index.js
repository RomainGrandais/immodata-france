'use strict';

const { getClient, getUserFromToken } = require('../../lib/supabase');
const { generateApiKey, hashKey } = require('../../lib/auth');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

const MAX_KEYS_PER_USER = { free: 1, starter: 3, pro: 10 };

/**
 * GET  /api/keys  → liste les clés actives de l'utilisateur
 * POST /api/keys  → génère une nouvelle clé API
 *   Body (POST) : { name? }  (nom optionnel)
 *
 * ⚠️  La clé en clair n'est retournée QU'UNE SEULE FOIS à la création.
 *     Seul son hash sha256 est stocké en base — impossible de la récupérer après.
 */
module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Authentification utilisateur
  const token = (req.headers?.['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Token invalide ou expiré. Reconnectez-vous.' });

  const supabase = getClient();

  // ── GET : liste des clés ─────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('api_keys')
      .select('id, key_prefix, name, plan, requests_today, requests_total, last_used_at, is_active, created_at, reset_date')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: 'Erreur lors de la récupération des clés.' });

    const today = new Date().toISOString().slice(0, 10);
    return res.status(200).json({
      keys: (data ?? []).map(k => ({
        ...k,
        requests_today: k.reset_date !== today ? 0 : k.requests_today,
      })),
    });
  }

  // ── POST : création d'une nouvelle clé ───────────────────────────────────
  const { name } = req.body || {};
  const keyName = (name || 'Ma clé').slice(0, 50);

  // Vérifier l'abonnement et le plan
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('plan')
    .eq('user_id', user.id)
    .single();
  const plan = sub?.plan ?? 'free';

  // Compter les clés actives existantes
  const { count } = await supabase
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('is_active', true);

  const maxKeys = MAX_KEYS_PER_USER[plan] ?? 1;
  if ((count ?? 0) >= maxKeys) {
    return res.status(403).json({
      error: `Limite atteinte : ${maxKeys} clé(s) maximum sur le plan ${plan}. Passez à un plan supérieur pour en créer davantage.`,
      upgrade_url: 'https://immodata-france.vercel.app/app',
    });
  }

  // Générer la clé
  const rawKey = generateApiKey();
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 18) + '…'; // "immo_live_XXXXXXXX…"

  const { data: inserted, error: insertError } = await supabase
    .from('api_keys')
    .insert({
      user_id:    user.id,
      key_hash:   keyHash,
      key_prefix: keyPrefix,
      name:       keyName,
      plan,
    })
    .select('id, key_prefix, name, plan, created_at')
    .single();

  if (insertError) {
    return res.status(500).json({ error: 'Erreur lors de la création de la clé.' });
  }

  return res.status(201).json({
    message: '⚠️ Copiez cette clé maintenant — elle ne sera plus affichée.',
    key: rawKey,           // ← affiché UNE SEULE FOIS
    id:         inserted.id,
    key_prefix: inserted.key_prefix,
    name:       inserted.name,
    plan:       inserted.plan,
    created_at: inserted.created_at,
  });
};
