'use strict';

const { getClient } = require('../../lib/supabase');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * POST /api/auth/login
 * Body : { email, password }
 *
 * Retourne les tokens de session Supabase.
 * Le access_token sert ensuite à appeler les endpoints protégés
 * via le header : Authorization: Bearer <access_token>
 */
module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email et password sont requis.' });
  }

  const supabase = getClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data?.session) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
  }

  return res.status(200).json({
    access_token:  data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in:    data.session.expires_in,
    user: {
      id:    data.user.id,
      email: data.user.email,
    },
  });
};
