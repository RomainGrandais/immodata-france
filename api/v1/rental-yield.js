'use strict';

const { calculerRendement } = require('../../lib/rental');
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
 * GET /v1/rental-yield?adresse=...&surface=80&loyer_mensuel=800
 *
 * Calcule le rendement locatif brut et net d'un bien.
 *
 * Paramètres :
 *   adresse           (requis) — adresse complète
 *   surface           (recommandé) — surface en m²
 *   loyer_mensuel     (optionnel) — loyer mensuel réel en € (sinon estimé)
 *   prix_achat        (optionnel) — prix d'achat connu en € (sinon estimé via DVF)
 *   charges_annuelles (optionnel) — charges annuelles en € (sinon ~30% du loyer)
 *   type              (optionnel) — "appartement" ou "maison"
 */
module.exports = async function handler(req, res) {
  setHeaders(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée. Utilisez GET.' });

  const authError = await checkApiKey(req);
  if (authError) return res.status(authError.status).json(authError);

  const query = req.query || {};
  const adresse = (query.adresse || '').trim();
  if (!adresse || adresse.length < 5 || adresse.length > 200) {
    return res.status(400).json({
      error: "Paramètre 'adresse' obligatoire, entre 5 et 200 caractères.",
      exemple: '/v1/rental-yield?adresse=12+rue+de+la+Paix+Paris&surface=80&loyer_mensuel=1200',
    });
  }

  const surface = query.surface ? parseFloat(query.surface) : undefined;
  if (surface !== undefined && (isNaN(surface) || surface <= 0 || surface > 2000)) {
    return res.status(400).json({ error: "Surface invalide (1-2000 m²)." });
  }

  const loyer_mensuel = query.loyer_mensuel ? parseFloat(query.loyer_mensuel) : undefined;
  if (loyer_mensuel !== undefined && (isNaN(loyer_mensuel) || loyer_mensuel <= 0 || loyer_mensuel > 50000)) {
    return res.status(400).json({ error: "Loyer mensuel invalide." });
  }

  const prix_achat = query.prix_achat ? parseFloat(query.prix_achat) : undefined;
  if (prix_achat !== undefined && (isNaN(prix_achat) || prix_achat <= 0)) {
    return res.status(400).json({ error: "Prix d'achat invalide." });
  }

  const charges_annuelles = query.charges_annuelles ? parseFloat(query.charges_annuelles) : undefined;
  const type = query.type?.toLowerCase();
  if (type && !['appartement', 'maison'].includes(type)) {
    return res.status(400).json({ error: "Type invalide. Valeurs : 'appartement', 'maison'." });
  }

  try {
    const result = await Promise.race([
      calculerRendement({ adresse, surface, type, loyer_mensuel, prix_achat, charges_annuelles }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 12_000)),
    ]);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
    return res.status(200).json(result);
  } catch (err) {
    if (err.message === 'TIMEOUT') return res.status(503).json({ error: 'Timeout. Réessayez.' });
    if (err.code === 'ADRESSE_INTROUVABLE') return res.status(404).json({ error: err.message });
    console.error('[RentalYield]', err.message);
    return res.status(500).json({ error: 'Erreur interne. Réessayez.' });
  }
};
