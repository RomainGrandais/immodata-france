'use strict';

const { getClient } = require('../../lib/supabase');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * POST /api/auth/register
 * Body : { email, password }
 *
 * Crée un compte Supabase Auth + une subscription "free" par défaut.
 * Retourne un message de confirmation (vérification email requise).
 */
module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email et password sont requis.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
  }

  const supabase = getClient();

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    // Masquer les détails techniques
    const msg = error.message.includes('already') || error.message.includes('duplicate')
      ? 'Un compte existe déjà avec cet email.'
      : 'Erreur lors de la création du compte. Réessayez.';
    return res.status(400).json({ error: msg });
  }

  const userId = data?.user?.id;
  if (userId) {
    // Créer une subscription gratuite par défaut
    await supabase.from('subscriptions').upsert(
      { user_id: userId, plan: 'free', status: 'active' },
      { onConflict: 'user_id', ignoreDuplicates: true }
    );
  }

  return res.status(201).json({
    message: 'Compte créé avec succès. Vérifiez votre email pour confirmer votre inscription.',
    user_id: userId ?? null,
  });
};
