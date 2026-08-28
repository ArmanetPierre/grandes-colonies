# Assets — Grand Colonies

Génération, stockage et contrôle qualité des images du jeu.

Spécification de référence : [../SPEC_ASSETS_IMAGES.md](../SPEC_ASSETS_IMAGES.md)

---

## Architecture

```text
assets/
├── prompts.json              source de vérité : 29 images, leurs prompts et priorités
├── generated/                sorties brutes de l'IA, jamais retouchées à la main
│   ├── index.json            identifiant -> chemin réel du fichier
│   ├── index.js              même contenu, chargeable en file:// par la planche
│   ├── sheets/               sheet_terrains — la planche de série, jamais affichée en jeu
│   ├── tiles/                tile_forest.jpg … 1024×1024, carrées
│   ├── cards/                card_dev_*, card_obj_*, card_back_* … 2:3
│   └── backgrounds/          bg_* … 16:9
├── processed/                versions étalonnées, qui priment sur generated/
│   └── tiles/                mêmes noms de fichiers : remplacement pur
└── preview/
    └── index.html            planche de contrôle qualité (à ouvrir dans un navigateur)
```

**Pourquoi `generated/` et `processed/` sont séparés** : une image générée peut être régénérée à l'identique depuis `prompts.json`, alors qu'une image retouchée ne le peut pas. Garder les deux permet de tout refaire sans rien perdre. `generated/` ne se modifie jamais à la main.

**Le modèle donne la matière, le code donne les nombres.** Trois itérations de prompt ont montré qu'il ne tient pas une échelle de valeurs — il respecte le sens et lâche la mesure, toujours là où son a priori est fort. `scripts/etalonner.py` impose après coup la luminosité, la saturation et le contraste, exactement, gratuitement, et de façon réversible. Voir [../SPEC_ASSETS_IMAGES.md](../SPEC_ASSETS_IMAGES.md) §9.

**Les tuiles ne sont jamais générées seules.** `sheet_terrains` montre les dix terrains dans un seul cadre ; chaque tuile la déclare en `ref` et le script la joint à la demande. L'harmonie est une propriété *relationnelle* : dix images décrites séparément ne se sont jamais vues, et elles dérivent — c'est ce qui est arrivé à la première série. Voir [../SPEC_ASSETS_IMAGES.md](../SPEC_ASSETS_IMAGES.md) §3.

**Les tuiles sont carrées, pas hexagonales.** Le découpage en hexagone est fait à l'affichage par un masque CSS/SVG, côté client. Une IA ne produit pas une géométrie assez précise pour que des hexagones se juxtaposent sans couture. C'est la règle la plus importante du pipeline.

**L'extension des fichiers n'est pas fixe.** Le modèle renvoie du JPEG ou du PNG selon les cas ; le script nomme le fichier d'après son contenu réel et tient à jour `index.json` / `index.js`. Tout consommateur (planche de contrôle, futur client) doit passer par cet index plutôt que deviner l'extension.

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

### 3. Générer — la planche d'abord

```bash
node scripts/generate-assets.mjs --id sheet_terrains --best
```

À regarder avant d'aller plus loin : elle fixe la gamme, la matière, la lumière et l'échelle de valeurs de toute la série. Tant qu'elle n'est pas bonne, la régénérer coûte une image ; la laisser passer en coûte dix.

```bash
node scripts/generate-assets.mjs --priority P0
```

Les tuiles sont alors générées **avec la planche jointe**. Une référence absente fait échouer la génération plutôt que de produire une image hors gamme. `--no-ref` passe outre — pour comparer ou dépanner, pas pour produire.

Une image déjà présente est ignorée. Pour la refaire :

```bash
node scripts/generate-assets.mjs --id tile_forest --force
```

Régénérer la planche invalide la série : les tuiles doivent suivre (`--priority P0 --force`).

### 4. Étalonner

```bash
python3 scripts/etalonner.py
```

Ramène chaque tuile sur son barreau — luminosité, saturation, contraste — et écrit dans `processed/tiles/` sous le même nom. `generated/` n'est pas touché, et l'étape se rejoue autant qu'on veut sans rien coûter.

Ce qu'elle ne rattrape pas : la géométrie. Un aplat reste un aplat, une bande continue reste une bande. Ces défauts-là se régénèrent.

### 5. Contrôler — la mesure avant l'œil

```bash
python3 scripts/mesure-gamme.py --planche
```

Mesure les dix panneaux de la planche **avant** d'en tirer les tuiles : un barreau inversé s'y corrige pour le prix d'une image, et pour celui de dix si on ne le voit qu'après.

```bash
python3 scripts/mesure-gamme.py
```

Mesure les tuiles telles qu'elles partiront — étalonnées si elles le sont — et sort en code 1 si une seule s'écarte de son barreau. `--brut` mesure la sortie du modèle avant étalonnage : c'est elle qui dit s'il faut régénérer.

```bash
python3 scripts/contact-sheet.py /tmp/planches
```

Produit `planche_120px.png`, `planche_gris.png` (le test le plus sévère : sans la teinte, il ne reste que la valeur) et `planche_plateau.png`.

`assets/preview/index.html` reste la planche complète à ouvrir dans un navigateur — tuiles à leur taille réelle, plateau de démonstration, checklist.

### 6. Mettre à la portée du client

```bash
npm run assets
```

Le client demande ses images à `/assets/…`, donc depuis `packages/client/public/`,
qui est **ignoré par git** — il est donc vide sur un dépôt fraîchement cloné.
Rien ne reliait les deux : les images étaient générées ici, le client les
cherchait là, et personne ne faisait le trajet. Le plateau s'affichait alors
sans ses terrains, sans qu'aucun message ne signale l'étape manquante.

Une tuile présente dans `processed/` prime sur sa version brute : c'est elle
qui tient l'échelle de valeurs. La commande le signale (« dont 10 étalonnée(s) »).

`npm run play` fait la copie au démarrage ; la commande ci-dessus la refait à
la demande, et `node scripts/assets.mjs --force` écrase ce qui est déjà en
place après une régénération ou un étalonnage.

---

## Priorités

| Priorité | Contenu | Nb | Quand |
|---|---|---:|---|
| **REF** | Planche de série | 1 | **Avant tout le reste** — elle contraint les dix tuiles |
| **P0** | Tuiles de terrain de base | 6 | Nécessaire à la première version jouable |
| **P1** | Mer, or, poisson, inexploré | 4 | Ruleset complet |
| **P2** | Cartes et dos de cartes | 15 | Après validation du gameplay |
| **P3** | Fonds d'écran | 3 | Confort, non bloquant |

Générer REF d'abord et la valider, puis P0, contrôler, ajuster les prompts si besoin, puis continuer. Le périmètre du jeu n'étant pas encore validé par playtest, générer les 29 images d'un coup revient à payer pour des assets qui pourraient être coupés.

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

### Estimation pour les 29 images

| Scénario | Générations | Lite | Défaut | Pro |
|---|---:|---:|---:|---:|
| Passage unique, sans reprise | 29 | 0,97 $ | ~2,25 $ | 3,89 $ |
| **Réaliste** (tuiles ×4, cartes ×2,5, fonds ×2) | ~84 | 2,80 $ | ~6,70 $ | 11,30 $ |
| P0 seul, réaliste (6 tuiles ×4) | 24 | 0,81 $ | 1,61 $ | 3,22 $ |

Le facteur d'itération domine le coût. Il est élevé sur les tuiles parce que la contrainte n'est pas la beauté d'une image isolée mais la **cohérence de la série** : une tuile qui sort du style oblige à la régénérer, parfois plusieurs fois.

C'est précisément ce que la planche de série vise à réduire : les itérations se concentrent sur une image au lieu de dix, et les tuiles suivent. Le facteur ×4 de la ligne « réaliste » date d'avant ce changement — il reste l'hypothèse prudente tant qu'un passage complet ne l'a pas remesuré.

Le coût des tokens d'entrée (les prompts, ~250 tokens chacun) est négligeable. Les images de référence jointes aux tuiles s'y ajoutent — une image en entrée coûte quelques centaines de tokens, soit un ordre de grandeur sous le prix d'une image générée. Une planche qui évite une seule régénération est déjà rentable.

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
