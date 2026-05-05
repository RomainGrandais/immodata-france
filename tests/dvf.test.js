'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { getMarche, analyzeTransactions } = require('../lib/dvf');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTransaction(overrides = {}) {
  const d = new Date();
  d.setMonth(d.getMonth() - 6); // 6 mois dans le passé par défaut
  return {
    date_mutation: d.toISOString().slice(0, 10),
    valeur_fonciere: '400000',
    surface_reelle_bati: '80',
    type_local: 'Appartement',
    ...overrides,
  };
}

function daysAgoDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ── analyzeTransactions ───────────────────────────────────────────────────────

describe('analyzeTransactions', () => {
  it('retourne null pour un tableau vide', () => {
    assert.equal(analyzeTransactions([]), null);
    assert.equal(analyzeTransactions(null), null);
    assert.equal(analyzeTransactions(undefined), null);
  });

  it('retourne null si toutes les transactions sont trop anciennes (> 24 mois)', () => {
    const old = makeTransaction({ date_mutation: '2020-01-01' });
    assert.equal(analyzeTransactions([old]), null);
  });

  it('retourne null si aucun type logement', () => {
    const tx = makeTransaction({ type_local: 'Local commercial' });
    assert.equal(analyzeTransactions([tx]), null);
  });

  it('calcule le prix médian et le nombre de transactions', () => {
    const txs = [
      makeTransaction({ valeur_fonciere: '300000', surface_reelle_bati: '60' }), // 5000 €/m²
      makeTransaction({ valeur_fonciere: '400000', surface_reelle_bati: '80' }), // 5000 €/m²
      makeTransaction({ valeur_fonciere: '500000', surface_reelle_bati: '100' }), // 5000 €/m²
    ];
    const result = analyzeTransactions(txs);
    assert.equal(result.prix_m2_median, 5000);
    assert.equal(result.nb_transactions_24m, 3);
  });

  it('filtre les prix aberrants (< 500 ou > 20000 €/m²)', () => {
    const txs = [
      makeTransaction({ valeur_fonciere: '100', surface_reelle_bati: '80' }),    // 1.25 → filtré
      makeTransaction({ valeur_fonciere: '3000000', surface_reelle_bati: '100' }), // 30000 → filtré
      makeTransaction({ valeur_fonciere: '400000', surface_reelle_bati: '80' }), // 5000 → valide
    ];
    const result = analyzeTransactions(txs);
    assert.equal(result.prix_m2_median, 5000);
  });

  it('calcule la tendance entre 0-12m et 12-24m', () => {
    const recent = makeTransaction({
      valeur_fonciere: '600000',
      surface_reelle_bati: '100', // 6000 €/m²
      date_mutation: daysAgoDate(90), // 3 mois
    });
    const prev = makeTransaction({
      valeur_fonciere: '500000',
      surface_reelle_bati: '100', // 5000 €/m²
      date_mutation: daysAgoDate(500), // ~16 mois
    });
    const result = analyzeTransactions([recent, prev]);
    assert.ok(result.tendance_12m.startsWith('+'), 'tendance doit être positive');
    assert.match(result.tendance_12m, /^\+20\.0%$/);
  });

  it('tendance null si une seule des deux périodes a des données', () => {
    const txs = [makeTransaction({ date_mutation: daysAgoDate(30) })];
    const result = analyzeTransactions(txs);
    assert.equal(result.tendance_12m, null);
  });

  it('calcule la date de dernière transaction', () => {
    const txs = [
      makeTransaction({ date_mutation: '2024-06-15' }),
      makeTransaction({ date_mutation: '2024-11-20' }),
      makeTransaction({ date_mutation: '2024-03-01' }),
    ];
    const result = analyzeTransactions(txs);
    assert.equal(result.derniere_transaction, '2024-11');
  });

  it('accepte les Maisons', () => {
    const tx = makeTransaction({ type_local: 'Maison' });
    const result = analyzeTransactions([tx]);
    assert.ok(result !== null);
  });
});

// ── getMarche ─────────────────────────────────────────────────────────────────

describe('getMarche', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('retourne les stats de marché pour des résultats valides', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => [
        makeTransaction({ valeur_fonciere: '400000', surface_reelle_bati: '80' }),
      ],
    });

    const result = await getMarche(48.87, 2.33);
    assert.equal(result.prix_m2_median, 5000);
    assert.equal(result.nb_transactions_24m, 1);
  });

  it('retourne null si le DVF ne retourne aucune transaction', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ resultats: [] }),
    });

    const result = await getMarche(48.87, 2.33);
    assert.equal(result, null);
  });

  it('accepte la structure { features: [...] }', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        features: [makeTransaction()],
      }),
    });

    const result = await getMarche(48.87, 2.33);
    assert.ok(result !== null);
  });

  it('lance une erreur si l\'API répond en erreur', async () => {
    global.fetch = async () => ({ ok: false, status: 404 });

    await assert.rejects(
      () => getMarche(48.87, 2.33),
      /DVF HTTP 404/,
    );
  });
});
