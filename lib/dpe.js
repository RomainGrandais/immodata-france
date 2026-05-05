'use strict';

const DPE_BASE = 'https://data.ademe.fr/data-fair/api/v1/datasets/dpe-v2-logements-existants/lines';

// Classement loi Le Meur / loi Climat et Résilience
function analyzeDpe(lettre) {
  if (!lettre) return null;

  const l = lettre.toUpperCase();

  if (l === 'F' || l === 'G') {
    return {
      dpe_lettre: l,
      alerte_loi_lemeur: true,
      eligible_location_courte_duree: false,
      travaux_requis_avant: null,
    };
  }

  if (l === 'E') {
    return {
      dpe_lettre: l,
      alerte_loi_lemeur: false,
      eligible_location_courte_duree: true,
      travaux_requis_avant: '2034', // loi Climat et Résilience : interdiction de location en 2034
    };
  }

  if (l === 'D') {
    return {
      dpe_lettre: l,
      alerte_loi_lemeur: false,
      eligible_location_courte_duree: true,
      travaux_requis_avant: null, // pas d'interdiction prévue sous la loi actuelle
    };
  }

  // A, B, C
  return {
    dpe_lettre: l,
    alerte_loi_lemeur: false,
    eligible_location_courte_duree: true,
    travaux_requis_avant: null,
  };
}

function mostFrequent(arr) {
  if (!arr || arr.length === 0) return null;
  const counts = {};
  for (const v of arr) {
    counts[v] = (counts[v] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

async function getEnergie(lat, lon, dist = 500) {
  const url =
    `${DPE_BASE}?geo_distance=${lon},${lat},${dist}m&size=10` +
    `&select=etiquette_dpe`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`DPE HTTP ${res.status}`);

  const data = await res.json();
  const results = data.results || data.data || [];

  const lettres = results
    .map(r => r.etiquette_dpe || r['Etiquette_DPE'])
    .filter(Boolean)
    .map(l => l.trim().toUpperCase())
    .filter(l => /^[A-G]$/.test(l));

  if (lettres.length === 0) return null;

  return analyzeDpe(mostFrequent(lettres));
}

module.exports = { getEnergie, analyzeDpe, mostFrequent };
