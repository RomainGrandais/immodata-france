'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT =
  'Tu es un expert immobilier français. À partir des données suivantes, génère un résumé factuel ' +
  'de 2-3 phrases en français pour un agent IA ou un investisseur. Sois précis et actionnable.';

async function generateSummary(payload) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return 'Résumé IA indisponible (clé API manquante).';
  }

  const client = new Anthropic({ apiKey });

  const userContent = buildPromptContent(payload);

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  return message.content[0]?.text?.trim() || 'Résumé indisponible.';
}

function buildPromptContent({ adresse, commune, marche, energie, reglementaire }) {
  const lines = [`Adresse : ${adresse}`];

  if (commune) {
    lines.push(`Commune : ${commune.nom} (${commune.code_insee}), population ${commune.population?.toLocaleString('fr-FR') ?? 'inconnue'}`);
  }

  if (marche) {
    lines.push(`Prix médian au m² : ${marche.prix_m2_median?.toLocaleString('fr-FR') ?? 'N/A'} €/m²`);
    lines.push(`Nombre de transactions (24 mois) : ${marche.nb_transactions_24m}`);
    lines.push(`Tendance des prix sur 12 mois : ${marche.tendance_12m ?? 'N/A'}`);
    lines.push(`Dernière transaction : ${marche.derniere_transaction ?? 'N/A'}`);
  } else {
    lines.push('Données de marché : insuffisantes dans ce secteur');
  }

  if (energie) {
    lines.push(`DPE dominant : ${energie.dpe_lettre}`);
    lines.push(`Alerte loi Le Meur : ${energie.alerte_loi_lemeur ? 'Oui' : 'Non'}`);
    lines.push(`Éligible location courte durée : ${energie.eligible_location_courte_duree ? 'Oui' : 'Non'}`);
    if (energie.travaux_requis_avant) {
      lines.push(`Travaux requis avant : ${energie.travaux_requis_avant}`);
    }
  } else {
    lines.push('Données DPE : non disponibles pour ce secteur');
  }

  if (reglementaire) {
    lines.push(`Zone tendue : ${reglementaire.zone_tendue ? 'Oui' : 'Non'}`);
  }

  return lines.join('\n');
}

module.exports = { generateSummary };
