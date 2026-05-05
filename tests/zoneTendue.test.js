'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { isZoneTendue } = require('../lib/zoneTendue');

describe('isZoneTendue', () => {
  it('reconnaît Paris (75056)', () => {
    assert.equal(isZoneTendue('75056'), true);
  });

  it('reconnaît Lyon (69123)', () => {
    assert.equal(isZoneTendue('69123'), true);
  });

  it('reconnaît Marseille (13055)', () => {
    assert.equal(isZoneTendue('13055'), true);
  });

  it('reconnaît Bordeaux (33063)', () => {
    assert.equal(isZoneTendue('33063'), true);
  });

  it('reconnaît Nantes (44109)', () => {
    assert.equal(isZoneTendue('44109'), true);
  });

  it('reconnaît Lille (59350)', () => {
    assert.equal(isZoneTendue('59350'), true);
  });

  it('reconnaît une commune de la petite couronne parisienne', () => {
    assert.equal(isZoneTendue('92002'), true); // Antony
  });

  it('retourne false pour une commune hors zone tendue', () => {
    assert.equal(isZoneTendue('01001'), false); // Ambérieu-en-Bugey
    assert.equal(isZoneTendue('19000'), false); // code inexistant
  });

  it('retourne false pour une chaîne vide', () => {
    assert.equal(isZoneTendue(''), false);
  });

  it('accepte un code INSEE passé en nombre (coercion String)', () => {
    assert.equal(isZoneTendue(75056), true);
  });
});
