'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { getEnergie, analyzeDpe, mostFrequent } = require('../lib/dpe');

// ── analyzeDpe ────────────────────────────────────────────────────────────────

describe('analyzeDpe', () => {
  it('retourne null pour une lettre nulle ou vide', () => {
    assert.equal(analyzeDpe(null), null);
    assert.equal(analyzeDpe(''), null);
    assert.equal(analyzeDpe(undefined), null);
  });

  it('classe A → pas d\'alerte, éligible LCD, pas de travaux', () => {
    const r = analyzeDpe('A');
    assert.equal(r.dpe_lettre, 'A');
    assert.equal(r.alerte_loi_lemeur, false);
    assert.equal(r.eligible_location_courte_duree, true);
    assert.equal(r.travaux_requis_avant, null);
  });

  it('classe B → pas de travaux', () => {
    const r = analyzeDpe('B');
    assert.equal(r.travaux_requis_avant, null);
  });

  it('classe C → pas de travaux', () => {
    const r = analyzeDpe('C');
    assert.equal(r.travaux_requis_avant, null);
  });

  it('classe D → pas d\'alerte, éligible LCD, aucune échéance obligatoire', () => {
    const r = analyzeDpe('D');
    assert.equal(r.dpe_lettre, 'D');
    assert.equal(r.alerte_loi_lemeur, false);
    assert.equal(r.eligible_location_courte_duree, true);
    assert.equal(r.travaux_requis_avant, null); // bug corrigé : était '2028'
  });

  it('classe E → pas d\'alerte, éligible LCD, travaux avant 2034', () => {
    const r = analyzeDpe('E');
    assert.equal(r.dpe_lettre, 'E');
    assert.equal(r.alerte_loi_lemeur, false);
    assert.equal(r.eligible_location_courte_duree, true);
    assert.equal(r.travaux_requis_avant, '2034'); // bug corrigé : était '2028'
  });

  it('classe F → alerte loi Le Meur, non éligible LCD', () => {
    const r = analyzeDpe('F');
    assert.equal(r.dpe_lettre, 'F');
    assert.equal(r.alerte_loi_lemeur, true);
    assert.equal(r.eligible_location_courte_duree, false);
  });

  it('classe G → alerte loi Le Meur, non éligible LCD', () => {
    const r = analyzeDpe('G');
    assert.equal(r.dpe_lettre, 'G');
    assert.equal(r.alerte_loi_lemeur, true);
    assert.equal(r.eligible_location_courte_duree, false);
  });

  it('normalise les minuscules', () => {
    const r = analyzeDpe('d');
    assert.equal(r.dpe_lettre, 'D');
  });
});

// ── mostFrequent ──────────────────────────────────────────────────────────────

describe('mostFrequent', () => {
  it('retourne null pour un tableau vide ou null', () => {
    assert.equal(mostFrequent([]), null);
    assert.equal(mostFrequent(null), null);
    assert.equal(mostFrequent(undefined), null);
  });

  it('retourne le seul élément', () => {
    assert.equal(mostFrequent(['C']), 'C');
  });

  it('retourne l\'élément le plus fréquent', () => {
    assert.equal(mostFrequent(['A', 'B', 'A', 'C', 'A']), 'A');
    assert.equal(mostFrequent(['D', 'D', 'C']), 'D');
  });
});

// ── getEnergie ────────────────────────────────────────────────────────────────

describe('getEnergie', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('retourne l\'analyse DPE de la lettre dominante', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        results: [
          { etiquette_dpe: 'C' },
          { etiquette_dpe: 'C' },
          { etiquette_dpe: 'D' },
        ],
      }),
    });

    const result = await getEnergie(48.8697, 2.3308);
    assert.equal(result.dpe_lettre, 'C');
    assert.equal(result.alerte_loi_lemeur, false);
    assert.equal(result.eligible_location_courte_duree, true);
  });

  it('retourne null si aucun DPE dans le rayon', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ results: [] }),
    });

    const result = await getEnergie(48.8697, 2.3308);
    assert.equal(result, null);
  });

  it('filtre les lettres invalides', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        results: [
          { etiquette_dpe: 'X' },     // invalide
          { etiquette_dpe: '' },       // vide
          { etiquette_dpe: 'B' },
        ],
      }),
    });

    const result = await getEnergie(48.0, 2.0);
    assert.equal(result.dpe_lettre, 'B');
  });

  it('accepte le champ alternatif Etiquette_DPE', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        results: [{ Etiquette_DPE: 'F' }],
      }),
    });

    const result = await getEnergie(48.0, 2.0);
    assert.equal(result.dpe_lettre, 'F');
    assert.equal(result.alerte_loi_lemeur, true);
  });

  it('lance une erreur si l\'API répond en erreur', async () => {
    global.fetch = async () => ({ ok: false, status: 500 });

    await assert.rejects(
      () => getEnergie(48.0, 2.0),
      /DPE HTTP 500/,
    );
  });
});
