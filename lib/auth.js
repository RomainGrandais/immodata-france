'use strict';

const crypto = require('crypto');

// ── Extraction de la clé API depuis la requête ────────────────────────────────

function extractKey(req) {
  // 1. Header x-api-key (recommandé)
  const xApiKey = req.headers?.['x-api-key'];
  if (xApiKey) return xApiKey.trim();

  // 2. Authorization: Bearer <key>
  const auth = req.headers?.['authorization'];
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();

  // 3. Query param ?apikey= (moins sécurisé — apparaît dans les logs serveur)
  const q = (req.query || {}).apikey;
  if (q) return q.trim();

  return null;
}

// ── Hachage + génération de clés ──────────────────────────────────────────────

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function generateApiKey() {
  // Format : immo_live_XXXXXXXXXXXXXXXXXXXXXXXX (32 chars aléatoires base64url)
  const random = crypto.randomBytes(24).toString('base64url').slice(0, 28);
  return `immo_live_${random}`;
}

// ── Mode legacy : clés dans la variable d'environnement API_KEYS ──────────────

function getLegacyKeys() {
  return new Set(
    (process.env.API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean)
  );
}

// ── Vérification clé API (async — supporte les deux modes) ───────────────────

/**
 * Retourne null si la clé est valide, ou { status, error, docs } si refusée.
 *
 * Mode RapidAPI : X-RapidAPI-Proxy-Secret présent et valide → OK (billing géré par RapidAPI).
 * Mode A (legacy) : API_KEYS défini dans l'env → vérification locale.
 * Mode B (production) : SUPABASE_URL défini → vérification en base de données.
 * Mode C (dev) : aucune config → pass-through (accès libre en local).
 */
async function checkApiKey(req) {
  // ── Mode RapidAPI : header proxy secret ───────────────────────────────────
  const rapidSecret = process.env.RAPIDAPI_PROXY_SECRET;
  if (rapidSecret) {
    const incoming = req.headers?.['x-rapidapi-proxy-secret'];
    if (incoming === rapidSecret) return null; // Requête venant de RapidAPI — OK
  }

  // ── Mode A : legacy env var ───────────────────────────────────────────────
  const legacyKeys = getLegacyKeys();
  if (legacyKeys.size > 0) {
    const key = extractKey(req);
    if (!key) {
      return {
        status: 401,
        error: 'Clé API manquante. Ajoutez le header x-api-key: <votre_clé>.',
        docs: 'https://immodata-france.vercel.app/docs',
      };
    }
    if (!legacyKeys.has(key)) {
      return {
        status: 403,
        error: 'Clé API invalide ou expirée.',
        docs: 'https://immodata-france.vercel.app/docs',
      };
    }
    return null; // OK
  }

  // ── Mode C : développement local sans DB ──────────────────────────────────
  if (!process.env.SUPABASE_URL) return null;

  // ── Mode B : vérification en base de données ──────────────────────────────
  const key = extractKey(req);
  if (!key) {
    return {
      status: 401,
      error: 'Clé API manquante. Ajoutez le header x-api-key: <votre_clé>.',
      docs: 'https://immodata-france.vercel.app/docs',
    };
  }

  const { getClient } = require('./supabase');
  const supabase = getClient();
  const keyHash = hashKey(key);

  const { data, error } = await supabase
    .from('api_keys')
    .select('id, plan, is_active, requests_today, requests_total, reset_date')
    .eq('key_hash', keyHash)
    .single();

  if (error || !data) {
    return {
      status: 403,
      error: 'Clé API invalide ou expirée.',
      docs: 'https://immodata-france.vercel.app/docs',
    };
  }
  if (!data.is_active) {
    return {
      status: 403,
      error: 'Clé API désactivée. Générez une nouvelle clé dans votre dashboard.',
      docs: 'https://immodata-france.vercel.app/app',
    };
  }

  // Limites par plan (req/jour)
  const planLimits = { free: 100, starter: 1_000, pro: 10_000 };
  const limit = planLimits[data.plan] ?? 100;

  // Reset du compteur si on a changé de jour
  const today = new Date().toISOString().slice(0, 10);
  const requestsToday = data.reset_date !== today ? 0 : (data.requests_today ?? 0);

  if (requestsToday >= limit) {
    return {
      status: 429,
      error: `Limite journalière atteinte (${limit} req/jour sur le plan ${data.plan}). Upgradez sur https://immodata-france.vercel.app/app`,
      docs: 'https://immodata-france.vercel.app/app',
    };
  }

  // Mise à jour du compteur en arrière-plan (ne bloque pas la réponse)
  const updates = {
    requests_total: (data.requests_total ?? 0) + 1,
    last_used_at: new Date().toISOString(),
  };
  if (data.reset_date !== today) {
    updates.requests_today = 1;
    updates.reset_date = today;
  } else {
    updates.requests_today = requestsToday + 1;
  }
  supabase.from('api_keys').update(updates).eq('id', data.id).then(() => {});

  return null; // OK
}

module.exports = { checkApiKey, extractKey, hashKey, generateApiKey };
