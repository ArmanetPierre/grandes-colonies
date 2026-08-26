# Spécification des images — Grand Colonies

> Document destiné à la **génération d'images par une IA externe** (Midjourney, DALL·E, Stable Diffusion, Firefly…).
>
> Il décrit le contenu, le format et les dimensions de chaque image, avec des prompts prêts à copier.
>
> Projet : [PLAN_DE_DEVELOPPEMENT.md](PLAN_DE_DEVELOPPEMENT.md) · Écrans : [SPEC_ECRANS.md](SPEC_ECRANS.md)

---

## 1. À lire avant de générer quoi que ce soit

### 1.1 Trois règles qui conditionnent le résultat

**① Ne jamais demander une forme hexagonale à l'IA.**
Les tuiles doivent se juxtaposer au pixel près. Une IA ne produira jamais des hexagones assez précis pour tessellier. On génère donc des **images carrées** de texture de terrain, et le client les découpe en hexagone avec un masque SVG. C'est la règle la plus importante du document.

**② Ne jamais demander de texte, de chiffre ou de symbole.**
Les modèles d'image restent peu fiables sur le texte. Tous les chiffres (jetons 2–12), ratios de ports (3:1, 2:1), noms de cartes et libellés sont produits en typographie dans le code.

**③ La cohérence prime sur la beauté.**
Dix tuiles jolies mais de styles différents donnent un plateau illisible. Chaque prompt doit se terminer par le **suffixe de style commun** du §2.3, sans exception. Si une image sort du lot, la régénérer plutôt que l'accepter.

### 1.2 Ce qui ne doit PAS être généré par IA

| Élément | Pourquoi | Solution retenue |
|---|---|---|
| Routes, colonies, villes, comptoirs, chevaliers | Doivent être recolorés dynamiquement dans 12 couleurs | Formes SVG paramétrées |
| Jetons numérotés 2–12 | Du texte | Typographie SVG |
| Ports (3:1, 2:1) | Du texte | Icône + typographie |
| Icônes de ressources (bois, laine, blé, brique, minerai) | Doivent rester nettes à 24 px | [game-icons.net](https://game-icons.net), CC BY 4.0 |
| Icônes d'interface | — | lucide-react |
| Logo / titre du jeu | Du texte | Typographie |

### 1.3 Priorités

Ne pas tout générer d'un coup : le périmètre du jeu n'est pas encore validé par playtest.

| Priorité | Contenu | Quand |
|---|---|---|
| **P0** | 6 tuiles de terrain de base | Nécessaire à la vertical slice (Phase 4) |
| **P1** | 4 tuiles additionnelles (mer, or, poisson, inexploré) | Phase 7, ruleset complet |
| **P2** | Illustrations et dos de cartes | Après validation du gameplay |
| **P3** | Fonds d'écran d'ambiance | Confort, non bloquant |

---

## 2. Direction artistique

### 2.1 Style retenu

Illustration numérique stylisée, **vue strictement de dessus** (orthographique, aucune perspective), lumière douce et uniforme, sans ombres portées marquées. Palette saturée mais légèrement sourde. Rendu peint mais propre, jamais photoréaliste.

### 2.2 Contraintes de lisibilité

Ce sont des contraintes fonctionnelles, pas esthétiques : des pièces de jeu seront dessinées **par-dessus** ces images.

- **Centre calme** : le centre de chaque tuile accueille un jeton numéroté opaque. Éviter tout détail important au centre.
- **Bords calmes** : les routes se dessinent sur les arêtes, les colonies sur les sommets. Les bords doivent être visuellement neutres, sans motif fort ni contraste élevé.
- **Faible bruit visuel** : la tuile doit rester identifiable à 120 px de large.
- **Pas de vignettage ni d'assombrissement des bords** : cela créerait des coutures visibles entre tuiles adjacentes.
- **Pas de cadre, pas de bordure, pas de contour.**
- Composition **plein cadre** : le motif remplit tout le carré, jusqu'aux quatre bords.

### 2.3 Suffixe de style commun

À ajouter **à la fin de chaque prompt de tuile**, tel quel :

```text
stylized digital board game illustration, top-down orthographic view, soft even
lighting, no cast shadows, muted saturated colors, painterly but clean, low
visual noise, calm uniform composition with no focal point in the center,
edges visually quiet and continuous, full-bleed square composition filling the
entire canvas, no text, no borders, no frame, no vignette
```

### 2.4 Prompt négatif commun

```text
text, letters, numbers, watermark, signature, logo, frame, border, vignette,
UI elements, buttons, people, characters, animals in foreground, hexagon shape,
hexagonal tile, perspective view, tilted camera, isometric, harsh shadows,
photorealistic, high contrast details near edges, dark corners
```

### 2.5 Palette de référence

Chaque tuile doit rester reconnaissable **par sa couleur dominante seule**, plateau dézoomé. Ces valeurs sont à citer dans les prompts et à vérifier après génération.

| Tuile | Ressource | Couleur dominante |
|---|---|---|
| Forêt | Bois | `#2F6B3C` vert forêt |
| Pâturage | Laine | `#9CCB5B` vert clair |
| Champ | Blé | `#E8B93B` jaune doré |
| Colline | Brique | `#C55A2B` terre cuite |
| Montagne | Minerai | `#6E7B8B` gris ardoise |
| Désert | — | `#D9C9A3` sable pâle |
| Mer | — | `#2E6F9E` bleu profond |
| Or | Or | `#7A5C2E` roche sombre + `#FFD866` veines |
| Poisson | Poisson | `#3FA9A0` turquoise |
| Inexploré | — | `#5B5670` gris-violet |

Les tuiles Or et Champ sont les plus proches en teinte : c'est pourquoi la tuile Or est spécifiée **globalement sombre** avec des veines lumineuses, ce qui les sépare par la luminosité et non par la teinte.

---

## 3. Formats et dimensions

| Catégorie | Dimensions source | Ratio | Format | Fond |
|---|---|---|---|---|
| Tuile de terrain | **1024 × 1024 px** | 1:1 | PNG | opaque, plein cadre |
| Illustration de carte | **1024 × 1536 px** | 2:3 | PNG | opaque |
| Dos de carte | **1024 × 1536 px** | 2:3 | PNG | opaque |
| Fond d'écran | **2560 × 1440 px** | 16:9 | PNG | opaque |

**Pourquoi 1024 px pour une tuile affichée à ~120 px ?** Le plateau comporte 44 à 52 hexagones sur une zone d'environ 1100 × 800 px, soit ~120 px de large par tuile en vue d'ensemble. Le facteur 8× de la source couvre les écrans haute densité et le zoom rapproché sans repasser par une regénération.

**Livraison** : PNG en source (archivés), convertis en WebP pour l'application. Pas de contrainte de poids sévère — le jeu tourne en LAN.

**Nommage** :

```text
tile_forest.png       tile_pasture.png     tile_field.png
tile_hills.png        tile_mountain.png    tile_desert.png
tile_sea.png          tile_gold.png        tile_fish.png
tile_unexplored.png

card_dev_knight.png   card_back_dev.png    bg_lobby.png
```

Minuscules, `snake_case`, préfixe de catégorie, anglais.

---

## 4. P0 — Tuiles de terrain de base

**6 images · 1024 × 1024 px · PNG**

Rappel : ajouter le suffixe §2.3 à chaque prompt, et le prompt négatif §2.4.

### 4.1 `tile_forest.png` — Forêt (bois)

```text
Dense coniferous forest canopy seen from directly above, tightly packed rounded
treetops of varying sizes, deep forest green #2F6B3C with subtle darker and
lighter green variation, hints of brown forest floor barely visible between
trees, uniform density across the whole image
```

### 4.2 `tile_pasture.png` — Pâturage (laine)

```text
Gently rolling green pasture seen from directly above, short soft grass with
subtle mounds and a few small scattered shrubs, light fresh green #9CCB5B,
smooth and calm surface, evenly distributed texture
```

### 4.3 `tile_field.png` — Champ (blé)

```text
Golden wheat field seen from directly above, regular parallel furrows of ripe
grain crossing the image diagonally, warm golden yellow #E8B93B with soft amber
variation, gentle and even texture
```

### 4.4 `tile_hills.png` — Colline (brique)

```text
Red clay hills seen from directly above, exposed terracotta earth with soft
rounded ridges and shallow eroded channels, warm terracotta #C55A2B with ochre
and rust variation, sparse dry vegetation
```

### 4.5 `tile_mountain.png` — Montagne (minerai)

```text
Bare rocky mountain terrain seen from directly above, angular grey stone ridges
and fractured rock faces, slate grey #6E7B8B with cool blue-grey and pale
highlights, patches of scree, no snow
```

### 4.6 `tile_desert.png` — Désert

```text
Pale sand dunes seen from directly above, fine parallel wind ripples in the
sand, warm pale sand #D9C9A3, a few scattered small stones, very calm and
uniform surface
```

---

## 5. P1 — Tuiles additionnelles

**4 images · 1024 × 1024 px · PNG**

### 5.1 `tile_sea.png` — Mer

```text
Calm deep open sea seen from directly above, gentle regular wave texture with
soft foam highlights, deep blue #2E6F9E with teal and navy variation, uniform
across the whole image
```

> Cette tuile est très répétée sur le plateau. Elle doit être la plus neutre de toutes.

### 5.2 `tile_gold.png` — Or

```text
Dark rocky terrain veined with bright gold ore seen from directly above, deep
brown-grey rock #7A5C2E fractured by a network of luminous glittering gold
veins #FFD866, the rock clearly dominant and dark, gold veins thin and radiant
```

### 5.3 `tile_fish.png` — Zone de pêche

```text
Shallow turquoise coastal water seen from directly above, pale sandy seabed
visible through clear water, small schools of tiny fish as soft dark shapes,
turquoise #3FA9A0 with pale sand tones, gentle ripples
```

### 5.4 `tile_unexplored.png` — Territoire inexploré

```text
Thick swirling fog concealing unknown terrain seen from directly above, dense
opaque grey-violet mist #5B5670 with soft curling volutes, nothing identifiable
underneath, mysterious and completely uniform
```

> Cette tuile est **volontairement opaque** : elle masque une information que le serveur ne transmet pas encore au client. Rien de ce qui se trouve dessous ne doit être devinable.

---

## 6. P2 — Cartes

**1024 × 1536 px (ratio 2:3) · PNG**

L'illustration occupe le **tiers supérieur** de la carte ; le titre et le texte de règle sont composés en typographie par-dessus la partie basse. Générer donc une image dont le sujet est **centré dans le haut**, avec un bas visuellement calme.

### 6.1 Cartes développement (6)

| Fichier | Sujet |
|---|---|
| `card_dev_knight.png` | Chevalier casqué de profil, bouclier, style héraldique sobre |
| `card_dev_road.png` | Route de pierre serpentant vers l'horizon entre deux collines |
| `card_dev_invention.png` | Établi d'artisan avec plans et outils, ambiance atelier |
| `card_dev_monopoly.png` | Entrepôt portuaire rempli de caisses et de tonneaux identiques |
| `card_dev_freebuild.png` | Chantier de construction avec échafaudages de bois |
| `card_dev_politics.png` | Sceau de cire et parchemin roulé sur une table de conseil |

Suffixe de style pour les cartes (différent de celui des tuiles, car ici la perspective est permise) :

```text
stylized digital illustration for a fantasy board game card, medieval trading
colony setting, warm painterly rendering, soft lighting, muted saturated
palette matching earth tones and deep greens, subject centered in the upper
half, lower third calm and uncluttered, no text, no frame, no border
```

### 6.2 Cartes objectifs (6)

Reprendre les objectifs du game design (§21) : Grand commerçant, Explorateur, Seigneur militaire, Magnat, Architecte, Diplomate. Même suffixe de style, sujets respectifs : comptoir animé, voilier et carte marine, bannière militaire, coffre d'or, cité en construction, poignée de main sous un dais.

### 6.3 Dos de cartes (3)

`card_back_dev.png`, `card_back_objective.png`, `card_back_contract.png`

```text
Ornamental card back pattern for a board game, symmetrical radial design,
subtle repeating motif, single dominant color with gold accents, flat
decorative style, no text, no central emblem with letters, fills the entire
card, calm and elegant
```

Une couleur dominante différente par type de paquet, pour les distinguer dos visible.

---

## 7. P3 — Fonds d'écran

**2560 × 1440 px · PNG**

| Fichier | Usage | Sujet |
|---|---|---|
| `bg_lobby.png` | Écrans Rejoindre et Lobby | Vue large d'un archipel au lever du jour, très désaturé, contraste faible |
| `bg_host.png` | Console hôte | Carte marine ancienne, papier et cordages, tons neutres |
| `bg_endgame.png` | Fin de partie | Port au coucher du soleil, ambiance chaleureuse |

Suffixe :

```text
wide atmospheric background illustration for a board game interface, heavily
desaturated, low contrast, out of focus in the lower half, no strong focal
point, designed to sit behind readable white text, no text, no characters
```

> Ces images passent **derrière du texte**. Elles doivent être basses en contraste et sans point d'accroche fort, sinon l'interface devient illisible.

---

## 8. Contrôle qualité avant intégration

Pour chaque image livrée :

```text
☐ Dimensions exactes respectées
☐ Aucun texte, chiffre ou symbole visible
☐ Aucune forme hexagonale (tuiles)
☐ Motif jusqu'aux quatre bords, sans cadre ni vignettage
☐ Centre exempt de détail important (tuiles)
☐ Bords calmes, sans contraste fort (tuiles)
☐ Couleur dominante conforme à la palette §2.5
☐ Style cohérent avec le reste de la série
☐ Reste identifiable réduite à 120 px de large (tuiles)
```

**Test décisif pour les tuiles** : afficher les 10 tuiles côte à côte, réduites à 120 px. Si deux d'entre elles se confondent, ou si l'une attire l'œil plus que les autres, régénérer.

---

*Document créé le 2026-08-26.*
