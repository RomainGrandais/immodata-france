'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/v1/market-trends');

let ipCounter = 400;

function createReq(overrides = {}) {
  const ip = `10.0.2.${ipCounter++}`;
  return {
    method: 'GET',
    url: '/v1/market-trends?adresse=Paris',
    query: { adresse: 'Paris' },
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

// Générer 24 mois de transactions mock
const MOCK_TRANSACTIONS = [];
for (let m = 0; m < 24; m++) {
  for (let j = 0; j < 3; j++) {
    const d = new Date();
    d.setMonth(d.getMonth() - m);
    d.setDate(j + 5);
    MOCK_TRANSACTIONS.push({
      date_mutation: d.toISOString().slice(0, 10),
      valeur_fonciere: String(300000 + m * 2000 + j * 5000),
      surface_reelle_bati: String(60 + j * 10),
      type_local: j === 0 ? 'Maison' : 'Appartement',
      nombre_pieces_principales: '3',
    });
  }
}

function buildMock() {
  return async (url) => {
    if (url.includes('api-adresse.data.gouv.fr'))
      return { ok: true, json: async () => ({ features: [{ properties: { label: 'Paris', citycode: '75056', postcode: '75001', city: 'Paris', score: 0.9 }, geometry: { coordinates: [2.35, 48.86] } }] }) };
    if (url.includes('api.cquest.org/dvf'))
      return { ok: true, json: async () => MOCK_TRANSACTIONS };
    if (url.includes('geo.api.gouv.fr'))
      return { ok: true, json: async () => ({ nom: 'Paris', population: 2161000, codesPostaux: ['75001'] }) };
    throw new Error(`Fetch non mocké : ${url}`);
  };
}

describe('GET /v1/market-trends', () => {
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

  it('ni adresse ni code_insee → 400', async () => {
    const res = createRes();
    await handler(createReq({ query: {} }), res);
    assert.equal(res._status, 400);
    assert.match(res._body.error, /adresse|code_insee/i);
  });

  it('mois invalide → 400', async () => {
    const res = createRes();
    await handler(createReq({ query: { adresse: 'Paris', mois: '5' } }), res);
    assert.equal(res._status, 400);
    assert.match(res._body.error, /mois/i);
  });

  it('retourne une timeline avec tendances', async () => {
    global.fetch = buildMock();
    const res = createRes();
    await handler(createReq({ query: { adresse: 'Paris', mois: '24' } }), res);

    assert.equal(res._status, 200);
    const body = res._body;
    assert.ok(body.tendances, 'tendances doit être présent');
    assert.ok(body.tendances.prix_m2_median > 0);
    assert.ok(body.tendances.nb_transactions > 0);
    assert.ok(['hausse', 'baisse', 'stable'].includes(body.tendances.tendance));
    assert.ok(body.timeline.length > 0);
    // Chaque point de la timeline doit avoir les champs attendus
    const first = body.timeline[0];
    assert.ok(first.mois);
    assert.ok(first.prix_m2_median > 0);
    assert.ok(first.nb_transactions > 0);
  });

  it('filtre par type appartement', async () => {
    global.fetch = buildMock();
    const res = createRes();
    await handler(createReq({ query: { adresse: 'Paris', type: 'appartement' } }), res);

    assert.equal(res._status, 200);
    assert.ok(res._body.tendances);
  });

  it('retourne code_insee et zone_tendue', async () => {
    global.fetch = buildMock();
    const res = createRes();
    await handler(createReq({ query: { adresse: 'Paris' } }), res);

    assert.equal(res._status, 200);
    assert.equal(res._body.code_insee, '75056');
    assert.equal(res._body.zone_tendue, true); // Paris
  });
});
