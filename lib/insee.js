'use strict';

const GEO_API = 'https://geo.api.gouv.fr/communes';

async function getCommune(codeInsee) {
  const url = `${GEO_API}/${codeInsee}?fields=nom,population,codesPostaux`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`INSEE HTTP ${res.status}`);

  const data = await res.json();

  return {
    nom: data.nom,
    code_insee: codeInsee,
    population: data.population || null,
    codes_postaux: data.codesPostaux || [],
  };
}

module.exports = { getCommune };
