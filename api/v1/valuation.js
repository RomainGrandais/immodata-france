'use strict';

const { estimerValeur } = require('../../lib/valuation');
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
 * GET /v1/valuation?adresse=...&surface=80&type=appartement
 *
 * Estime la valeur d'un bien immobilier à partir de transactions comparables DVF.
 *
 * Paramètres :
 *   adresse  (requis) — adresse complète
 *   surface  (optionnel) — surface en m² → calcule la valeur totale estimée
 *   type     (optionnel) — "appartement" ou "maison" → filtre les comparables
 */
module.exports = async function handler(req, res) {
  setHeaders(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée. Utilisez GET.' });

  // Auth
  const authError = await checkApiKey(req);
  if (authError) return res.status(authError.status).json(authError);

  // Params
  const query = req.query || {};
  const adresse = (query.adresse || '').trim();
  if (!adresse || adresse.length < 5 || adresse.length > 200) {
    return res.status(400).json({
      error: "Paramètre 'adresse' obligatoire, entre 5 et 200 caractères.",
      exemple: '/v1/valuation?adresse=12+rue+de+la+Paix+Paris&surface=80&type=appartement',
    });
  }

  const surface = query.surface ? parseFloat(query.surface) : undefined;
  if (surface !== undefined && (isNaN(surface) || surface <= 0 || surface > 2000)) {
    return res.status(400).json({ error: "Surface invalide (1-2000 m²)." });
  }

  const type = query.type?.toLowerCase();
  if (type && !['appartement', 'maison'].includes(type)) {
    return res.status(400).json({ error: "Type invalide. Valeurs acceptées : 'appartement', 'maison'." });
  }

  try {
    const result = await Promise.race([
      estimerValeur({ adresse, surface, type }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 12_000)),
    ]);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
    return res.status(200).json(result);
  } catch (err) {
    if (err.message === 'TIMEOUT') return res.status(503).json({ error: 'Timeout. Réessayez.' });
    if (err.code === 'ADRESSE_INTROUVABLE') return res.status(404).json({ error: err.message });
    console.error('[Valuation]', err.message);
    return res.status(500).json({ error: 'Erreur interne. Réessayez.' });
  }
};
