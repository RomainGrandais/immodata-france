'use strict';

const { getClient, getUserFromToken } = require('../../lib/supabase');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * POST /api/keys/revoke
 * Header : Authorization: Bearer <access_token>
 * Body   : { key_id: "uuid" }
 *
 * Désactive une clé API. L'opération est irréversible — l'utilisateur
 * doit générer une nouvelle clé s'il veut en utiliser une.
 */
module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const token = (req.headers?.['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Token invalide ou expiré. Reconnectez-vous.' });

  const { key_id } = req.body || {};
  if (!key_id) return res.status(400).json({ error: 'key_id est requis.' });

  const supabase = getClient();

  // Vérifier que la clé appartient bien à cet utilisateur
  const { data: key } = await supabase
    .from('api_keys')
    .select('id, is_active')
    .eq('id', key_id)
    .eq('user_id', user.id)
    .single();

  if (!key) return res.status(404).json({ error: 'Clé introuvable.' });
  if (!key.is_active) return res.status(409).json({ error: 'Cette clé est déjà révoquée.' });

  const { error } = await supabase
    .from('api_keys')
    .update({ is_active: false })
    .eq('id', key_id)
    .eq('user_id', user.id);

  if (error) return res.status(500).json({ error: 'Erreur lors de la révocation.' });

  return res.status(200).json({ message: 'Clé révoquée avec succès.' });
};
