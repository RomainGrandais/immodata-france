'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/v1/bien');

// ── Helpers mock req/res ──────────────────────────────────────────────────────

let ipCounter = 10;

function createReq(overrides = {}) {
  // IP unique par défaut pour éviter les collisions de rate limiting entre tests
  const ip = `10.0.0.${ipCounter++}`;
  return {
    method: 'GET',
    url: '/v1/bien?adresse=12+rue+de+la+Paix+Paris',
    query: { adresse: '12 rue de la Paix Paris', format: 'raw' },
    headers: { 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
    ...overrides,
  };
}

function createRes() {
  const res = {
    _status: null,
    _body: null,
    _headers: {},
    status(code) { this._status = code; return this; },
    json(data) { this._body = data; return this; },
    end() { return this; },
    setHeader(k, v) { this._headers[k] = v; },
  };
  return res;
}

// ── Fetch mock qui simule toutes les APIs externes ────────────────────────────

const TODAY_MINUS_6M = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10);
})();

function buildFullFetchMock() {
  return async (url) => {
    if (url.includes('api-adresse.data.gouv.fr')) {
      return {
        ok: true,
        json: async () => ({
          features: [{
            properties: {
              label: '12 Rue de la Paix, 75001 Paris',
              citycode: '75056',
              postcode: '75001',
              city: 'Paris',
              score: 0.95,
            },
            geometry: { coordinates: [2.3308, 48.8697] },
          }],
        }),
      };
    }
    if (url.includes('api.cquest.org/dvf')) {
      return {
        ok: true,
        json: async () => [{
          date_mutation: TODAY_MINUS_6M,
          valeur_fonciere: '400000',
          surface_reelle_bati: '80',
          type_local: 'Appartement',
        }],
      };
    }
    if (url.includes('data.ademe.fr')) {
      return {
        ok: true,
        json: async () => ({ results: [{ etiquette_dpe: 'C' }] }),
      };
    }
    if (url.includes('geo.api.gouv.fr')) {
      return {
        ok: true,
        json: async () => ({ nom: 'Paris', population: 2161000, codesPostaux: ['75001'] }),
      };
    }
    throw new Error(`Fetch non mocké : ${url}`);
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handler bien.js', () => {
  let originalFetch;
  let originalApiKey;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    // Pas de clé → generateSummary retourne le message fallback sans appeler l'API
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  });

  it('OPTIONS → 204 sans body', async () => {
    const req = createReq({ method: 'OPTIONS' });
    const res = createRes();
    await handler(req, res);
    assert.equal(res._status, 204);
  });

  it('POST → 405 méthode non autorisée', async () => {
    const req = createReq({ method: 'POST' });
    const res = createRes();
    await handler(req, res);
    assert.equal(res._status, 405);
    assert.ok(res._body.error);
  });

  it('PUT → 405', async () => {
    const req = createReq({ method: 'PUT' });
    const res = createRes();
    await handler(req, res);
    assert.equal(res._status, 405);
  });

  it('paramètre adresse manquant → 400', async () => {
    const req = createReq({ query: {}, url: '/v1/bien' });
    const res = createRes();
    await handler(req, res);
    assert.equal(res._status, 400);
    assert.match(res._body.error, /adresse/i);
  });

  it('adresse trop courte (< 5 caractères) → 400', async () => {
    const req = createReq({ query: { adresse: 'abc' }, url: '/v1/bien?adresse=abc' });
    const res = createRes();
    await handler(req, res);
    assert.equal(res._status, 400);
  });

  it('adresse trop longue (> 200 caractères) → 400', async () => {
    const longAddr = 'a'.repeat(201);
    const req = createReq({ query: { adresse: longAddr }, url: `/v1/bien?adresse=${longAddr}` });
    const res = createRes();
    await handler(req, res);
    assert.equal(res._status, 400);
  });

  it('les security headers sont présents', async () => {
    const req = createReq({ method: 'OPTIONS' });
    const res = createRes();
    await handler(req, res);
    assert.equal(res._headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(res._headers['X-Frame-Options'], 'DENY');
    assert.equal(res._headers['Referrer-Policy'], 'no-referrer');
  });

  it('Access-Control-Allow-Headers contient x-api-key et Authorization', async () => {
    const req = createReq({ method: 'OPTIONS' });
    const res = createRes();
    await handler(req, res);
    const allowHeaders = (res._headers['Access-Control-Allow-Headers'] || '').toLowerCase();
    assert.ok(allowHeaders.includes('x-api-key'), 'x-api-key doit être autorisé');
    assert.ok(allowHeaders.includes('authorization'), 'Authorization Bearer doit être autorisé');
  });

  it('x-forwarded-for trop long (> 45 chars) → fallback sur socket', async () => {
    global.fetch = buildFullFetchMock();
    const longIp = 'x'.repeat(46);
    const req = createReq({
      headers: { 'x-forwarded-for': longIp },
      socket: { remoteAddress: '1.2.3.200' },
      query: { adresse: 'test adresse valide', format: 'raw' },
      url: '/v1/bien?adresse=test+adresse+valide',
    });
    const res = createRes();
    await handler(req, res);
    // Ne doit pas planter — le rate limit s'applique sur l'IP socket
    assert.ok([200, 400, 404, 429].includes(res._status));
  });

  it('URL inconnue → 404', async () => {
    const req = createReq({ url: '/v2/unknown' });
    const res = createRes();
    await handler(req, res);
    assert.equal(res._status, 404);
  });

  it('réponse complète avec format=raw (pas de ai_summary)', async () => {
    global.fetch = buildFullFetchMock();
    const req = createReq({ query: { adresse: '12 rue de la Paix Paris', format: 'raw' } });
    const res = createRes();

    await handler(req, res);

    assert.equal(res._status, 200);
    const body = res._body;
    assert.ok(body.adresse_normalisee);
    assert.ok(body.coordonnees);
    assert.equal(body.coordonnees.lat, 48.8697);
    assert.equal(body.coordonnees.lon, 2.3308);
    assert.ok(body.commune);
    assert.equal(body.commune.code_insee, '75056');
    assert.ok(body.marche);
    assert.equal(body.marche.prix_m2_median, 5000);
    assert.ok(body.energie);
    assert.equal(body.energie.dpe_lettre, 'C');
    assert.ok(body.reglementaire);
    assert.equal(body.reglementaire.zone_tendue, true); // Paris est en zone tendue
    assert.equal(body.ai_summary, undefined); // absent en mode raw
    assert.ok(body.meta);
    assert.ok(body.meta.generated_at);
  });

  it('réponse avec ai_summary fallback si clé absente (format=ai)', async () => {
    global.fetch = buildFullFetchMock();
    const req = createReq({ query: { adresse: '12 rue de la Paix Paris', format: 'ai' } });
    const res = createRes();

    await handler(req, res);

    assert.equal(res._status, 200);
    assert.ok(res._body.ai_summary, 'ai_summary doit être présent');
    assert.match(res._body.ai_summary, /indisponible/i);
  });

  it('adresse introuvable (BAN retourne vide) → 404', async () => {
    global.fetch = async (url) => {
      if (url.includes('api-adresse.data.gouv.fr')) {
        return { ok: true, json: async () => ({ features: [] }) };
      }
      throw new Error('Ne devrait pas être appelé');
    };

    const req = createReq({ query: { adresse: 'xyzzy adresse introuvable 99999' } });
    const res = createRes();

    await handler(req, res);

    assert.equal(res._status, 404);
    assert.match(res._body.error, /introuvable/i);
  });

  it('marche null si DVF échoue, warnings dans meta', async () => {
    global.fetch = async (url) => {
      if (url.includes('api-adresse.data.gouv.fr')) {
        return {
          ok: true,
          json: async () => ({
            features: [{
              properties: { label: '1 Rue Test, 75001 Paris', citycode: '75056', postcode: '75001', city: 'Paris', score: 0.9 },
              geometry: { coordinates: [2.33, 48.87] },
            }],
          }),
        };
      }
      if (url.includes('api.cquest.org/dvf')) {
        return { ok: false, status: 503 };
      }
      if (url.includes('data.ademe.fr')) {
        return { ok: true, json: async () => ({ results: [] }) };
      }
      if (url.includes('geo.api.gouv.fr')) {
        return { ok: true, json: async () => ({ nom: 'Paris', population: 2161000, codesPostaux: ['75001'] }) };
      }
    };

    const req = createReq({ query: { adresse: '1 rue Test Paris', format: 'raw' } });
    const res = createRes();
    await handler(req, res);

    assert.equal(res._status, 200);
    assert.equal(res._body.marche.message, 'Données insuffisantes dans ce secteur');
    assert.ok(res._body.meta.warnings.includes('DVF indisponible temporairement'));
  });

  it('rate limiting : 101e requête depuis la même IP → 429', async () => {
    global.fetch = buildFullFetchMock();
    const ip = '192.168.99.99';

    for (let i = 0; i < 100; i++) {
      const req = createReq({
        headers: { 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
        query: { adresse: 'test adresse valide', format: 'raw' },
        url: '/v1/bien?adresse=test+adresse+valide',
      });
      const res = createRes();
      await handler(req, res);
    }

    const req101 = createReq({
      headers: { 'x-forwarded-for': ip },
      socket: { remoteAddress: ip },
      query: { adresse: 'test adresse valide', format: 'raw' },
      url: '/v1/bien?adresse=test+adresse+valide',
    });
    const res101 = createRes();
    await handler(req101, res101);

    assert.equal(res101._status, 429);
    assert.match(res101._body.error, /requêtes/i);
  });
});
