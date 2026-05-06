'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/v1/valuation');

// ── Helpers ──────────────────────────────────────────────────────────────────

let ipCounter = 200;

function createReq(overrides = {}) {
  const ip = `10.0.0.${ipCounter++}`;
  return {
    method: 'GET',
    url: '/v1/valuation?adresse=12+rue+de+la+Paix+Paris',
    query: { adresse: '12 rue de la Paix Paris' },
    headers: { 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
    ...overrides,
  };
}

function createRes() {
  return {
    _status: null, _body: null, _headers: {},
    status(c) { this._status = c; return this; },
    json(d)   { this._body = d; return this; },
    end()     { return this; },
    setHeader(k, v) { this._headers[k] = v; },
  };
}

// ── Mock DVF avec transactions variées ───────────────────────────────────────

const MOCK_TRANSACTIONS = [];
for (let i = 0; i < 8; i++) {
  const d = new Date();
  d.setMonth(d.getMonth() - (i * 3));
  MOCK_TRANSACTIONS.push({
    date_mutation: d.toISOString().slice(0, 10),
    valeur_fonciere: String(350000 + i * 10000),
    surface_reelle_bati: '70',
    type_local: 'Appartement',
    nombre_pieces_principales: '3',
  });
}

function buildMock() {
  return async (url) => {
    if (url.includes('api-adresse.data.gouv.fr')) {
      return {
        ok: true,
        json: async () => ({
          features: [{
            properties: { label: '12 Rue de la Paix, 75001 Paris', citycode: '75056', postcode: '75001', city: 'Paris', score: 0.95 },
            geometry: { coordinates: [2.3308, 48.8697] },
          }],
        }),
      };
    }
    if (url.includes('api.cquest.org/dvf')) {
      return { ok: true, json: async () => MOCK_TRANSACTIONS };
    }
    if (url.includes('data.ademe.fr')) {
      return { ok: true, json: async () => ({ results: [{ etiquette_dpe: 'C' }] }) };
    }
    if (url.includes('geo.api.gouv.fr')) {
      return { ok: true, json: async () => ({ nom: 'Paris', population: 2161000, codesPostaux: ['75001'] }) };
    }
    throw new Error(`Fetch non mocké : ${url}`);
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /v1/valuation', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    delete process.env.API_KEYS;
    delete process.env.SUPABASE_URL;
  });

  afterEach(() => { global.fetch = originalFetch; });

  it('OPTIONS → 204', async () => {
    const res = createRes();
    await handler(createReq({ method: 'OPTIONS' }), res);
    assert.equal(res._status, 204);
  });

  it('POST → 405', async () => {
    const res = createRes();
    await handler(createReq({ method: 'POST' }), res);
    assert.equal(res._status, 405);
  });

  it('adresse manquante → 400', async () => {
    const res = createRes();
    await handler(createReq({ query: {} }), res);
    assert.equal(res._status, 400);
    assert.match(res._body.error, /adresse/i);
  });

  it('surface invalide → 400', async () => {
    const res = createRes();
    await handler(createReq({ query: { adresse: 'Paris test valide', surface: '-10' } }), res);
    assert.equal(res._status, 400);
    assert.match(res._body.error, /surface/i);
  });

  it('type invalide → 400', async () => {
    const res = createRes();
    await handler(createReq({ query: { adresse: 'Paris test valide', type: 'villa' } }), res);
    assert.equal(res._status, 400);
    assert.match(res._body.error, /type/i);
  });

  it('retourne une estimation avec prix/m² et comparables', async () => {
    global.fetch = buildMock();
    const res = createRes();
    await handler(createReq({ query: { adresse: '12 rue de la Paix Paris', surface: '80' } }), res);

    assert.equal(res._status, 200);
    const body = res._body;
    assert.ok(body.adresse_normalisee);
    assert.ok(body.estimation);
    assert.ok(body.estimation.prix_m2_median > 0);
    assert.ok(body.estimation.valeur_estimee > 0);
    assert.ok(body.estimation.fourchette_basse < body.estimation.valeur_estimee);
    assert.ok(body.estimation.fourchette_haute > body.estimation.valeur_estimee);
    assert.ok(body.comparables.length > 0);
    assert.ok(body.meta.sources.includes('DVF'));
  });

  it('retourne estimation sans valeur totale si surface non fournie', async () => {
    global.fetch = buildMock();
    const res = createRes();
    await handler(createReq({ query: { adresse: '12 rue de la Paix Paris' } }), res);

    assert.equal(res._status, 200);
    assert.ok(res._body.estimation.prix_m2_median > 0);
    assert.equal(res._body.estimation.valeur_estimee, null);
  });

  it('adresse introuvable → 404', async () => {
    global.fetch = async (url) => {
      if (url.includes('api-adresse.data.gouv.fr')) {
        return { ok: true, json: async () => ({ features: [] }) };
      }
      throw new Error('Non mocké');
    };
    const res = createRes();
    await handler(createReq({ query: { adresse: 'xxxxx introuvable 99999' } }), res);
    assert.equal(res._status, 404);
  });
});
