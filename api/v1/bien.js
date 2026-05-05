'use strict';

const { geocode } = require('../../lib/ban');
const { getMarche } = require('../../lib/dvf');
const { getEnergie } = require('../../lib/dpe');
const { getCommune } = require('../../lib/insee');
const { generateSummary } = require('../../lib/summary');
const { isZoneTendue } = require('../../lib/zoneTendue');

// ── Rate limiting en mémoire (100 req/min par IP) ──────────────────────────
const rateMap = new Map(); // ip → { count, windowStart }
const RATE_LIMIT = 100;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateMap.set(ip, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= RATE_LIMIT) return false;

  entry.count++;
  return true;
}

// Nettoyage périodique pour éviter la fuite mémoire
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [ip, entry] of rateMap) {
    if (entry.windowStart < cutoff) rateMap.delete(ip);
  }
}, RATE_WINDOW_MS).unref(); // ne bloque pas la sortie du process (tests, scripts)

// ── Extraction IP robuste ──────────────────────────────────────────────────
// Sur Vercel, x-forwarded-for est injecté par l'edge — la première adresse
// est toujours le vrai client. On la sanitize pour éviter tout caractère bizarre.
function extractIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    // Accepte IPv4, IPv6 et loopback — rejette toute valeur forgée > 45 chars
    if (first.length <= 45) return first;
  }
  return req.socket?.remoteAddress || 'unknown';
}

// ── Headers ────────────────────────────────────────────────────────────────
function setResponseHeaders(res) {
  // CORS : API publique en lecture seule, pas de cookie ni d'auth
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Sécurité transport / rendu
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

// ── Validation des paramètres ──────────────────────────────────────────────
const ADRESSE_MIN = 5;
const ADRESSE_MAX = 200;

function validateAdresse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const v = raw.trim();
  if (v.length < ADRESSE_MIN || v.length > ADRESSE_MAX) return null;
  return v;
}

// ── Handler principal (compatible Vercel serverless) ───────────────────────
module.exports = async function handler(req, res) {
  setResponseHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée. Utilisez GET.' });
  }

  // Route guard : on n'accepte que /v1/bien
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname !== '/v1/bien' && pathname !== '/api/v1/bien') {
    return res.status(404).json({ error: 'Endpoint introuvable. Utilisez GET /v1/bien?adresse=...' });
  }

  // Rate limiting
  const ip = extractIp(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({
      error: 'Trop de requêtes. Limite : 100 requêtes/minute par IP.',
    });
  }

  // Validation des paramètres d'entrée
  const rawAdresse = (req.query || {}).adresse;
  const adresse = validateAdresse(rawAdresse);

  if (!adresse) {
    return res.status(400).json({
      error: `Paramètre 'adresse' obligatoire, entre ${ADRESSE_MIN} et ${ADRESSE_MAX} caractères (ex: ?adresse=12 rue de la Paix Lyon).`,
    });
  }

  // Le paramètre format n'accepte que les valeurs connues
  const rawFormat = (req.query || {}).format;
  const format = rawFormat === 'raw' ? 'raw' : 'ai';

  // Timeout global 10 secondes
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('TIMEOUT')), 10_000)
  );

  try {
    const result = await Promise.race([
      buildResponse(adresse, format),
      timeoutPromise,
    ]);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(result);
  } catch (err) {
    if (err.message === 'TIMEOUT') {
      return res.status(503).json({
        error: 'Délai d\'attente dépassé (10s). Les sources de données sont lentes. Réessayez.',
      });
    }

    if (err.code === 'ADRESSE_INTROUVABLE') {
      return res.status(404).json({ error: err.message });
    }

    // Ne jamais exposer les détails de l'erreur interne au client
    console.error('[ImmoData]', err.name, err.message);
    return res.status(500).json({ error: 'Erreur interne. Réessayez dans quelques instants.' });
  }
};

// ── Logique métier centrale ────────────────────────────────────────────────
async function buildResponse(adresse, format) {
  // 1. Géocodage BAN (bloquant — nécessaire pour la suite)
  const geo = await geocode(adresse);
  if (!geo) {
    const err = new Error('Adresse introuvable. Vérifiez l\'orthographe.');
    err.code = 'ADRESSE_INTROUVABLE';
    throw err;
  }

  const { lat, lon, code_insee, adresse_normalisee } = geo;

  // 2. Appels parallèles une fois les coordonnées connues
  const [marcheRaw, energieRaw, communeRaw] = await Promise.allSettled([
    getMarche(lat, lon),
    getEnergie(lat, lon),
    getCommune(code_insee),
  ]);

  const marche = marcheRaw.status === 'fulfilled' ? marcheRaw.value : null;
  const energie = energieRaw.status === 'fulfilled' ? energieRaw.value : null;
  const commune = communeRaw.status === 'fulfilled' ? communeRaw.value : {
    nom: geo.ville,
    code_insee,
    population: null,
    codes_postaux: [geo.code_postal],
  };

  const zoneTendue = isZoneTendue(code_insee);

  const reglementaire = {
    zone_tendue: zoneTendue,
    // L'encadrement des loyers est une sous-mesure de la zone tendue,
    // activée par arrêté municipal — non détectable via open data seul
    encadrement_loyers: false,
  };

  // 3. Génération du résumé IA (format "ai" uniquement)
  let ai_summary = null;
  if (format !== 'raw') {
    try {
      ai_summary = await generateSummary({
        adresse: adresse_normalisee,
        commune,
        marche,
        energie,
        reglementaire,
      });
    } catch (e) {
      ai_summary = 'Résumé IA temporairement indisponible.';
    }
  }

  // 4. Construction de la réponse finale
  const payload = {
    adresse_normalisee,
    coordonnees: { lat, lon },
    commune: {
      nom: commune.nom,
      code_insee: commune.code_insee,
      population: commune.population,
    },
    marche: marche ?? {
      prix_m2_median: null,
      nb_transactions_24m: 0,
      tendance_12m: null,
      derniere_transaction: null,
      message: 'Données insuffisantes dans ce secteur',
    },
    energie: energie ?? null,
    reglementaire,
    meta: {
      sources: ['BAN', 'DVF', 'DPE-ADEME', 'INSEE'],
      generated_at: new Date().toISOString(),
      rayon_metres: 500,
    },
  };

  if (format !== 'raw') {
    payload.ai_summary = ai_summary;
  }

  // Avertissements si des sources ont échoué
  const warnings = [];
  if (marcheRaw.status === 'rejected') warnings.push('DVF indisponible temporairement');
  if (energieRaw.status === 'rejected') warnings.push('DPE ADEME indisponible temporairement');
  if (communeRaw.status === 'rejected') warnings.push('INSEE indisponible temporairement');
  if (warnings.length > 0) payload.meta.warnings = warnings;

  return payload;
}
