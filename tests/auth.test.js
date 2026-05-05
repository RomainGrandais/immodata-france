'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { checkApiKey, extractKey } = require('../lib/auth');

function makeReq(overrides = {}) {
  return {
    headers: {},
    query: {},
    ...overrides,
  };
}

describe('extractKey', () => {
  it('lit le header x-api-key en priorité', () => {
    const req = makeReq({ headers: { 'x-api-key': 'key_abc' }, query: { apikey: 'key_other' } });
    assert.equal(extractKey(req), 'key_abc');
  });

  it('lit Authorization Bearer si x-api-key absent', () => {
    const req = makeReq({ headers: { 'authorization': 'Bearer key_bearer' } });
    assert.equal(extractKey(req), 'key_bearer');
  });

  it('lit le query param apikey en dernier recours', () => {
    const req = makeReq({ query: { apikey: 'key_query' } });
    assert.equal(extractKey(req), 'key_query');
  });

  it('retourne null si aucune clé fournie', () => {
    assert.equal(extractKey(makeReq()), null);
  });

  it('trim les espaces', () => {
    const req = makeReq({ headers: { 'x-api-key': '  key_abc  ' } });
    assert.equal(extractKey(req), 'key_abc');
  });
});

describe('checkApiKey', () => {
  let originalApiKeys;

  beforeEach(() => {
    originalApiKeys = process.env.API_KEYS;
  });

  afterEach(() => {
    if (originalApiKeys === undefined) delete process.env.API_KEYS;
    else process.env.API_KEYS = originalApiKeys;
  });

  it('retourne null (OK) si API_KEYS non configuré — mode dev local', () => {
    delete process.env.API_KEYS;
    const result = checkApiKey(makeReq());
    assert.equal(result, null);
  });

  it('retourne 401 si API_KEYS défini mais clé manquante', () => {
    process.env.API_KEYS = 'immo_live_abc';
    const result = checkApiKey(makeReq({ headers: {} }));
    assert.equal(result.status, 401);
    assert.match(result.error, /manquante/i);
  });

  it('retourne 403 si la clé est invalide', () => {
    process.env.API_KEYS = 'immo_live_abc';
    const result = checkApiKey(makeReq({ headers: { 'x-api-key': 'mauvaise_clé' } }));
    assert.equal(result.status, 403);
    assert.match(result.error, /invalide/i);
  });

  it('retourne null (OK) si la clé est valide', () => {
    process.env.API_KEYS = 'immo_live_abc,immo_live_xyz';
    const result = checkApiKey(makeReq({ headers: { 'x-api-key': 'immo_live_xyz' } }));
    assert.equal(result, null);
  });

  it('accepte plusieurs clés séparées par des virgules', () => {
    process.env.API_KEYS = 'key1, key2, key3';
    assert.equal(checkApiKey(makeReq({ headers: { 'x-api-key': 'key2' } })), null);
    assert.equal(checkApiKey(makeReq({ headers: { 'x-api-key': 'key3' } })), null);
  });

  it('la réponse d\'erreur contient un lien docs', () => {
    process.env.API_KEYS = 'immo_live_abc';
    const result = checkApiKey(makeReq({ headers: { 'x-api-key': 'bad' } }));
    assert.ok(result.docs, 'docs URL doit être présente');
  });
});
