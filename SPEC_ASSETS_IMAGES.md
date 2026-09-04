# Spécification des images — Grandes Colonies

> Direction artistique, contraintes de production et méthode de contrôle des images du jeu.
>
> **Les prompts eux-mêmes ne sont pas dans ce document** : ils vivent dans [assets/prompts.json](assets/prompts.json), qui en est la seule source de vérité. Les dupliquer ici les rendrait faux à la première itération — c'est exactement ce qui s'est produit avec la première version de cette spec.
>
> Pipeline et utilisation : [assets/README.md](assets/README.md) · Projet : [PLAN_DE_DEVELOPPEMENT.md](PLAN_DE_DEVELOPPEMENT.md)

---

## 1. Direction artistique

**Grèce antique, rendu 3D stylisé.** Volumes doux et matière mate, lumière ambiante, léger relief vu de dessus — le rendu des jeux de plateau numériques modernes, transposé en décor égéen : pins parasols et cyprès, terrasses agricoles en pierre sèche, carrières de marbre, tambours de colonnes, oliviers.

Retenue le 26/08/2026 après un essai comparatif de cinq directions ([assets/style-tests.json](assets/style-tests.json)) :

| Direction | Verdict |
|---|---|
| Aquarelle méditerranéenne | Écartée — rendu jugé trop « lâché » |
| Fresque minoenne | Écartée — palette commune à toutes les tuiles : le terrain cesse d'être codé par la couleur, et le bleu y désigne la mer partout ailleurs |
| Aplats vectoriels | Écartée |
| Mosaïque antique | Écartée |
| **Rendu 3D stylisé** | **Retenue** |

---

## 2. Les quatre règles qui conditionnent le résultat

**① Ne jamais demander une forme hexagonale.**
Les tuiles doivent se juxtaposer au pixel près. Aucun modèle ne produit une géométrie assez précise pour tessellier. On génère des **images carrées** de terrain, découpées en hexagone par un masque CSS côté client.

**② Ne jamais demander de texte, de chiffre ou de symbole.**
Les modèles restent peu fiables sur le texte. Jetons 2–12, ratios de ports, noms de cartes : tout est composé en typographie dans le code.

**③ Une couleur dominante franche par tuile.**
C'est la couleur, et elle seule, qui permet de reconnaître un terrain sur un plateau de 50 hexagones dézoomé. Chaque sujet doit imposer sa dominante — c'est la formulation `clearly dominant` dans les prompts. La direction « fresque minoenne » a été écartée précisément pour avoir échoué sur ce point.

**④ Ne jamais générer une tuile seule.**
L'harmonie est une propriété *relationnelle* : elle n'existe qu'entre les images, pas dans chacune. Dix tuiles décrites séparément, si soigneusement que ce soit, sont dix images qui ne se sont jamais vues — et elles dérivent. La première série l'a payé (§7). Depuis, une **planche de série** est générée en une seule fois, validée à l'œil, puis **jointe en référence à chaque génération de tuile** : voir §3.

---

## 3. La planche de série

`sheet_terrains` est une image unique montrant les **dix terrains côte à côte**, en grille de cinq colonnes sur deux rangs. Elle n'illustre rien et ne sort jamais dans le jeu : elle sert de contrainte.

**Pourquoi une seule image.** Demander dix tuiles séparément revient à demander dix fois « fais une belle image », jamais « fais-les aller ensemble ». En les plaçant dans un même cadre, le modèle est forcé de les arbitrer les unes contre les autres — c'est là, et seulement là, que la gamme se décide.

**Comment elle contraint la suite.** Chaque tuile déclare `"ref": ["sheet_terrains"]` dans `prompts.json`. Le script joint alors la planche à la demande, **avant** le texte, et ajoute la consigne de s'y aligner. La tuile n'est plus décrite : elle est située. Une référence absente fait échouer la génération, jamais un repli silencieux — une tuile hors gamme ne se repère qu'à la planche de contrôle, dix images plus tard.

**Ordre de travail.** La planche d'abord, validée à l'œil ; les tuiles ensuite.

```bash
node scripts/generate-assets.mjs --id sheet_terrains --best
```

```bash
node scripts/generate-assets.mjs --priority P0 --force
```

Régénérer la planche invalide la série : les tuiles doivent suivre.

---

## 4. Contraintes de lisibilité

Contraintes fonctionnelles, pas esthétiques : des pièces de jeu seront dessinées **par-dessus** ces images.

- **Centre calme** : il accueille un jeton numéroté opaque.
- **Bords calmes** : les routes se dessinent sur les arêtes, les colonies sur les sommets.
- **Composition plein cadre** : le motif se prolonge au-delà des quatre bords, sans marge ni cadre ni vignettage.
- **La mer est la tuile la plus répétée du plateau** : elle doit être la plus discrète de toutes. Elle a dû être régénérée une fois pour cette raison.
- **Faible bruit visuel** : la tuile doit rester identifiable à 120 px.

---

## 5. Pièges rencontrés en production

Chacun a coûté une régénération. Ils sont tous couverts par le prompt négatif de `prompts.json` — ne pas l'alléger.

| Piège | Symptôme | Déclencheur |
|---|---|---|
| **Marge de papier** | Le modèle peint une œuvre *sur une feuille*, bords blancs compris | Styles picturaux (« aquarelle sur papier ») |
| **Dalle sur fond blanc** | La tuile est rendue comme un objet posé, avec son socle | Styles 3D (« rendu de produit ») |
| **Perspective** | Les motifs s'inclinent vers l'extérieur ; la tessellation casse | Styles 3D, si l'orthographie n'est pas imposée |
| **Motifs directionnels** | Rayures ou bandes qui « accrochent » d'une tuile à sa voisine | Sillons, terrasses, vagues décrits comme réguliers |
| **Crête dominante** | Une ligne forte traverse le centre, là où va le jeton | Reliefs décrits au singulier (« une crête », « un sillon ») |
| **Bandes parallèles** | Les terrasses des collines deviennent des rayures régulières d'un bord à l'autre | « Terrasses », « sillons », s'ils ne sont pas dits courts et désorientés |
| **Dallage** | Le champ d'orge se rend en pavage de pierre, pas en végétation | Parcelles « bordées de pierre » — le modèle retient la pierre |
| **Volutes répétées** | La brume devient un motif de spirales identiques | « Volutes », « tourbillons » |
| **Surface morte** | La mer sort en aplat sans aucune matière (contraste interne 9) | Consignes de discrétion poussées trop loin, sans exiger de texture |
| **Saturation criarde** | Une tuile juste en teinte mais deux fois plus saturée que ses voisines | Le silence : sans gamme commune imposée, chaque image est saturée pour elle-même |
| **Série éteinte** | Une série parfaitement cohérente, et sans vie — la direction « aplats vectoriels » écartée au §1, retrouvée par accident | Confondre bande de saturation *étroite* et bande *basse*, et empiler « low contrast », « calm », « low visual noise » |
| **Motif répété** | Le même groupe d'objets reproduit en 2×2 dans la tuile ; très visible sur la carrière | « Motifs répartis uniformément », si la variété n'est pas demandée — le modèle produit une texture carrelable |

---

## 6. Ce qui n'est pas généré par IA

| Élément | Raison | Solution |
|---|---|---|
| Routes, colonies, villes, comptoirs, chevaliers | Recolorés dans 12 couleurs à l'exécution | Formes SVG paramétrées |
| Jetons numérotés 2–12, ports | Du texte | Typographie SVG |
| Icônes de ressources | Doivent rester nettes à 24 px | [game-icons.net](https://game-icons.net), CC BY 4.0 |
| Icônes d'interface | — | lucide-react |
| Logo / titre | Du texte | Typographie |

---

## 7. Formats

| Catégorie | Dimensions | Ratio | Fond |
|---|---|---|---|
| Tuile de terrain | 1024 × 1024 | 1:1 | opaque, plein cadre |
| Illustration de carte | 1024 × 1536 | 2:3 | opaque |
| Dos de carte | 1024 × 1536 | 2:3 | opaque |
| Fond d'écran | 2560 × 1440 | 16:9 | opaque |
| Planche de série | — | 21:9 | grille de 10 panneaux, jamais affichée en jeu |

Une tuile s'affiche à ~120 px en vue d'ensemble ; le facteur 8× de la source couvre les écrans haute densité et le zoom rapproché.

**L'extension n'est pas fixe** : le modèle renvoie du JPEG ou du PNG selon les cas. Le script nomme le fichier d'après son contenu réel et tient à jour `assets/generated/index.json`. Tout consommateur passe par cet index — jamais par une extension devinée.

---

## 8. Palette et échelle de valeurs

Deux propriétés distinctes, et c'est leur confusion qui a raté la première série :

- **L'harmonie vient de la saturation**, qui doit être *commune* — une bande unique, partagée par les dix tuiles. Étroite, pas basse : la première correction l'a descendue à 14–46 % et a produit une série juste, harmonieuse et éteinte. La bande retenue est **22–58 %**, riche et resserrée.
- **La distinction vient de la luminosité**, qui doit être *échelonnée* — dix barreaux du plus clair au plus sombre, jamais deux tuiles sur le même.

La série d'origine faisait exactement l'inverse. Mesurée : saturations de **8 % à 57 %** — facteur sept, la mer et les collines criaient pendant que la carrière et l'inexploré étaient délavés ; et **cinq tuiles entassées entre 140 et 153** de luminosité, indiscernables en niveaux de gris, donc indiscernables en vue d'ensemble.

L'échelle descend par marches d'environ 16 points. Son ordre est aussi l'ordre des panneaux de la planche (§3), auxquels les prompts renvoient un par un.

| # | Tuile | Ressource | Dominante | Luminosité | Saturation |
|---:|---|---|---|---:|---:|
| 1 | Garrigue sèche | — | `#E0C182` sable chaud | 195 | 42 % |
| 2 | Carrière de marbre | Minerai | `#9EB8CA` gris froid | 178 | 22 % |
| 3 | Champ d'orge | Blé | `#C0A355` or | 163 | 56 % |
| 4 | Pâturage | Laine | `#86A54F` vert olive | 146 | 52 % |
| 5 | Hauts-fonds | Poisson | `#479B99` turquoise | 130 | 54 % |
| 6 | Collines d'argile | Brique | `#A16344` terre cuite | 114 | 58 % |
| 7 | Inexploré | — | `#665C7F` gris-violet | 99 | 28 % |
| 8 | Mer Égée | — | `#345975` bleu profond | 81 | 56 % |
| 9 | Forêt de pins | Bois | `#25532C` vert pin | 65 | 55 % |
| 10 | Mine d'or | Or | `#3C3325` roche sombre + accents dorés | 52 | 38 % |

**Les deux valeurs basses sont assumées** : la carrière (22 %) et l'inexploré (28 %) sont de la pierre et de la brume. Les huit autres tiennent entre 38 et 58 %.

**Les deux paires à surveiller.** Garrigue et carrière sont les plus claires : 17 points, plus l'opposition chaud / froid, plus une géométrie taillée contre un sol organique. Forêt et mine sont les plus sombres : la mine est plus désaturée, et ses veines d'or sont ses seuls accents clairs.

**Ces valeurs ne sont pas une intention, elles sont une contrainte.** Le modèle ne les tient pas — voir §9. Elles sont imposées après coup, et vérifiées : `scripts/mesure-gamme.py` les lit ici même et refuse une série qui s'en écarte (§10).

---

## 9. Étalonnage

**Le modèle ne tient pas les nombres.** Trois itérations du prompt de la planche l'ont établi. L'échelle a d'abord été donnée en relatif (« un cran plus sombre que le précédent ») : marbre et garrigue sont sortis inversés, argile et brume ont dérivé de +33 et +39. Elle a ensuite été donnée en valeurs absolues (`brightness 76` … `brightness 20`) : la dérive a changé de tuiles, pas d'ampleur — hauts-fonds et pâturage inversés de **soixante points**. Le modèle respecte le sens et lâche la mesure, et il lâche toujours là où son a priori est fort : de l'eau peu profonde vue de dessus *est* claire.

Continuer à reformuler serait payer une image à chaque essai pour un résultat qu'un calcul donne exactement. Le partage est donc :

| Au modèle | Au code |
|---|---|
| La matière, les volumes, la lumière, le sujet | La luminosité, la saturation, le contraste |
| Ce qu'un calcul ne sait pas inventer | Ce qu'un modèle ne sait pas tenir |

```bash
python3 scripts/etalonner.py
```

Lit `generated/tiles/`, écrit `processed/tiles/` sous le **même nom de fichier** — la tuile étalonnée est un remplacement pur, `index.json` reste valide, et `scripts/assets.mjs` la fait primer à la copie vers le client. `generated/` n'est jamais modifié : tout reste régénérable depuis `prompts.json`.

Trois corrections, dans cet ordre, qui n'est pas indifférent :

1. **contraste** comprimé s'il dépasse 34 — des routes et des colonies se dessinent par-dessus ;
2. **saturation** amenée dans la bande commune ;
3. **luminosité** amenée sur son barreau par une courbe gamma, en dernier — un gain par pixel préserve exactement la saturation, l'inverse est faux ; un décalage linéaire écrêterait les hautes lumières.

**Ce que l'étalonnage ne rattrape pas** : la géométrie. Une tuile en aplat le reste — on ne calcule pas de la matière absente ; une bande continue d'un bord à l'autre reste une bande. Ces défauts-là se corrigent au prompt, et c'est pourquoi `mesure-gamme.py --brut` existe : c'est la sortie brute qu'on regarde pour décider s'il faut régénérer.

---

## 10. Contrôle qualité

```text
☐ Dimensions exactes
☐ Aucun texte, chiffre ou symbole
☐ Aucune forme hexagonale, aucune dalle, aucun socle
☐ Motif jusqu'aux quatre bords, sans cadre ni vignettage
☐ Centre exempt de détail important
☐ Bords calmes, sans contraste fort
☐ Style cohérent avec le reste de la série
☐ Identifiable réduite à 120 px
☐ Luminosité, saturation et contraste conformes au §8   ← mesuré, bloquant
☐ Les 10 tuiles se distinguent en niveaux de gris        ← mesuré, bloquant
```

**Le contrôle chiffré passe avant le coup d'œil**, parce que la première série avait passé le coup d'œil :

```bash
python3 scripts/mesure-gamme.py
```

Il mesure chaque tuile **telle qu'elle partira chez le client** — étalonnée si elle l'est —, la compare à son barreau du §8 et sort en code 1 si une seule s'en écarte — luminosité, saturation, contraste interne, et distance à ses voisines dans l'échelle. Il nomme les tuiles en cause. `--brut` mesure la sortie du modèle avant étalonnage : c'est celle qui dit s'il faut régénérer.

```bash
python3 scripts/mesure-gamme.py --planche
```

Mesure les dix panneaux de la planche **avant** d'en tirer les tuiles. Un barreau inversé s'y corrige pour le prix d'une image, et pour celui de dix si on ne le voit qu'après.

**Test décisif à l'œil** : les 10 tuiles côte à côte à 120 px, puis les mêmes en niveaux de gris. Si deux se confondent, ou si l'une attire l'œil beaucoup plus que les autres, régénérer — quelle que soit sa beauté en grand.

```bash
python3 scripts/contact-sheet.py /tmp/planches
```

produit `planche_120px.png` (le test décisif), `planche_gris.png` (le même sans la teinte : c'est le test le plus sévère, il ne laisse que la valeur) et `planche_plateau.png` (la tessellation). À préférer à la planche HTML quand on itère : **les panneaux d'aperçu mettent les images en cache de façon agressive**, et une régénération réécrit le même nom de fichier — on croit alors regarder la nouvelle tuile alors qu'on voit l'ancienne.

`assets/preview/index.html` reste la planche complète, cartes et fonds compris, à ouvrir dans un vrai navigateur.
