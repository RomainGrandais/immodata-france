'use strict';

const { geocode } = require('./ban');
const { getCommune } = require('./insee');
const { isZoneTendue } = require('./zoneTendue');
const { median, parseTransactionDate, pricePerSqm, isHousingType } = require('../utils/stats');

const DVF_URL = 'https://api.cquest.org/dvf';

/**
 * Analyse les tendances du marché immobilier par mois.
 *
 * @param {Object} params
 * @param {string} [params.adresse] - Adresse (géocodée puis rayon autour)
 * @param {string} [params.code_insee] - Code INSEE direct (prioritaire si fourni)
 * @param {number} [params.mois] - Profondeur d'analyse en mois (12 à 60, défaut 24)
 * @param {string} [params.type] - "appartement" ou "maison" (optionnel)
 *
 * @returns {Object} tendances mensuelles + résumé
 */
async function analyserTendances({ adresse, code_insee, mois = 24, type }) {
  mois = Math.max(12, Math.min(60, mois)); // clamp 12-60

  let lat, lon, codeInsee, adresseNorm;

  if (code_insee) {
    // Mode code INSEE : utiliser le centroïde de la commune
    codeInsee = code_insee;
    // Géocoder la commune par son nom via INSEE
    const commune = await getCommune(code_insee);
    adresseNorm = commune.nom;
    // Géocoder la commune pour avoir les coordonnées
    const geo = await geocode(commune.nom);
    if (!geo) {
      const err = new Error('Commune introuvable pour ce code INSEE.');
      err.code = 'ADRESSE_INTROUVABLE';
      throw err;
    }
    lat = geo.lat;
    lon = geo.lon;
  } else if (adresse) {
    const geo = await geocode(adresse);
    if (!geo) {
      const err = new Error('Adresse introuvable. Vérifiez l\'orthographe.');
      err.code = 'ADRESSE_INTROUVABLE';
      throw err;
    }
    lat = geo.lat;
    lon = geo.lon;
    codeInsee = geo.code_insee;
    adresseNorm = geo.adresse_normalisee;
  } else {
    const err = new Error('Paramètre adresse ou code_insee requis.');
    err.code = 'PARAM_MANQUANT';
    throw err;
  }

  // Rayon plus large pour avoir du volume sur les tendances
  const dist = 2000; // 2km
  const url = `${DVF_URL}?lat=${lat}&lon=${lon}&dist=${dist}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`DVF HTTP ${res.status}`);

  const data = await res.json();
  const rawRows = Array.isArray(data) ? data : (data.resultats || data.features || []);

  // Filtrer par type et période
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - mois);

  const filtered = rawRows.filter(r => {
    if (!isHousingType(r)) return false;
    if (type) {
      const t = (r.type_local || '').toLowerCase();
      if (type === 'appartement' && t !== 'appartement') return false;
      if (type === 'maison' && t !== 'maison') return false;
    }
    const d = parseTransactionDate(r);
    return d && d >= cutoff;
  });

  // Grouper par mois (YYYY-MM)
  const byMonth = {};
  for (const r of filtered) {
    const d = parseTransactionDate(r);
    if (!d) continue;
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth[monthKey]) byMonth[monthKey] = [];
    const ppm = pricePerSqm(r);
    if (ppm !== null) {
      byMonth[monthKey].push({
        ppm,
        valeur: parseFloat(r.valeur_fonciere),
        surface: parseFloat(r.surface_reelle_bati),
      });
    }
  }

  // Construire la série temporelle
  const timeline = Object.keys(byMonth).sort().map(month => {
    const transactions = byMonth[month];
    const ppms = transactions.map(t => t.ppm);
    return {
      mois: month,
      prix_m2_median: Math.round(median(ppms)),
      prix_m2_min: Math.round(Math.min(...ppms)),
      prix_m2_max: Math.round(Math.max(...ppms)),
      nb_transactions: transactions.length,
      volume_total: Math.round(transactions.reduce((s, t) => s + t.valeur, 0)),
    };
  });

  if (timeline.length === 0) {
    return {
      adresse_normalisee: adresseNorm,
      coordonnees: { lat, lon },
      code_insee: codeInsee,
      tendances: null,
      message: 'Pas assez de transactions dans ce secteur pour analyser les tendances.',
      meta: { sources: ['BAN', 'DVF'], generated_at: new Date().toISOString() },
    };
  }

  // Calculer tendance globale : première moitié vs deuxième moitié
  const mid = Math.floor(timeline.length / 2);
  const firstHalf = timeline.slice(0, mid || 1);
  const secondHalf = timeline.slice(mid || 1);

  const medFirstHalf = median(firstHalf.map(t => t.prix_m2_median));
  const medSecondHalf = median(secondHalf.map(t => t.prix_m2_median));

  let tendanceGlobale = null;
  let tendancePct = null;
  if (medFirstHalf && medSecondHalf) {
    tendancePct = ((medSecondHalf - medFirstHalf) / medFirstHalf) * 100;
    tendancePct = Math.round(tendancePct * 10) / 10;
    if (tendancePct > 3) tendanceGlobale = 'hausse';
    else if (tendancePct < -3) tendanceGlobale = 'baisse';
    else tendanceGlobale = 'stable';
  }

  // Volume total
  const nbTransactionsTotal = filtered.length;
  const volumeTotal = filtered.reduce((s, r) => s + (parseFloat(r.valeur_fonciere) || 0), 0);

  // Prix médian global
  const allPpms = filtered.map(r => pricePerSqm(r)).filter(x => x !== null);
  const prixM2Global = allPpms.length > 0 ? Math.round(median(allPpms)) : null;

  // Info commune
  let commune = null;
  try {
    commune = await getCommune(codeInsee);
  } catch { /* ignore */ }

  return {
    adresse_normalisee: adresseNorm,
    coordonnees: { lat, lon },
    code_insee: codeInsee,
    commune: commune ? { nom: commune.nom, population: commune.population } : null,
    tendances: {
      periode:              `${mois} mois`,
      tendance:             tendanceGlobale,
      variation_pct:        tendancePct,
      prix_m2_median:       prixM2Global,
      nb_transactions:      nbTransactionsTotal,
      volume_total_euros:   Math.round(volumeTotal),
      prix_m2_debut_periode: firstHalf[0]?.prix_m2_median ?? null,
      prix_m2_fin_periode:   secondHalf[secondHalf.length - 1]?.prix_m2_median ?? null,
    },
    timeline,
    zone_tendue: isZoneTendue(codeInsee),
    meta: {
      sources: ['BAN', 'DVF', 'INSEE'],
      generated_at: new Date().toISOString(),
      rayon_metres: dist,
    },
  };
}

module.exports = { analyserTendances };
