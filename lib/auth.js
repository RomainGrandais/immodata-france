'use strict';

// Clés valides chargées depuis l'env au démarrage du process
// Format : API_KEYS="immo_live_abc123,immo_live_def456"
// Sur Vercel, configurez cette variable dans les settings du projet.
function getValidKeys() {
  return new Set(
    (process.env.API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean)
  );
}

function extractKey(req) {
  // 1. Header x-api-key (recommandé)
  const xApiKey = req.headers?.['x-api-key'];
  if (xApiKey) return xApiKey.trim();

  // 2. Authorization: Bearer <key>
  const auth = req.headers?.['authorization'];
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();

  // 3. Query param ?apikey= (moins sécurisé — apparaît dans les logs serveur)
  return (req.query || {}).apikey || null;
}

// Retourne null si OK, ou un objet { status, error } si refusé
function checkApiKey(req) {
  // Si aucune clé configurée → mode développement local, on laisse passer
  const validKeys = getValidKeys();
  if (validKeys.size === 0) return null;

  const key = extractKey(req);
  if (!key) {
    return {
      status: 401,
      error: 'Clé API manquante. Ajoutez le header x-api-key: <votre_clé>.',
      docs: 'https://immodata-france.vercel.app/docs',
    };
  }

  if (!validKeys.has(key)) {
    return {
      status: 403,
      error: 'Clé API invalide ou expirée.',
      docs: 'https://immodata-france.vercel.app/docs',
    };
  }

  return null; // OK
}

module.exports = { checkApiKey, extractKey };
