# Spécification des images — Grand Colonies

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

## 2. Les trois règles qui conditionnent le résultat

**① Ne jamais demander une forme hexagonale.**
Les tuiles doivent se juxtaposer au pixel près. Aucun modèle ne produit une géométrie assez précise pour tessellier. On génère des **images carrées** de terrain, découpées en hexagone par un masque CSS côté client.

**② Ne jamais demander de texte, de chiffre ou de symbole.**
Les modèles restent peu fiables sur le texte. Jetons 2–12, ratios de ports, noms de cartes : tout est composé en typographie dans le code.

**③ Une couleur dominante franche par tuile.**
C'est la couleur, et elle seule, qui permet de reconnaître un terrain sur un plateau de 50 hexagones dézoomé. Chaque sujet doit imposer sa dominante — c'est la formulation `clearly dominant` dans les prompts. La direction « fresque minoenne » a été écartée précisément pour avoir échoué sur ce point.

---

## 3. Contraintes de lisibilité

Contraintes fonctionnelles, pas esthétiques : des pièces de jeu seront dessinées **par-dessus** ces images.

- **Centre calme** : il accueille un jeton numéroté opaque.
- **Bords calmes** : les routes se dessinent sur les arêtes, les colonies sur les sommets.
- **Composition plein cadre** : le motif se prolonge au-delà des quatre bords, sans marge ni cadre ni vignettage.
- **La mer est la tuile la plus répétée du plateau** : elle doit être la plus discrète de toutes. Elle a dû être régénérée une fois pour cette raison.
- **Faible bruit visuel** : la tuile doit rester identifiable à 120 px.

---

## 4. Pièges rencontrés en production

Chacun a coûté une régénération. Ils sont tous couverts par le prompt négatif de `prompts.json` — ne pas l'alléger.

| Piège | Symptôme | Déclencheur |
|---|---|---|
| **Marge de papier** | Le modèle peint une œuvre *sur une feuille*, bords blancs compris | Styles picturaux (« aquarelle sur papier ») |
| **Dalle sur fond blanc** | La tuile est rendue comme un objet posé, avec son socle | Styles 3D (« rendu de produit ») |
| **Perspective** | Les motifs s'inclinent vers l'extérieur ; la tessellation casse | Styles 3D, si l'orthographie n'est pas imposée |
| **Motifs directionnels** | Rayures ou bandes qui « accrochent » d'une tuile à sa voisine | Sillons, terrasses, vagues décrits comme réguliers |
| **Crête dominante** | Une ligne forte traverse le centre, là où va le jeton | Reliefs décrits au singulier (« une crête », « un sillon ») |

---

## 5. Ce qui n'est pas généré par IA

| Élément | Raison | Solution |
|---|---|---|
| Routes, colonies, villes, comptoirs, chevaliers | Recolorés dans 12 couleurs à l'exécution | Formes SVG paramétrées |
| Jetons numérotés 2–12, ports | Du texte | Typographie SVG |
| Icônes de ressources | Doivent rester nettes à 24 px | [game-icons.net](https://game-icons.net), CC BY 4.0 |
| Icônes d'interface | — | lucide-react |
| Logo / titre | Du texte | Typographie |

---

## 6. Formats

| Catégorie | Dimensions | Ratio | Fond |
|---|---|---|---|
| Tuile de terrain | 1024 × 1024 | 1:1 | opaque, plein cadre |
| Illustration de carte | 1024 × 1536 | 2:3 | opaque |
| Dos de carte | 1024 × 1536 | 2:3 | opaque |
| Fond d'écran | 2560 × 1440 | 16:9 | opaque |

Une tuile s'affiche à ~120 px en vue d'ensemble ; le facteur 8× de la source couvre les écrans haute densité et le zoom rapproché.

**L'extension n'est pas fixe** : le modèle renvoie du JPEG ou du PNG selon les cas. Le script nomme le fichier d'après son contenu réel et tient à jour `assets/generated/index.json`. Tout consommateur passe par cet index — jamais par une extension devinée.

---

## 7. Palette de référence

Chaque tuile doit rester reconnaissable **par sa couleur dominante seule**.

| Tuile | Ressource | Dominante |
|---|---|---|
| Forêt — bois mediterranéen | Bois | `#2F6B3C` vert forêt |
| Pâturage | Laine | `#9CCB5B` vert clair |
| Champ de céréales | Blé | `#E8B93B` jaune doré |
| Collines en terrasses | Brique | `#C55A2B` terre cuite |
| Carrière de marbre | Minerai | `#6E7B8B` gris ardoise |
| Garrigue sèche | — | `#D9C9A3` sable pâle |
| Mer Égée | — | `#2E6F9E` bleu profond |
| Mine d'or | Or | `#7A5C2E` roche sombre + `#FFD866` |
| Hauts-fonds | Poisson | `#3FA9A0` turquoise |
| Inexploré | — | `#5B5670` gris-violet |

Champ et Mine d'or sont les plus proches en teinte : la mine est donc spécifiée **globalement sombre**, ce qui les sépare par la luminosité et non par la teinte. Carrière et Garrigue sont toutes deux claires, mais l'une est froide et l'autre chaude.

---

## 8. Contrôle qualité

```text
☐ Dimensions exactes
☐ Aucun texte, chiffre ou symbole
☐ Aucune forme hexagonale, aucune dalle, aucun socle
☐ Motif jusqu'aux quatre bords, sans cadre ni vignettage
☐ Centre exempt de détail important
☐ Bords calmes, sans contraste fort
☐ Couleur dominante conforme au §7
☐ Style cohérent avec le reste de la série
☐ Identifiable réduite à 120 px
```

**Test décisif** : afficher les 10 tuiles côte à côte à 120 px. Si deux se confondent, ou si l'une attire l'œil beaucoup plus que les autres, régénérer — quelle que soit sa beauté en grand.

Deux outils pour ce contrôle :

```bash
python3 scripts/contact-sheet.py /tmp/planches
```

produit `planche_120px.png` (le test décisif) et `planche_plateau.png` (la tessellation). À préférer à la planche HTML quand on itère : **les panneaux d'aperçu mettent les images en cache de façon agressive**, et une régénération réécrit le même nom de fichier — on croit alors regarder la nouvelle tuile alors qu'on voit l'ancienne.

`assets/preview/index.html` reste la planche complète, cartes et fonds compris, à ouvrir dans un vrai navigateur.
