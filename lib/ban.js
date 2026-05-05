'use strict';

const BAN_URL = 'https://api-adresse.data.gouv.fr/search/';

async function geocode(adresse) {
  const url = `${BAN_URL}?q=${encodeURIComponent(adresse)}&limit=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`BAN HTTP ${res.status}`);

  const data = await res.json();
  if (!data.features || data.features.length === 0) {
    return null;
  }

  const feature = data.features[0];
  const { properties, geometry } = feature;

  return {
    adresse_normalisee: properties.label,
    lat: geometry.coordinates[1],
    lon: geometry.coordinates[0],
    code_insee: properties.citycode,
    code_postal: properties.postcode,
    ville: properties.city,
    score: properties.score,
  };
}

module.exports = { geocode };
