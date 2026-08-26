# Assets — Grand Colonies

Génération, stockage et contrôle qualité des images du jeu.

Spécification de référence : [../SPEC_ASSETS_IMAGES.md](../SPEC_ASSETS_IMAGES.md)

---

## Architecture

```text
assets/
├── prompts.json              source de vérité : 28 images, leurs prompts et priorités
├── generated/                sorties brutes de l'IA, jamais retouchées à la main
│   ├── tiles/                tile_forest.png … 1024×1024, carrées
│   ├── cards/                card_dev_*.png, card_obj_*.png, card_back_*.png … 2:3
│   └── backgrounds/          bg_*.png … 16:9
├── processed/                versions retouchées / converties pour l'application
│   ├── tiles/
│   ├── cards/
│   └── backgrounds/
└── preview/
    └── index.html            planche de contrôle qualité (à ouvrir dans un navigateur)
```

**Pourquoi `generated/` et `processed/` sont séparés** : une image générée peut être régénérée à l'identique depuis `prompts.json`, alors qu'une image retouchée ne le peut pas. Garder les deux permet de tout refaire sans perdre le travail manuel. `generated/` ne se modifie jamais à la main.

**Les tuiles sont carrées, pas hexagonales.** Le découpage en hexagone est fait à l'affichage par un masque CSS/SVG, côté client. Une IA ne produit pas une géométrie assez précise pour que des hexagones se juxtaposent sans couture. C'est la règle la plus importante du pipeline.

---

## Utilisation

### 1. Fournir la clé API

La clé n'est **jamais** écrite dans le dépôt. Deux options :

```bash
export GEMINI_API_KEY="ta-clé"
```

ou un fichier `.env` à la racine du projet (déjà présent dans `.gitignore`) :

```bash
echo 'GEMINI_API_KEY=ta-clé' > .env
```

Clé à créer sur [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

### 2. Vérifier avant de dépenser

```bash
node scripts/generate-assets.mjs --list
```

```bash
node scripts/generate-assets.mjs --dry-run --priority P0
```

`--dry-run` affiche les prompts composés sans appeler l'API : utile pour relire ce qui va être envoyé.

### 3. Générer

```bash
node scripts/generate-assets.mjs --priority P0
```

Une image déjà présente est ignorée. Pour la refaire :

```bash
node scripts/generate-assets.mjs --id tile_forest --force
```

### 4. Contrôler

Ouvrir `assets/preview/index.html` dans un navigateur. La page affiche les tuiles à leur taille réelle (120 px), un plateau de démonstration pour vérifier la tessellation, et la checklist qualité.

---

## Priorités

| Priorité | Contenu | Nb | Quand |
|---|---|---:|---|
| **P0** | Tuiles de terrain de base | 6 | Nécessaire à la première version jouable |
| **P1** | Mer, or, poisson, inexploré | 4 | Ruleset complet |
| **P2** | Cartes et dos de cartes | 15 | Après validation du gameplay |
| **P3** | Fonds d'écran | 3 | Confort, non bloquant |

Générer P0 d'abord, contrôler, ajuster les prompts si besoin, puis continuer. Le périmètre du jeu n'étant pas encore validé par playtest, générer les 28 images d'un coup revient à payer pour des assets qui pourraient être coupés.

---

## Coût

Tarifs relevés le 26/08/2026 sur [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing). **Aucun palier gratuit n'existe pour la génération d'images** : la facturation doit être activée sur le projet Google.

| Modèle | Prix / image (1K) | Notes |
|---|---:|---|
| Nano Banana 2 Lite (`gemini-3.1-flash-lite-image`) | 0,034 $ | `--cheap` |
| Nano Banana 2 (`gemini-3.1-flash-image`) | 0,067 $ | **défaut** — 0,101 $ en 2K |
| Nano Banana Pro (`gemini-3-pro-image`) | 0,134 $ | `--best` |
| Nano Banana (`gemini-2.5-flash-image`) | 0,039 $ | retiré le 02/10/2026, à éviter |

L'API Batch applique **-50 %** sur tous ces tarifs, au prix d'un traitement asynchrone : intéressant pour le passage final une fois les prompts figés, inadapté au travail itératif.

### Estimation pour les 28 images

| Scénario | Générations | Lite | Défaut | Pro |
|---|---:|---:|---:|---:|
| Passage unique, sans reprise | 28 | 0,94 $ | ~2,20 $ | 3,75 $ |
| **Réaliste** (tuiles ×4, cartes ×2,5, fonds ×2) | ~84 | 2,80 $ | ~6,70 $ | 11,30 $ |
| P0 seul, réaliste (6 tuiles ×4) | 24 | 0,81 $ | 1,61 $ | 3,22 $ |

Le facteur d'itération domine le coût. Il est élevé sur les tuiles parce que la contrainte n'est pas la beauté d'une image isolée mais la **cohérence de la série** : une tuile qui sort du style oblige à la régénérer, parfois plusieurs fois.

Le coût des tokens d'entrée (les prompts, ~200 tokens chacun) est négligeable : moins de 0,05 $ sur l'ensemble.

Le script affiche le modèle retenu et le coût estimé avant de générer, puis laisse 4 secondes pour annuler (`--yes` pour passer outre).

---

## Modèle utilisé

Le script **ne code aucun nom de modèle en dur**. Il interroge l'API pour trouver les modèles de génération d'image disponibles sur la clé et choisit selon le palier demandé.

C'est délibéré : les modèles d'image de Google changent souvent — la famille Imagen a été arrêtée le 17 août 2026 au profit de Nano Banana, et Nano Banana lui-même s'arrête le 2 octobre 2026. Un nom codé en dur casserait le script à la prochaine rotation.

Par défaut, le script privilégie un modèle **flash** plutôt que **pro**. Sur ce projet la difficulté est la cohérence d'une série de tuiles, pas le rendu d'une image isolée — un modèle pro coûte le double sans mieux y répondre.

```bash
node scripts/generate-assets.mjs --priority P0            # flash (défaut)
node scripts/generate-assets.mjs --priority P0 --cheap    # lite
node scripts/generate-assets.mjs --priority P0 --best     # pro
node scripts/generate-assets.mjs --model gemini-3-pro-image --priority P0
```

---

## Ce qui n'est pas généré par IA

| Élément | Raison | Solution |
|---|---|---|
| Routes, colonies, villes, comptoirs | Recolorés dans 12 couleurs à l'exécution | Formes SVG paramétrées |
| Jetons numérotés 2–12, ports | Du texte | Typographie SVG |
| Icônes de ressources | Doivent rester nettes à 24 px | [game-icons.net](https://game-icons.net), CC BY 4.0 |
| Icônes d'interface | — | lucide-react |
| Logo / titre | Du texte | Typographie |
