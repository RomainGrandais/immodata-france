'use strict';

const { median, monthsAgo, parseTransactionDate, pricePerSqm, isHousingType } = require('../utils/stats');

const DVF_URL = 'https://api.cquest.org/dvf';

async function fetchTransactions(lat, lon, dist = 500) {
  const url = `${DVF_URL}?lat=${lat}&lon=${lon}&dist=${dist}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`DVF HTTP ${res.status}`);

  const data = await res.json();
  // L'API retourne { resultats: [...] } ou directement un tableau
  return Array.isArray(data) ? data : (data.resultats || data.features || []);
}

function analyzeTransactions(rows) {
  if (!rows || rows.length === 0) return null;

  const now = new Date();
  const cutoff24m = monthsAgo(24);
  const cutoff12m = monthsAgo(12);

  // Filtrer : logements uniquement, dans les 24 derniers mois
  const recent = rows.filter(r => {
    if (!isHousingType(r)) return false;
    const d = parseTransactionDate(r);
    if (!d) return false;
    return d >= cutoff24m;
  });

  if (recent.length === 0) return null;

  // Calculer les prix/m² valides
  const withPrice = recent
    .map(r => ({ row: r, ppm: pricePerSqm(r), date: parseTransactionDate(r) }))
    .filter(x => x.ppm !== null);

  // Médiane globale 24 mois
  const allPpm = withPrice.map(x => x.ppm);
  const prixMedian = median(allPpm);

  // Tendance : 0-12m vs 12-24m
  const recent12 = withPrice.filter(x => x.date >= cutoff12m).map(x => x.ppm);
  const prev12 = withPrice.filter(x => x.date < cutoff12m).map(x => x.ppm);

  let tendance = null;
  if (recent12.length > 0 && prev12.length > 0) {
    const medRecent = median(recent12);
    const medPrev = median(prev12);
    const pct = ((medRecent - medPrev) / medPrev) * 100;
    tendance = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
  }

  // Date de dernière transaction
  const dates = recent
    .map(r => parseTransactionDate(r))
    .filter(Boolean)
    .sort((a, b) => b - a);

  const derniere = dates[0]
    ? `${dates[0].getFullYear()}-${String(dates[0].getMonth() + 1).padStart(2, '0')}`
    : null;

  return {
    prix_m2_median: prixMedian ? Math.round(prixMedian) : null,
    nb_transactions_24m: recent.length,
    tendance_12m: tendance,
    derniere_transaction: derniere,
  };
}

async function getMarche(lat, lon) {
  const rows = await fetchTransactions(lat, lon);
  return analyzeTransactions(rows);
}

module.exports = { getMarche, analyzeTransactions };
