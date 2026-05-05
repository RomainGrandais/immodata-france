'use strict';

const { geocode } = require('./ban');
const { getMarche } = require('./dvf');
const { getEnergie } = require('./dpe');
const { getCommune } = require('./insee');
const { generateSummary } = require('./summary');
const { isZoneTendue } = require('./zoneTendue');

// Logique métier centrale, partagée entre le handler HTTP et le serveur MCP
async function buildResponse(adresse, format = 'ai') {
  const geo = await geocode(adresse);
  if (!geo) {
    const err = new Error('Adresse introuvable. Vérifiez l\'orthographe.');
    err.code = 'ADRESSE_INTROUVABLE';
    throw err;
  }

  const { lat, lon, code_insee, adresse_normalisee } = geo;

  const [marcheRaw, energieRaw, communeRaw] = await Promise.allSettled([
    getMarche(lat, lon),
    getEnergie(lat, lon),
    getCommune(code_insee),
  ]);

  const marche = marcheRaw.status === 'fulfilled' ? marcheRaw.value : null;
  const energie = energieRaw.status === 'fulfilled' ? energieRaw.value : null;
  const commune = communeRaw.status === 'fulfilled' ? communeRaw.value : {
    nom: geo.ville,
    code_insee,
    population: null,
    codes_postaux: [geo.code_postal],
  };

  const reglementaire = {
    zone_tendue: isZoneTendue(code_insee),
    encadrement_loyers: false,
  };

  let ai_summary = null;
  if (format !== 'raw') {
    try {
      ai_summary = await generateSummary({ adresse: adresse_normalisee, commune, marche, energie, reglementaire });
    } catch {
      ai_summary = 'Résumé IA temporairement indisponible.';
    }
  }

  const payload = {
    adresse_normalisee,
    coordonnees: { lat, lon },
    commune: {
      nom: commune.nom,
      code_insee: commune.code_insee,
      population: commune.population,
    },
    marche: marche ?? {
      prix_m2_median: null,
      nb_transactions_24m: 0,
      tendance_12m: null,
      derniere_transaction: null,
      message: 'Données insuffisantes dans ce secteur',
    },
    energie: energie ?? null,
    reglementaire,
    meta: {
      sources: ['BAN', 'DVF', 'DPE-ADEME', 'INSEE'],
      generated_at: new Date().toISOString(),
      rayon_metres: 500,
    },
  };

  if (format !== 'raw') payload.ai_summary = ai_summary;

  const warnings = [];
  if (marcheRaw.status === 'rejected') warnings.push('DVF indisponible temporairement');
  if (energieRaw.status === 'rejected') warnings.push('DPE ADEME indisponible temporairement');
  if (communeRaw.status === 'rejected') warnings.push('INSEE indisponible temporairement');
  if (warnings.length > 0) payload.meta.warnings = warnings;

  return payload;
}

module.exports = { buildResponse };
