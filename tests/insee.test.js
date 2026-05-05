'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { getCommune } = require('../lib/insee');

describe('getCommune', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('retourne les données de commune correctement structurées', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        nom: 'Paris',
        population: 2161000,
        codesPostaux: ['75001', '75002'],
      }),
    });

    const result = await getCommune('75056');
    assert.equal(result.nom, 'Paris');
    assert.equal(result.code_insee, '75056');
    assert.equal(result.population, 2161000);
    assert.deepEqual(result.codes_postaux, ['75001', '75002']);
  });

  it('retourne population null si le champ est absent', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        nom: 'Petit Village',
        codesPostaux: ['01000'],
      }),
    });

    const result = await getCommune('01001');
    assert.equal(result.population, null);
  });

  it('retourne un tableau vide si codesPostaux est absent', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ nom: 'Commune Test' }),
    });

    const result = await getCommune('99999');
    assert.deepEqual(result.codes_postaux, []);
  });

  it('lance une erreur si l\'API répond en erreur HTTP', async () => {
    global.fetch = async () => ({ ok: false, status: 404 });

    await assert.rejects(
      () => getCommune('00000'),
      /INSEE HTTP 404/,
    );
  });

  it('passe le code INSEE dans l\'URL', async () => {
    let capturedUrl;
    global.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({ nom: 'Lyon', population: 522969, codesPostaux: ['69001'] }),
      };
    };

    await getCommune('69123');
    assert.ok(capturedUrl.includes('69123'), 'le code INSEE doit être dans l\'URL');
  });
});
