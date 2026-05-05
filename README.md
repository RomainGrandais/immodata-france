# ImmoData France API

API REST qui agrège en temps réel les données immobilières publiques françaises (DVF, DPE, BAN, INSEE) en un format JSON unique, enrichi d'un résumé en langage naturel généré par Claude. Conçue pour les agents IA, les LLMs et les investisseurs qui ont besoin de données contextualisées sur un bien ou une adresse.

---

## Démarrage rapide

### Prérequis

- Node.js ≥ 18
- Une clé API Anthropic : [console.anthropic.com](https://console.anthropic.com)

### Installation

```bash
git clone <repo>
cd immodata-france
npm install
cp .env.example .env
# → Renseignez ANTHROPIC_API_KEY dans .env
npx vercel dev
```

---

## Endpoint

```
GET /v1/bien?adresse={adresse_complete}
```

### Paramètres

| Paramètre | Type   | Requis | Description                                      |
|-----------|--------|--------|--------------------------------------------------|
| `adresse` | string | Oui    | Adresse textuelle française complète             |
| `format`  | string | Non    | `"ai"` (défaut) ou `"raw"` (sans `ai_summary`)  |

---

## Exemple de requête

```bash
curl "https://votre-api.vercel.app/v1/bien?adresse=12%20rue%20de%20la%20Paix%20Lyon"
```

---

## Exemple de réponse complète

```json
{
  "adresse_normalisee": "12 Rue de la Paix, 69001 Lyon",
  "coordonnees": {
    "lat": 45.764,
    "lon": 4.835
  },
  "commune": {
    "nom": "Lyon",
    "code_insee": "69123",
    "population": 522969
  },
  "marche": {
    "prix_m2_median": 4850,
    "nb_transactions_24m": 34,
    "tendance_12m": "+2.1%",
    "derniere_transaction": "2024-09"
  },
  "energie": {
    "dpe_lettre": "D",
    "alerte_loi_lemeur": false,
    "eligible_location_courte_duree": true,
    "travaux_requis_avant": "2028"
  },
  "reglementaire": {
    "zone_tendue": true,
    "encadrement_loyers": false
  },
  "ai_summary": "Le marché immobilier autour du 12 rue de la Paix à Lyon affiche un prix médian de 4 850 €/m² en hausse de +2,1 % sur 12 mois, témoignant d'une demande soutenue dans ce secteur en zone tendue. Le DPE dominant de classe D impose des travaux avant 2028 pour maintenir l'éligibilité à la location courte durée, sans risque immédiat d'interdiction de mise en location. Pour un investisseur, la fenêtre d'acquisition reste favorable mais la planification des rénovations énergétiques est à intégrer dès maintenant dans le business plan.",
  "meta": {
    "sources": ["BAN", "DVF", "DPE-ADEME", "INSEE"],
    "generated_at": "2026-05-04T10:00:00.000Z",
    "rayon_metres": 500
  }
}
```

---

## Description des champs

### Racine

| Champ                | Type   | Description                                              |
|----------------------|--------|----------------------------------------------------------|
| `adresse_normalisee` | string | Adresse standardisée par la BAN                          |
| `coordonnees`        | object | Latitude / longitude WGS84                               |
| `commune`            | object | Données de la commune (INSEE)                            |
| `marche`             | object | Données de marché DVF (transactions récentes)            |
| `energie`            | object | DPE et réglementation locative                           |
| `reglementaire`      | object | Zone tendue, encadrement des loyers                      |
| `ai_summary`         | string | Résumé 2-3 phrases généré par Claude (absent si `raw`)   |
| `meta`               | object | Métadonnées : sources, date, rayon                       |

### `marche`

| Champ                   | Type    | Description                                          |
|-------------------------|---------|------------------------------------------------------|
| `prix_m2_median`        | number  | Prix médian au m² sur 24 mois, hors valeurs aberrantes |
| `nb_transactions_24m`   | number  | Nombre de transactions logements dans le rayon       |
| `tendance_12m`          | string  | Évolution 0-12m vs 12-24m, ex: `"+2.1%"`             |
| `derniere_transaction`  | string  | Format `"AAAA-MM"` de la transaction la plus récente |

> Si les données sont insuffisantes, `marche` contient `message: "Données insuffisantes dans ce secteur"`.

### `energie`

| Champ                          | Type    | Description                                              |
|--------------------------------|---------|----------------------------------------------------------|
| `dpe_lettre`                   | string  | Lettre DPE la plus fréquente dans le rayon (A → G)       |
| `alerte_loi_lemeur`            | boolean | `true` si DPE F ou G (interdiction progressive de location) |
| `eligible_location_courte_duree` | boolean | Éligibilité actuelle à la LCD                          |
| `travaux_requis_avant`         | string  | Année limite pour travaux obligatoires (`null` si aucun) |

> `null` si aucun DPE disponible dans le rayon de 500m.

### `reglementaire`

| Champ                | Type    | Description                                            |
|----------------------|---------|--------------------------------------------------------|
| `zone_tendue`        | boolean | `true` si la commune est classée en zone tendue        |
| `encadrement_loyers` | boolean | `true` si l'encadrement des loyers est actif (décret municipal) |

---

## Designed for AI agents

Le champ `ai_summary` est le différenciateur clé de cette API. Généré par **Claude Haiku** à chaque requête, il transforme les données brutes en un paragraphe actionnable directement exploitable par :

- Un **agent IA** qui analyse un portefeuille immobilier
- Un **chatbot** qui répond à des questions d'investisseurs
- Un **LLM orchestrateur** qui compare plusieurs biens
- Un **RAG pipeline** qui enrichit ses embeddings avec du contexte marché

Le résumé est contextualisé selon la disponibilité des données : si DVF ou DPE sont absents, le modèle l'indique explicitement sans halluciner de valeurs.

**Exemple d'intégration dans un prompt système :**
```
Tu es un conseiller immobilier. Pour chaque bien, tu reçois une fiche JSON
avec un champ "ai_summary". Utilise ce résumé comme contexte de marché.
```

---

## Sources de données

| Source            | Organisme      | URL                                         | Mise à jour    |
|-------------------|----------------|---------------------------------------------|----------------|
| **BAN**           | IGN / Etalab   | `api-adresse.data.gouv.fr`                  | Temps réel     |
| **DVF**           | DGFiP / Etalab | `api.cquest.org/dvf`                        | Trimestrielle  |
| **DPE ADEME**     | ADEME           | `data.ademe.fr`                             | Continue       |
| **Géo INSEE**     | INSEE           | `geo.api.gouv.fr`                           | Annuelle       |

Toutes les sources sont **gratuites, ouvertes et sans authentification**.

---

## Codes d'erreur

| Code HTTP | Cause                                              |
|-----------|----------------------------------------------------|
| `400`     | Paramètre `adresse` manquant ou trop court         |
| `404`     | Adresse non trouvée dans la BAN                    |
| `405`     | Méthode non autorisée (utiliser GET)               |
| `429`     | Rate limit atteint (100 req/min par IP)            |
| `503`     | Timeout global dépassé (10 secondes)               |
| `500`     | Erreur interne inattendue                          |

---

## Variables d'environnement

| Variable            | Description                        | Obligatoire |
|---------------------|------------------------------------|-------------|
| `ANTHROPIC_API_KEY` | Clé API Anthropic pour Claude Haiku | Oui         |

---

## Déploiement Vercel

```bash
vercel deploy
# Puis configurer la variable d'environnement :
vercel env add ANTHROPIC_API_KEY
```

Le `vercel.json` est préconfiguré avec un `maxDuration` de 15 secondes pour absorber la latence des APIs externes.

---

## Limites connues

- **DVF** : les transactions sont mises à jour trimestriellement — les prix peuvent avoir 3 mois de décalage.
- **DPE** : le rayon de 500m peut ne couvrir aucun DPE en zone rurale.
- **Encadrement des loyers** : non détectable via open data seul — toujours vérifier auprès de la mairie.
- **Stateless** : aucune mise en cache côté serveur — chaque requête rappelle toutes les APIs.

---

## Licence

MIT — données sources sous licences ouvertes (Licence Ouverte v2.0 / ODbL).
