'use strict';

const { createClient } = require('@supabase/supabase-js');

/**
 * Client Supabase côté serveur (service_role — accès total, ne jamais exposer côté client).
 * Utilisé par tous les endpoints API pour lire/écrire dans la DB.
 *
 * Variables d'environnement requises :
 *   SUPABASE_URL          https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY  clé service_role (Settings → API dans le dashboard Supabase)
 */
function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      'Variables manquantes : SUPABASE_URL et SUPABASE_SERVICE_KEY doivent être définies dans Vercel.'
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,      // serverless — pas de stockage de session
      autoRefreshToken: false,
    },
  });
}

/**
 * Valide un JWT utilisateur (token retourné au login) côté serveur.
 * Retourne l'objet user Supabase, ou null si le token est invalide.
 */
async function getUserFromToken(token) {
  if (!token) return null;
  try {
    const supabase = getClient();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

module.exports = { getClient, getUserFromToken };
