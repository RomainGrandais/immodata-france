'use strict';

const { estimerValeur } = require('./valuation');
const { getCommune } = require('./insee');

/**
 * Grille indicative de rendement locatif brut par taille de commune.
 * Source : observatoire des loyers 2024 + moyennes FNAIM.
 * Utilisé UNIQUEMENT quand l'utilisateur ne fournit pas de loyer réel.
 */
const YIELD_GRID = [
  { populationMin: 1_000_000, label: 'Grande métropole',      yieldPct: 3.0 },
  { populationMin: 200_000,   label: 'Grande ville',          yieldPct: 4.5 },
  { populationMin: 50_000,    label: 'Ville moyenne',         yieldPct: 5.5 },
  { populationMin: 10_000,    label: 'Petite ville',          yieldPct: 6.5 },
  { populationMin: 0,         label: 'Zone rurale',           yieldPct: 7.5 },
];

function estimateYieldForPopulation(pop) {
  for (const row of YIELD_GRID) {
    if (pop >= row.populationMin) return row;
  }
  return YIELD_GRID[YIELD_GRID.length - 1];
}

/**
 * DPE impact sur le loyer (décote/surcote estimée).
 */
function dpeRentModifier(dpe) {
  if (!dpe) return 0;
  const map = { A: 0.05, B: 0.03, C: 0, D: 0, E: -0.05, F: -0.15, G: -0.20 };
  return map[dpe] ?? 0;
}

/**
 * Calcule le rendement locatif d'un bien.
 *
 * @param {Object} params
 * @param {string} params.adresse - Adresse complète
 * @param {number} [params.surface] - Surface en m²
 * @param {string} [params.type] - "appartement" ou "maison"
 * @param {number} [params.loyer_mensuel] - Loyer mensuel réel en € (si connu)
 * @param {number} [params.prix_achat] - Prix d'achat connu (sinon estimé via DVF)
 * @param {number} [params.charges_annuelles] - Charges annuelles (copro + TF + assurance)
 *
 * @returns {Object} analyse de rendement
 */
async function calculerRendement({ adresse, surface, type, loyer_mensuel, prix_achat, charges_annuelles }) {
  // 1. Estimer la valeur du bien
  const valuation = await estimerValeur({ adresse, surface, type });
  if (!valuation.estimation?.prix_m2_median && !prix_achat) {
    return {
      ...valuation,
      rendement: null,
      message: 'Impossible de calculer le rendement : pas assez de données de prix.',
    };
  }

  const valeur = prix_achat || valuation.estimation.valeur_estimee;
  const surfaceM2 = surface || null;
  const prixM2 = valuation.estimation?.prix_m2_median;

  // Si pas de prix d'achat et pas de surface → on ne peut pas estimer la valeur totale
  if (!valeur) {
    return {
      ...valuation,
      rendement: null,
      message: 'Surface ou prix d\'achat requis pour calculer le rendement.',
    };
  }

  // 2. Récupérer info commune pour estimation loyer
  let commune = null;
  try {
    commune = await getCommune(valuation.code_insee);
  } catch { /* ignore */ }

  // 3. Calculer ou estimer le loyer
  let loyerMensuel = loyer_mensuel;
  let loyerEstime = false;

  if (!loyerMensuel) {
    // Estimation basée sur le rendement moyen de la zone
    const pop = commune?.population ?? 50_000;
    const zoneInfo = estimateYieldForPopulation(pop);
    let yieldPct = zoneInfo.yieldPct;

    // Ajuster selon DPE
    const dpeMod = dpeRentModifier(valuation.energie?.dpe_lettre);
    yieldPct += dpeMod * 100; // ex: -0.15 * 100 = -15pp (trop fort), on veut juste ajuster le loyer

    // Loyer estimé = valeur × rendement / 12
    loyerMensuel = Math.round((valeur * (zoneInfo.yieldPct / 100)) / 12);
    // Appliquer l'ajustement DPE sur le loyer
    loyerMensuel = Math.round(loyerMensuel * (1 + dpeMod));
    loyerEstime = true;
  }

  const loyerAnnuel = loyerMensuel * 12;

  // 4. Charges estimées si non fournies (environ 30% du loyer brut)
  const charges = charges_annuelles ?? Math.round(loyerAnnuel * 0.30);

  // 5. Calculs
  const rendementBrut = ((loyerAnnuel / valeur) * 100);
  const rendementNet = (((loyerAnnuel - charges) / valeur) * 100);

  // 6. Analyse qualitative
  let verdict;
  if (rendementNet >= 7) verdict = 'Excellent — rendement très attractif.';
  else if (rendementNet >= 5) verdict = 'Bon — au-dessus de la moyenne nationale.';
  else if (rendementNet >= 3.5) verdict = 'Correct — dans la moyenne.';
  else if (rendementNet >= 2) verdict = 'Faible — rendement inférieur à la moyenne.';
  else verdict = 'Très faible — investissement peu rentable en locatif.';

  // Alertes spécifiques
  const alertes = [...(valuation.alertes || [])];
  if (rendementBrut < 3) {
    alertes.push('Rendement brut < 3% — envisager la plus-value plutôt que le locatif.');
  }
  if (loyerEstime) {
    alertes.push('Loyer estimé statistiquement. Fournissez loyer_mensuel pour un calcul précis.');
  }
  if (valuation.zone_tendue) {
    alertes.push('Zone tendue : plafonnement de loyer possible. Le rendement réel peut être inférieur.');
  }

  return {
    adresse_normalisee: valuation.adresse_normalisee,
    coordonnees: valuation.coordonnees,
    rendement: {
      rendement_brut_pct:   Math.round(rendementBrut * 100) / 100,
      rendement_net_pct:    Math.round(rendementNet * 100) / 100,
      loyer_mensuel:        loyerMensuel,
      loyer_annuel:         loyerAnnuel,
      loyer_est_estime:     loyerEstime,
      charges_annuelles:    charges,
      prix_achat:           valeur,
      prix_achat_est_estime: !prix_achat,
      verdict,
    },
    estimation: valuation.estimation,
    energie: valuation.energie,
    zone_tendue: valuation.zone_tendue,
    commune: commune ? { nom: commune.nom, population: commune.population } : null,
    alertes,
    meta: {
      sources: ['BAN', 'DVF', 'DPE-ADEME', 'INSEE'],
      generated_at: new Date().toISOString(),
      methode: loyerEstime ? 'estimation_statistique' : 'loyer_reel',
    },
  };
}

module.exports = { calculerRendement };
