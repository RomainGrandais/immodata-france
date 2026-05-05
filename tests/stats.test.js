'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { median, monthsAgo, parseTransactionDate, pricePerSqm, isHousingType } = require('../utils/stats');

describe('median', () => {
  it('retourne null pour un tableau vide', () => {
    assert.equal(median([]), null);
    assert.equal(median(null), null);
    assert.equal(median(undefined), null);
  });

  it('retourne l\'élément unique', () => {
    assert.equal(median([42]), 42);
  });

  it('retourne la médiane d\'un tableau impair', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([10, 30, 20]), 20);
  });

  it('retourne la moyenne des deux milieux pour un tableau pair', () => {
    assert.equal(median([1, 3]), 2);
    assert.equal(median([1, 2, 3, 4]), 3); // Math.round((2+3)/2) = Math.round(2.5) = 3
  });

  it('fonctionne sur des tableaux déjà triés', () => {
    assert.equal(median([100, 200, 300, 400, 500]), 300);
  });
});

describe('monthsAgo', () => {
  it('retourne une Date dans le passé', () => {
    const result = monthsAgo(12);
    const now = new Date();
    assert.ok(result < now, 'doit être dans le passé');
    const diffMs = now - result;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    assert.ok(diffDays > 360 && diffDays < 370, 'doit être environ 12 mois en arrière');
  });

  it('retourne une Date d\'il y a 24 mois pour 24', () => {
    const result = monthsAgo(24);
    const diffDays = (new Date() - result) / (1000 * 60 * 60 * 24);
    assert.ok(diffDays > 720 && diffDays < 740);
  });
});

describe('parseTransactionDate', () => {
  it('parse date_mutation au format YYYY-MM-DD', () => {
    const result = parseTransactionDate({ date_mutation: '2024-06-15' });
    assert.ok(result instanceof Date);
    assert.equal(result.getFullYear(), 2024);
    assert.equal(result.getMonth(), 5); // juin = index 5
    assert.equal(result.getDate(), 15);
  });

  it('utilise le champ date si date_mutation absent', () => {
    const result = parseTransactionDate({ date: '2023-01-01' });
    assert.ok(result instanceof Date);
    assert.equal(result.getFullYear(), 2023);
  });

  it('retourne null si aucun champ de date', () => {
    assert.equal(parseTransactionDate({}), null);
    assert.equal(parseTransactionDate({ type_local: 'Appartement' }), null);
  });
});

describe('pricePerSqm', () => {
  it('calcule le prix au m² correctement', () => {
    const result = pricePerSqm({ valeur_fonciere: '500000', surface_reelle_bati: '100' });
    assert.equal(result, 5000);
  });

  it('retourne null si le prix est trop bas (< 500)', () => {
    assert.equal(pricePerSqm({ valeur_fonciere: '10000', surface_reelle_bati: '100' }), null);
  });

  it('retourne null si le prix est trop élevé (> 20000)', () => {
    assert.equal(pricePerSqm({ valeur_fonciere: '5000000', surface_reelle_bati: '100' }), null);
  });

  it('retourne null si la surface est zéro', () => {
    assert.equal(pricePerSqm({ valeur_fonciere: '500000', surface_reelle_bati: '0' }), null);
  });

  it('retourne null si la surface est manquante', () => {
    assert.equal(pricePerSqm({ valeur_fonciere: '500000' }), null);
  });

  it('retourne null si la valeur est manquante', () => {
    assert.equal(pricePerSqm({ surface_reelle_bati: '80' }), null);
  });

  it('retourne null si les valeurs ne sont pas numériques', () => {
    assert.equal(pricePerSqm({ valeur_fonciere: 'abc', surface_reelle_bati: '80' }), null);
  });
});

describe('isHousingType', () => {
  it('accepte Appartement (casse mixte)', () => {
    assert.equal(isHousingType({ type_local: 'Appartement' }), true);
    assert.equal(isHousingType({ type_local: 'appartement' }), true);
    assert.equal(isHousingType({ type_local: 'APPARTEMENT' }), true);
  });

  it('accepte Maison (casse mixte)', () => {
    assert.equal(isHousingType({ type_local: 'Maison' }), true);
    assert.equal(isHousingType({ type_local: 'maison' }), true);
  });

  it('rejette les types non-résidentiels', () => {
    assert.equal(isHousingType({ type_local: 'Local commercial' }), false);
    assert.equal(isHousingType({ type_local: 'Dépendance' }), false);
    assert.equal(isHousingType({ type_local: 'Local industriel' }), false);
  });

  it('rejette un champ vide ou manquant', () => {
    assert.equal(isHousingType({ type_local: '' }), false);
    assert.equal(isHousingType({}), false);
  });
});
