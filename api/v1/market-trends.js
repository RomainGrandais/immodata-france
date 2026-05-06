'use strict';

const { analyserTendances } = require('../../lib/trends');
const { checkApiKey } = require('../../lib/auth');

function setHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization, X-RapidAPI-Proxy-Secret');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

/**
 * GET /v1/market-trends?adresse=Paris+10e&mois=24&type=appartement
 * GET /v1/market-trends?code_insee=75110&mois=36
 *
 * Analyse l'évolution des prix immobiliers par mois dans un secteur.
 *
 * Paramètres :
 *   adresse    (requis si pas code_insee) — adresse ou nom de ville
 *   code_insee (optionnel) — code INSEE direct (prioritaire)
 *   mois       (optionnel) — profondeur d'analyse, 12 à 60 (défaut 24)
 *   type       (optionnel) — "appartement" ou "maison"
 */
module.exports = async function handler(req, res) {
  setHeaders(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée. Utilisez GET.' });

  const authError = await checkApiKey(req);
  if (authError) return res.status(authError.status).json(authError);

  const query = req.query || {};
  const adresse = (query.adresse || '').trim() || undefined;
  const code_insee = (query.code_insee || '').trim() || undefined;

  if (!adresse && !code_insee) {
    return res.status(400).json({
      error: "Paramètre 'adresse' ou 'code_insee' requis.",
      exemple: '/v1/market-trends?adresse=Lyon+3e&mois=24',
    });
  }

  if (adresse && adresse.length < 3) {
    return res.status(400).json({ error: "Adresse trop courte (minimum 3 caractères)." });
  }

  const mois = query.mois ? parseInt(query.mois, 10) : 24;
  if (isNaN(mois) || mois < 12 || mois > 60) {
    return res.status(400).json({ error: "Paramètre 'mois' invalide (12-60)." });
  }

  const type = query.type?.toLowerCase();
  if (type && !['appartement', 'maison'].includes(type)) {
    return res.status(400).json({ error: "Type invalide. Valeurs : 'appartement', 'maison'." });
  }

  try {
    const result = await Promise.race([
      analyserTendances({ adresse, code_insee, mois, type }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 12_000)),
    ]);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json(result);
  } catch (err) {
    if (err.message === 'TIMEOUT') return res.status(503).json({ error: 'Timeout. Réessayez.' });
    if (err.code === 'ADRESSE_INTROUVABLE') return res.status(404).json({ error: err.message });
    if (err.code === 'PARAM_MANQUANT') return res.status(400).json({ error: err.message });
    console.error('[MarketTrends]', err.message);
    return res.status(500).json({ error: 'Erreur interne. Réessayez.' });
  }
};
