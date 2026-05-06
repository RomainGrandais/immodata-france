'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/v1/rental-yield');

let ipCounter = 300;

function createReq(overrides = {}) {
  const ip = `10.0.1.${ipCounter++}`;
  return {
    method: 'GET',
    url: '/v1/rental-yield?adresse=12+rue+de+la+Paix+Paris&surface=80',
    query: { adresse: '12 rue de la Paix Paris', surface: '80' },
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
    if (url.includes('api-adresse.data.gouv.fr'))
      return { ok: true, json: async () => ({ features: [{ properties: { label: '12 Rue de la Paix, 75001 Paris', citycode: '75056', postcode: '75001', city: 'Paris', score: 0.95 }, geometry: { coordinates: [2.3308, 48.8697] } }] }) };
    if (url.includes('api.cquest.org/dvf'))
      return { ok: true, json: async () => MOCK_TRANSACTIONS };
    if (url.includes('data.ademe.fr'))
      return { ok: true, json: async () => ({ results: [{ etiquette_dpe: 'C' }] }) };
    if (url.includes('geo.api.gouv.fr'))
      return { ok: true, json: async () => ({ nom: 'Paris', population: 2161000, codesPostaux: ['75001'] }) };
    throw new Error(`Fetch non mocké : ${url}`);
  };
}

describe('GET /v1/rental-yield', () => {
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

  it('adresse manquante → 400', async () => {
    const res = createRes();
    await handler(createReq({ query: {} }), res);
    assert.equal(res._status, 400);
  });

  it('retourne un rendement brut et net', async () => {
    global.fetch = buildMock();
    const res = createRes();
    await handler(createReq({ query: { adresse: '12 rue de la Paix Paris', surface: '80', loyer_mensuel: '1200' } }), res);

    assert.equal(res._status, 200);
    const r = res._body.rendement;
    assert.ok(r, 'rendement doit être présent');
    assert.ok(r.rendement_brut_pct > 0, 'rendement_brut_pct positif');
    assert.ok(r.rendement_net_pct > 0, 'rendement_net_pct positif');
    assert.ok(r.rendement_net_pct < r.rendement_brut_pct, 'net < brut');
    assert.equal(r.loyer_mensuel, 1200);
    assert.equal(r.loyer_est_estime, false);
  });

  it('estime le loyer si non fourni', async () => {
    global.fetch = buildMock();
    const res = createRes();
    await handler(createReq({ query: { adresse: '12 rue de la Paix Paris', surface: '80' } }), res);

    assert.equal(res._status, 200);
    const r = res._body.rendement;
    assert.ok(r);
    assert.equal(r.loyer_est_estime, true);
    assert.ok(r.loyer_mensuel > 0);
  });

  it('utilise le prix_achat fourni', async () => {
    global.fetch = buildMock();
    const res = createRes();
    await handler(createReq({ query: { adresse: '12 rue de la Paix Paris', surface: '80', prix_achat: '500000', loyer_mensuel: '1500' } }), res);

    assert.equal(res._status, 200);
    assert.equal(res._body.rendement.prix_achat, 500000);
    assert.equal(res._body.rendement.prix_achat_est_estime, false);
  });

  it('verdict qualitatif est présent', async () => {
    global.fetch = buildMock();
    const res = createRes();
    await handler(createReq({ query: { adresse: '12 rue de la Paix Paris', surface: '80', loyer_mensuel: '1200' } }), res);
    assert.ok(res._body.rendement.verdict);
  });
});
