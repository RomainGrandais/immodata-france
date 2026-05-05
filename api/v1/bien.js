'use strict';

const { buildResponse } = require('../../lib/core');
const { checkApiKey } = require('../../lib/auth');

// ── Rate limiting en mémoire (100 req/min par IP) ──────────────────────────
const rateMap = new Map();
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

setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [ip, entry] of rateMap) {
    if (entry.windowStart < cutoff) rateMap.delete(ip);
  }
}, RATE_WINDOW_MS).unref();

// ── Extraction IP sanitizée ────────────────────────────────────────────────
function extractIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first.length <= 45) return first;
  }
  return req.socket?.remoteAddress || 'unknown';
}

// ── Headers de réponse ─────────────────────────────────────────────────────
function setResponseHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

// ── Validation adresse ─────────────────────────────────────────────────────
const ADRESSE_MIN = 5;
const ADRESSE_MAX = 200;

function validateAdresse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const v = raw.trim();
  if (v.length < ADRESSE_MIN || v.length > ADRESSE_MAX) return null;
  return v;
}

// ── Handler principal ──────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  setResponseHeaders(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée. Utilisez GET.' });
  }

  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname !== '/v1/bien' && pathname !== '/api/v1/bien') {
    return res.status(404).json({ error: 'Endpoint introuvable. Utilisez GET /v1/bien?adresse=...' });
  }

  // Auth (async — vérifie la DB Supabase en production, env var en dev)
  const authError = await checkApiKey(req);
  if (authError) return res.status(authError.status).json(authError);

  // Rate limiting
  const ip = extractIp(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Trop de requêtes. Limite : 100 requêtes/minute par IP.' });
  }

  // Validation des paramètres
  const adresse = validateAdresse((req.query || {}).adresse);
  if (!adresse) {
    return res.status(400).json({
      error: `Paramètre 'adresse' obligatoire, entre ${ADRESSE_MIN} et ${ADRESSE_MAX} caractères.`,
    });
  }

  const format = (req.query || {}).format === 'raw' ? 'raw' : 'ai';

  // Timeout global 10s
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('TIMEOUT')), 10_000)
  );

  try {
    const result = await Promise.race([buildResponse(adresse, format), timeout]);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(result);
  } catch (err) {
    if (err.message === 'TIMEOUT') {
      return res.status(503).json({ error: 'Délai d\'attente dépassé (10s). Réessayez.' });
    }
    if (err.code === 'ADRESSE_INTROUVABLE') {
      return res.status(404).json({ error: err.message });
    }
    console.error('[ImmoData]', err.name, err.message);
    return res.status(500).json({ error: 'Erreur interne. Réessayez dans quelques instants.' });
  }
};
