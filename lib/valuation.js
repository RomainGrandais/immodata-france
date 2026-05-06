'use strict';

const { geocode } = require('./ban');
const { getEnergie } = require('./dpe');
const { isZoneTendue } = require('./zoneTendue');
const { median, monthsAgo, parseTransactionDate, pricePerSqm, isHousingType } = require('../utils/stats');

const DVF_URL = 'https://api.cquest.org/dvf';

/**
 * Récupère les transactions DVF dans un rayon donné.
 * @param {number} lat
 * @param {number} lon
 * @param {number} dist rayon en mètres
 * @returns {Array} transactions brutes
 */
async function fetchTransactions(lat, lon, dist = 500) {
  const url = `${DVF_URL}?lat=${lat}&lon=${lon}&dist=${dist}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`DVF HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.resultats || data.features || []);
}

/**
 * Filtre les transactions par type de bien et période.
 */
function filterTransactions(rows, options = {}) {
  const { type, moisMax = 24 } = options;
  const cutoff = monthsAgo(moisMax);

  return rows.filter(r => {
    if (!isHousingType(r)) return false;
    // Filtrage par type si spécifié
    if (type) {
      const t = (r.type_local || '').toLowerCase();
      if (type === 'appartement' && t !== 'appartement') return false;
      if (type === 'maison' && t !== 'maison') return false;
    }
    const d = parseTransactionDate(r);
    return d && d >= cutoff;
  });
}

/**
 * Estime la valeur d'un bien immobilier à partir de transactions comparables.
 *
 * @param {Object} params
 * @param {string} params.adresse - Adresse complète
 * @param {number} [params.surface] - Surface en m² (optionnel)
 * @param {string} [params.type] - "appartement" ou "maison" (optionnel)
 * @param {number} [params.pieces] - Nombre de pièces (optionnel, filtre indicatif)
 *
 * @returns {Object} estimation détaillée
 */
async function estimerValeur({ adresse, surface, type, pieces }) {
  const geo = await geocode(adresse);
  if (!geo) {
    const err = new Error('Adresse introuvable. Vérifiez l\'orthographe.');
    err.code = 'ADRESSE_INTROUVABLE';
    throw err;
  }

  const { lat, lon, code_insee, adresse_normalisee } = geo;

  // Récupérer transactions + DPE en parallèle
  const [rowsRaw, energieRaw] = await Promise.allSettled([
    fetchTransactions(lat, lon, 500),
    getEnergie(lat, lon),
  ]);

  const rows = rowsRaw.status === 'fulfilled' ? rowsRaw.value : [];
  const filtered = filterTransactions(rows, { type, moisMax: 24 });

  if (filtered.length < 3) {
    // Élargir le rayon à 1km si pas assez de données
    const rowsWide = await fetchTransactions(lat, lon, 1000);
    filtered.push(...filterTransactions(rowsWide, { type, moisMax: 36 }));
  }

  // Dédupliquer par date + valeur foncière
  const seen = new Set();
  const unique = filtered.filter(r => {
    const key = `${r.date_mutation}-${r.valeur_fonciere}-${r.surface_reelle_bati}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Calculer les prix/m²
  const withPrice = unique
    .map(r => ({
      date: r.date_mutation,
      valeur: parseFloat(r.valeur_fonciere),
      surface: parseFloat(r.surface_reelle_bati),
      ppm: pricePerSqm(r),
      type_local: r.type_local,
      pieces: parseInt(r.nombre_pieces_principales, 10) || null,
    }))
    .filter(x => x.ppm !== null)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (withPrice.length === 0) {
    return {
      adresse_normalisee,
      coordonnees: { lat, lon },
      estimation: null,
      message: 'Données insuffisantes pour estimer la valeur dans ce secteur.',
      comparables: [],
      meta: { sources: ['BAN', 'DVF'], generated_at: new Date().toISOString() },
    };
  }

  const allPpm = withPrice.map(x => x.ppm);
  const prixM2Median = Math.round(median(allPpm));
  const prixM2Min = Math.round(Math.min(...allPpm));
  const prixM2Max = Math.round(Math.max(...allPpm));

  // Estimation si surface fournie
  let valeurEstimee = null;
  let fourchetteBasse = null;
  let fourchetteHaute = null;
  if (surface && surface > 0) {
    valeurEstimee = Math.round(prixM2Median * surface);
    // Fourchette ±15% (resserrée si beaucoup de comparables)
    const margin = withPrice.length >= 10 ? 0.10 : withPrice.length >= 5 ? 0.15 : 0.20;
    fourchetteBasse = Math.round(valeurEstimee * (1 - margin));
    fourchetteHaute = Math.round(valeurEstimee * (1 + margin));
  }

  // Top 5 comparables
  const comparables = withPrice.slice(0, 5).map(c => ({
    date:       c.date,
    prix:       c.valeur,
    surface_m2: c.surface,
    prix_m2:    Math.round(c.ppm),
    type:       c.type_local,
    pieces:     c.pieces,
  }));

  // DPE
  const energie = energieRaw.status === 'fulfilled' ? energieRaw.value : null;

  // Alertes et contexte
  const alertes = [];
  if (energie?.dpe_lettre && ['F', 'G'].includes(energie.dpe_lettre)) {
    alertes.push(`DPE ${energie.dpe_lettre} — passoire thermique. Décote estimée 10-20%. Travaux obligatoires.`);
  }
  if (energie?.dpe_lettre === 'E') {
    alertes.push('DPE E — location interdite à partir de 2034 (loi Climat et Résilience).');
  }
  if (isZoneTendue(code_insee)) {
    alertes.push('Zone tendue — encadrement des loyers possible. Plus-value à la revente probable.');
  }

  return {
    adresse_normalisee,
    coordonnees: { lat, lon },
    code_insee,
    estimation: {
      prix_m2_median:   prixM2Median,
      prix_m2_min:      prixM2Min,
      prix_m2_max:      prixM2Max,
      valeur_estimee:   valeurEstimee,
      fourchette_basse: fourchetteBasse,
      fourchette_haute: fourchetteHaute,
      surface_m2:       surface ?? null,
      nb_comparables:   withPrice.length,
      confiance:        withPrice.length >= 10 ? 'haute' : withPrice.length >= 5 ? 'moyenne' : 'faible',
    },
    energie: energie ?? null,
    zone_tendue: isZoneTendue(code_insee),
    alertes,
    comparables,
    meta: {
      sources: ['BAN', 'DVF', 'DPE-ADEME'],
      generated_at: new Date().toISOString(),
      rayon_metres: withPrice.length > 10 ? 500 : 1000,
    },
  };
}

module.exports = { estimerValeur, fetchTransactions, filterTransactions };
