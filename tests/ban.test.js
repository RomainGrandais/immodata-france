'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { geocode } = require('../lib/ban');

function mockBanResponse(features = []) {
  return {
    ok: true,
    json: async () => ({ features }),
  };
}

const FEATURE_PARIS = {
  properties: {
    label: '12 Rue de la Paix, 75001 Paris',
    citycode: '75056',
    postcode: '75001',
    city: 'Paris',
    score: 0.95,
  },
  geometry: { coordinates: [2.3308, 48.8697] },
};

describe('geocode', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('retourne l\'objet geo normalisé pour une adresse trouvée', async () => {
    global.fetch = async () => mockBanResponse([FEATURE_PARIS]);

    const result = await geocode('12 rue de la Paix Paris');
    assert.equal(result.adresse_normalisee, '12 Rue de la Paix, 75001 Paris');
    assert.equal(result.lat, 48.8697);
    assert.equal(result.lon, 2.3308);
    assert.equal(result.code_insee, '75056');
    assert.equal(result.code_postal, '75001');
    assert.equal(result.ville, 'Paris');
    assert.equal(result.score, 0.95);
  });

  it('retourne null si aucun résultat BAN', async () => {
    global.fetch = async () => mockBanResponse([]);

    const result = await geocode('adresse inconnue xyz');
    assert.equal(result, null);
  });

  it('retourne null si features est absent de la réponse', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({}),
    });

    const result = await geocode('test');
    assert.equal(result, null);
  });

  it('lance une erreur si l\'API répond en erreur HTTP', async () => {
    global.fetch = async () => ({ ok: false, status: 503 });

    await assert.rejects(
      () => geocode('12 rue de la Paix Paris'),
      /BAN HTTP 503/,
    );
  });

  it('encode correctement l\'adresse dans l\'URL', async () => {
    let capturedUrl;
    global.fetch = async (url) => {
      capturedUrl = url;
      return mockBanResponse([FEATURE_PARIS]);
    };

    await geocode('12 rue de la Paix Paris');
    assert.ok(capturedUrl.includes('12%20rue%20de%20la%20Paix%20Paris'), 'l\'adresse doit être encodée dans l\'URL');
  });
});
