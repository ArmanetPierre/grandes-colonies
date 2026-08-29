# Simulation — premières mesures

> Résultats de la simulation par bots, 2026-08-27.
>
> Reproductible : `npx vitest run packages/sim`. Toutes les parties sont seedées, donc rejouables à l'identique.
>
> Contrat de règles : [RULES_CONTRACT.md](RULES_CONTRACT.md) · Plan : [PLAN_DE_DEVELOPPEMENT.md](PLAN_DE_DEVELOPPEMENT.md)

---

## Résultat principal

**Le seuil de 15 points de victoire est aujourd'hui inatteignable.** Aucune partie simulée ne l'a franchi, à aucun effectif, même après 200 cycles.

Ce n'est ni un bug du moteur ni un défaut des bots : c'est une propriété du barème tel qu'implémenté.

### Le plafond, calculé

Le §22 du game design liste neuf sources de points. **Quatre seulement existent** aujourd'hui :

| Source | Points | Implémentée |
|---|---:|:--:|
| Colonie | 1 | oui |
| Ville | 2 | oui |
| Plus long réseau | 2 | oui |
| Plus grande puissance militaire | 2 | oui |
| Objectif secret | 2 | **non** |
| Métropole | 3 | **non** |
| Monument | 2 | **non** |
| Défenseur de Catan | 1 | **non** |
| Exploration majeure | 1 | **non** |

Avec les quatre premières, le maximum théorique d'un joueur est de **13 points** : 4 villes (8) + 1 colonie (1), plus les deux titres (4). En pratique la simulation plafonne autour de **12**.

---

## Le vrai verrou : la dotation de routes

La cause n'est pas celle qu'on attendrait. Ce ne sont ni les ressources ni les emplacements qui manquent, mais les **routes**.

État typique d'un joueur à la fin d'une partie de 200 cycles, à 8 joueurs :

```text
p4 : 9 PV  (1 colonie, 4 villes)
     réserve : 4 colonies, 0 ville, 0 ROUTE
     emplacements de colonie disponibles : 0
```

Le joueur possède encore quatre colonies en réserve et ne peut pas les poser : il n'a plus une seule route pour atteindre un emplacement légal. La règle de distance impose deux arêtes entre deux constructions, et **quinze routes ne suffisent pas** à desservir neuf bâtiments sur un plateau de cette taille.

Les ressources, elles, abondent : la simulation observe des mains moyennes de 9 à 11 cartes et une centaine de défausses par partie.

---

## Ce que la simulation a corrigé en chemin

**Les bots ne commerçaient pas avec la banque.** Une main de dix cartes réparties sur cinq types ne contient presque jamais les trois minerais d'une ville : les bots accumulaient sans jamais réunir un coût précis. Ajouter l'échange 4:1 de dépannage a fait passer les parties conclues de 1/5 à 4/5 au seuil de 10.

C'est une leçon qui vaut au-delà des bots : **à douze joueurs, l'accès au commerce conditionne l'expansion bien plus qu'à quatre**. Les ports, non encore implémentés, seront donc plus déterminants ici que dans un Catan classique.

---

## Mesures par effectif

Parties de 200 cycles, bots cupides, seuil ramené à 10 points pour que les parties se concluent.

| Joueurs | Tours actifs par joueur | Main moyenne | Pic de main | Défausses |
|---:|---:|---:|---:|---:|
| 4 | 49 | 9,3 | 72 | 56 |
| 8 | 24 | 9,5 | 28 | 104 |
| 12 | 16 | 11,3 | 39 | 102 |

Le pic de 72 cartes à 4 joueurs illustre un point du §16 du plan : **la limite de main ne s'applique que sur un 7**. Entre deux 7, une main peut enfler sans borne. À quatre joueurs sur un plateau dimensionné pour douze, la production dépasse largement les occasions de dépenser.

---

## Correctifs appliqués et second tour de mesure

Deux des trois leviers ont été actionnés le 2026-08-27.

**Objectifs secrets implémentés.** Cinq d'entre eux sont mesurables aujourd'hui — architecte, bâtisseur de cités, colonisateur, grand bâtisseur, seigneur militaire. Les trois autres du §21 sont déclarés mais indisponibles : un joueur ne doit jamais tirer un objectif que le moteur ne sait pas évaluer. Chaque joueur en reçoit deux et n'en garde qu'un ; à défaut de choix, le premier fait foi — même principe que la validation automatique du §2 du contrat.

**Dotation de routes portée de 15 à 20.** C'était le verrou mesuré.

### Résultat

**Le seuil de 15 est redevenu atteignable.** Avant correctifs : aucune partie, à aucun effectif. Après :

| Joueurs | Parties conclues | Cycles moyens |
|---:|---:|---:|
| 4 | 3 / 6 | 242 |
| 6 | 2 / 6 | 226 |
| 8 | 2 / 6 | 149 |
| 10 | 2 / 6 | 206 |
| 12 | 3 / 6 | 240 |

### Un bug de mesure, corrigé au passage

Le simulateur recomposait le score à la main et **oubliait l'objectif secret**, sous-estimant chaque total de deux points. Le décompte passe désormais par une fonction unique, `playerPoints`, qui inclut titres et objectif. C'est aussi celle que le client devra utiliser : recomposer un score ailleurs, c'est se condamner à en oublier une part.

### Un second bug, plus grave

`xxlOptionsFor(4)` renvoyait **44 hexagones — le plateau de douze joueurs pour une partie à quatre**. Chaque joueur ne touchait que six tuiles sur quarante-quatre et ne produisait presque jamais. En dessous de huit joueurs, le simulateur utilise désormais le plateau classique, conformément au §2 du game design qui réserve Grand Colonies aux effectifs de 8 à 12.

---

## Le problème suivant : la durée

C'est maintenant l'écart le plus criant, et il est important.

La cible du §2 est de **120 à 160 minutes**. À deux minutes par cycle, cela autorise environ **60 cycles**. Les mesures en réclament **150 à 240**, soit **cinq à huit heures** de partie.

Autrement dit : le jeu est gagnable, mais **quatre fois trop lentement**. Et une partie sur deux ne se conclut toujours pas dans la limite de 300 cycles.

### Ce qui pourrait combler l'écart

Plusieurs systèmes manquants sont précisément des accélérateurs, ce qui rend la mesure actuelle pessimiste :

- **les ports** — la simulation a déjà montré que l'accès au commerce conditionne l'expansion ; le 4:1 est un taux punitif ;
- **le commerce entre joueurs**, cœur du jeu selon le §37, entièrement absent ;
- **les métropoles** (3 points), **monuments** (2), **exploration** et **défense** — quatre sources de points encore absentes du barème ;
- **la construction semi-simultanée**, implémentée mais que les bots n'utilisent jamais.

Il serait prématuré de retoucher les coûts ou le seuil de victoire avant d'avoir mesuré avec ces systèmes : on corrigerait un déséquilibre qui n'existera plus.

---

## Ce qu'il faut trancher

Trois leviers, non exclusifs.

**Implémenter les objectifs secrets.** Ils valent 2 points et le §39 les prévoit déjà dans la première version jouable — ils ne sont donc pas un ajout mais un oubli. Ils portent le plafond réaliste de 12 à 14, ce qui reste juste sous le seuil.

**Augmenter la dotation de routes.** C'est le verrou mesuré. Passer de 15 à 20 routes par joueur desserre directement l'expansion, sans toucher au barème.

**Abaisser le seuil de victoire.** À 12 points, les parties se concluent avec le barème actuel. C'est le levier le plus simple, mais il contredit l'intention du §22, qui justifiait 15 par la taille de la carte.

> Ma recommandation : **les trois premiers d'abord, le seuil en dernier recours.** Le seuil de 15 n'est pas arbitraire — il vient de la taille du plateau. Le baisser reviendrait à traiter le symptôme plutôt que la cause, qui est un barème incomplet et une dotation de routes calquée sur un jeu à quatre joueurs.
>
> **Mise à jour du 2026-08-27 :** les deux premiers leviers ont été actionnés et ont suffi à rendre la victoire atteignable. Le seuil reste à 15. La prochaine mesure n'aura de sens qu'après l'implémentation des ports et du commerce entre joueurs.

---

## Troisième tour : ports et commerce entre joueurs

Implémentés le 2026-08-27, avec 22 tests dédiés.

**Ports** — génériques à 3:1, spécialisés à 2:1, plus le port marchand du §11 qui donne 2:1 sur toute ressource. Ils sont posés sur des sommets côtiers **espacés** : deux ports adjacents seraient captés par une seule colonie, ce qui donnerait un avantage décisif au premier joueur qui la pose.

**Commerce entre joueurs** — offres nominatives ou ouvertes, acceptation atomique, expiration en fin de cycle.

### Ce que la mesure a montré

Avec des bots acceptant largement, les parties conclues ont raccourci de **40 %** — de 159-240 cycles à 101-126. Le commerce est donc bien le levier attendu par le §37.

Mais le résultat s'est révélé **très sensible à la politique de négociation des bots**. Trois réglages successifs ont donné des taux d'acceptation de 73 %, 8 % puis 14 %, et des taux de conclusion allant de 1/6 à 4/6 sans corrélation nette.

> **Conclusion méthodologique : les bots sont devenus le facteur limitant, pas le jeu.** Continuer à les régler mesurerait mes heuristiques plutôt que ton design. Les prochaines conclusions d'équilibrage demandent soit des bots nettement meilleurs, soit — et c'est plus rapide — un playtest humain.

### Une lacune du contrat, révélée par les tests

Le contrat accordait au joueur actif le droit de négocier pendant son tour, mais ne disait pas **qui pouvait lui répondre**. Restreindre la réponse au seul joueur actif rendait la règle vide : une offre sans contrepartie possible ne sert à rien. Tranché et consigné : pendant le tour, un échange est recevable dès lors que le joueur actif en est l'une des deux parties.

---

## Quatrième tour : cartes jouées, métropoles, monuments

Mesuré le 2026-08-27, après avoir rendu jouables les quatre cartes développement inertes et implémenté métropoles et monuments.

### Une erreur de mesure, d'abord

Les bots **achetaient** des cartes développement sans jamais en **jouer** une seule. La conséquence dépassait les cartes : la plus grande puissance militaire n'était **jamais** attribuée, et deux points de victoire n'existaient dans aucune mesure d'équilibrage. Tous les tours précédents portaient donc sur un jeu amputé.

Les bots jouent maintenant leurs cartes et bâtissent métropoles et monuments. Le simulateur renvoie en outre la **ventilation** des points et plus seulement le total : un total seul ne dit pas qu'une source est morte, et c'est exactement ce qui avait échappé.

### Les sources de points sont-elles vivantes ?

Sur 12 parties par effectif :

| Source | 8 joueurs | 12 joueurs |
|---|---:|---:|
| Plus grande puissance militaire attribuée | 10 / 12 parties | 12 / 12 |
| Plus long réseau attribué | 12 / 12 | 12 / 12 |
| Objectifs secrets remplis | 22 joueurs | 35 |
| Monuments élevés | 22 | 53 |
| Métropoles bâties | 3 | 9 |

**Le monument fonctionne comme prévu** : c'est la sortie du joueur bloqué, et il est massivement utilisé. **La métropole, non** — trois sont disponibles par partie, moins d'une est prise. Son rapport est le plus mauvais du jeu : un point net pour sept ressources dont deux d'or. À décider : la porter à 4 points, ou alléger son coût.

### La victoire est maintenant atteignable

| Effectif | Parties conclues | Cycles médians |
|---|---:|---:|
| 8 joueurs | 16 / 16 | 175 |
| 10 joueurs | 15 / 16 | 189 |
| 12 joueurs | 15 / 16 | 198 |

Contre environ une partie sur trois auparavant.

---

## La durée : l'erreur était dans la cible

Le tour précédent concluait à « quatre fois trop lent ». Ce calcul reposait sur une confusion qu'il faut corriger.

**Deux minutes par cycle est un plafond, pas une durée.** Ce sont les 90 secondes du tour actif plus les 30 de la fenêtre de commerce — des délais d'expiration. Un joueur qui lance, construit et passe la main termine son cycle en bien moins que cela. Diviser 120 minutes par ce plafond pour obtenir « 60 cycles » revient à supposer que chaque joueur épuise systématiquement son chronomètre.

Ce que donnent les mesures selon la durée moyenne réellement observée à table :

| Cycles | à 40 s | à 60 s | à 90 s | à 120 s (plafond) |
|---:|---|---|---|---|
| 120 | 1 h 20 | 2 h 00 | 3 h 00 | 4 h 00 |
| 160 | 1 h 47 | 2 h 40 | 4 h 00 | 5 h 20 |
| 190 | 2 h 07 | 3 h 10 | 4 h 45 | 6 h 20 |

### Le seuil de victoire, chiffré

Même partie, même graine, seul le seuil change :

| Seuil | 8 joueurs | 12 joueurs |
|---:|---:|---:|
| 10 points | 128 cycles | 126 |
| 12 points | 147 | 167 |
| 13 points | 150 | 167 |
| 15 points | 175 | 198 |

Le rapport n'est pas linéaire : passer de 15 à 10 points ne retire que 35 % des cycles. Le début de partie est lent quel que soit le seuil, parce que la production ne démarre qu'avec les premières colonies.

> **Recommandation.** Le seuil de 15 reste tenable si un cycle dure réellement une minute en moyenne : environ 3 h 20 à douze joueurs, au-dessus de la cible mais dans le domaine d'une soirée. Descendre à 12 points ramènerait à 2 h 47 sans dénaturer la course.
>
> **Mais ces chiffres restent ceux de bots.** Ils ne planifient pas, ne marchandent pas, et n'annoncent jamais de construction hors de leur tour — la mécanique la plus différenciante du jeu. Un humain construit plus vite. C'est un **plancher de vitesse**, donc un **plafond de durée** : la vraie partie sera plus courte. Je ne touche pas au seuil avant le playtest.

---

## Cinquième tour : l'archipel

Mesuré le 2026-08-27, après avoir rendu les voies maritimes constructibles et
introduit le plateau en archipel du §4.

### Encore un jeu amputé

Même erreur que pour les cartes développement, et repérée de la même façon.
Les premiers essais sur archipel donnaient **zéro exploration** et un taux de
conclusion effondré : les bots ne construisaient aucune voie maritime et
restaient prisonniers de l'île centrale, plus petite que l'ancien disque.

Ils savent maintenant naviguer, et préfèrent la voie maritime à la route dès
que leur île n'offre plus d'emplacement. Sans cette bascule, une route
terrestre était presque toujours payable, donc toujours préférée, et aucune
partie ne quittait jamais l'île de départ.

### La part de l'île centrale, mesurée

Vingt-quatre parties par ligne, mêmes bots, mêmes graines.

| Plateau | 8 joueurs | 12 joueurs | Explorations |
|---|---|---|---|
| Disque | 23/24 conclues, 170 cycles | 23/24, 138 cycles | 0 |
| Archipel, île centrale à 55 % | 19/24, 221 cycles | **6/24**, 262 cycles | 14 et 19 |
| Archipel, île centrale à 75 % | 22/24, 192 cycles | 21/24, 216 cycles | 11 et 15 |

À 55 %, les îles secondaires enferment trop de terrain derrière la mer : à
douze joueurs, six parties sur vingt-quatre parviennent à se conclure. La
part est donc fixée à **75 %**, mesurée plutôt que choisie.

### Le coût de l'archipel

Même à 75 %, l'archipel allonge la partie : **216 cycles contre 138** à douze
joueurs, soit environ 3 h 36 contre 2 h 18 à une minute par cycle. C'est le
prix des traversées, et il est réel.

Les deux plateaux restent donc disponibles. L'archipel est le défaut — c'est
la structure du §4, et la seule où l'exploration ait un sens — mais
`BOARD=disque` lance une soirée plus courte.

> **La même réserve qu'aux tours précédents s'applique, et plus fortement.**
> Les bots traversent mal : ils n'embarquent qu'une fois bloqués, et suivent
> la première arête venue plutôt que de viser une île. Un joueur humain
> prépare sa traversée. L'écart mesuré entre disque et archipel est donc un
> majorant, pas une prévision.

---

## Limites de ces mesures

- Les bots sont volontairement simples : ils construisent par ordre de valeur en points et ne planifient rien. Un humain expanderait mieux et atteindrait probablement quelques points de plus.
- Le commerce entre joueurs est désormais simulé, mais avec une politique de bot très fruste : deux cartes en surplus contre une carte manquante, sans marchandage. Un joueur humain négocierait bien mieux.
- Les barbares ne sont pas dans le moteur : les jetons de défenseur restent inertes au barème. L'exploration majeure, elle, est désormais attribuée — un point au premier joueur qui pose une colonie sur une île secondaire.
- Les hexagones face cachée du §13 — ressources rares, villages neutres, événements, zones dangereuses — ne sont pas implémentés : huit natures de tuiles restant à concevoir.
- La construction semi-simultanée existe dans le moteur mais les bots ne l'utilisent pas : ils n'annoncent jamais hors de leur tour. C'est aujourd'hui la plus grosse mécanique absente des mesures.
- Les bots ne choisissent pas leur objectif secret : ils gardent celui que le moteur leur attribue par défaut, sans regarder s'il colle à leur position.

Ces mesures disent donc où se situe le **plancher**, pas le plafond réel du jeu fini.

## Échelles de plateau — la place raccourcit la partie

`scripts/echelles.ts`, 16 parties par ligne, bots gourmands, archipel, 600 cycles
de garde-fou.

| Effectif | Échelle | Terres | Hexagones | Îles | Conclues | Cycles (médiane) | Points du gagnant |
|---|---|---|---|---|---|---|---|
| 12 | normale | 48 | 168 | 3 | 13/16 | 185 | 14,9 |
| 12 | grande | 77 | 254 | 5 | **16/16** | **130** | 15,3 |
| 12 | immense | 115 | 335 | 6 | **16/16** | **124** | 15,1 |
| 8 | normale | 44 | 143 | 2 | 15/16 | 211 | 15,3 |
| 8 | grande | 70 | 207 | 3 | 16/16 | 146 | 15,2 |
| 8 | immense | 106 | 310 | 5 | 16/16 | 121 | 15,7 |

On attendait l'inverse : plus de terres, plus de trajet, donc des parties plus
longues. C'est le contraire, et nettement. À douze joueurs sur quarante-huit
terres, la table est **engorgée** — les emplacements légaux se raréfient, les
colonies se bloquent mutuellement, et trois parties sur seize n'aboutissent
pas dans les six cents cycles. Donnez de la place et chacun construit : les
constructions par joueur passent de 12,1 à 16,6, et la partie se conclut.

Le point de victoire reste gagné, pas concédé : le gagnant finit autour de 15
points à toutes les échelles, jamais sur épuisement du garde-fou.

Le disque suit la même pente, en plus sage — il n'a pas d'îles à relier, donc
moins de trajet à gagner : 143 cycles en normale, 119 en grande, 135 en
immense, seize parties sur seize partout.

### La dotation de routes ne suit pas la taille du plateau

On l'avait mise à l'échelle par anticipation, sur l'idée qu'un plateau plus
vaste demanderait plus de routes. La mesure a dit non :

| Échelle | 20 routes | 30 routes |
|---|---|---|
| normale | 13/16, 185 cycles | 16/16, 155 cycles |
| grande | 16/16, 130 cycles | 16/16, 136 cycles |
| immense | 16/16, 124 cycles | 16/16, 148 cycles |

Sur un grand plateau, plus de routes ne rapproche de rien : elle disperse, et
la partie s'allonge. La mise à l'échelle a donc été retirée.

En revanche la première colonne se lit dans l'autre sens : **sur le plateau
normal, vingt routes bride encore** — trente feraient passer douze joueurs de
13/16 à 16/16 et gagneraient trente cycles. C'est un réglage de l'équilibre de
base, laissé en l'état faute d'avoir été demandé, mais il mérite d'être repris.

---

## Sixième tour : le marché dynamique

`scripts/marche.ts`, archipel à l'échelle normale, bots gourmands, 600 cycles
de garde-fou. Le témoin est l'ancien jeu — cours plat à 4:1, palier hors
d'atteinte — ce qui rend les deux lignes strictement comparables.

Trois questions, dans l'ordre où elles pouvaient tuer la mécanique : le cours
**vit-il** ? S'emballe-t-il ? Coûte-t-il la partie ?

### Une première mesure trompeuse

Sur seize parties, le marché paraissait coûter cher : 236 cycles contre 191,
soit **+24 % de durée** à douze joueurs, sur le jeu dont la durée est déjà le
problème connu. De quoi remettre la mécanique en cause.

Sur quarante parties, l'écart disparaît :

| Effectif | Marché | Conclues | Cycles (médiane) | Points du gagnant | Constr./j |
|---|---|---|---|---|---|
| 12 | figé 4:1 | 34/40 | 189 | 15,0 | 12,3 |
| 12 | **§10** | **36/40** | **191** | 15,2 | 12,2 |
| 8 | figé 4:1 | 39/40 | 178 | 15,3 | 14,0 |
| 8 | **§10** | **40/40** | **183** | 15,2 | 14,0 |

Deux cycles à douze, cinq à huit : sous le bruit. Les parties conclues gagnent
même deux points sur quarante. Le +24 % était un artefact d'échantillon — une
mesure de plus que ce document doit corriger avant d'en tirer une
conclusion, et la même leçon que les précédentes : **seize parties ne
suffisent pas à départager deux réglages proches.**

### Le cours vit, et il sature

L'amplitude moyenne — de combien de crans a bougé le cours le plus mobile —
s'établit à **2,8** sur une plage de 2 à 6. Le marché n'est donc pas un
barème déguisé : il traverse presque toute son étendue en une partie.

Mais **3,4 cours sur 6 finissent collés à une borne**. Le premier jet était
pire, à 4,8, parce que le solde qui porte le cours courait sans limite : le
bois vendu quatre cents fois demandait quatre cents achats pour décoller de
son plafond, ce qui n'arrive jamais. Borner le solde un cran au-delà du cours
a ramené la saturation à 3,4 et rendu la remontée possible en un palier.

Les 3,4 restants tiennent aux bots, et il faut le dire clairement : ils
vendent toujours le même surplus structurel — bois et laine — et achètent
toujours la même pénurie structurelle — minerai et blé. Rien dans leur
politique ne réagit au prix. Un joueur humain qui voit le bois à 6 cesse de
le vendre et va négocier à la table, ce qui est précisément l'effet
recherché.

### La limite de cette lecture

Le cours ne facture que la ressource **donnée**. Le voir descendre à 2 sur le
minerai ne rend donc pas le minerai plus facile à obtenir : cela ne profite
qu'à celui qui en a du surplus, c'est-à-dire à personne. La moitié « une
ressource qui manque voit son prix monter » du §10 pèse ainsi nettement moins
que l'autre.

C'était le prix à payer pour que les ports gardent leur sens : dans la boîte,
un port bois donne 2 bois contre n'importe quoi. Facturer la ressource reçue
aurait inversé la signification de tous les ports du plateau.

### Ce qu'il reste à mesurer

- Le marché n'a jamais été mesuré **avec des joueurs humains**, qui sont les
  seuls à pouvoir réagir à un prix. Toutes les valeurs ci-dessus décrivent
  une table qui ne regarde pas le tableau.
- Les échanges bancaires par partie ne bougent presque pas (273 contre 279 à
  douze) : les bots paient plus cher sans commercer moins. Un humain
  devrait, lui, se détourner de la banque — c'est l'hypothèse centrale du
  dispositif, et elle reste à vérifier.
- Le palier de 4 et la plage 2–6 n'ont été comparés qu'à deux variantes, sur
  seize parties chacune — donc sur du bruit. À reprendre à quarante si le
  réglage est remis en cause.

---

## Septième tour : les ports à contrat

`scripts/ports.ts`, 40 parties par ligne. Le témoin retire les deux ports du
plateau **après génération** : mêmes terres, mêmes jetons, mêmes autres
ports, seule la côte change.

| Effectif | Plateau | Conclues | Cycles (méd.) | Points du gagnant | Constr./j | Via port | Via banque |
|---|---|---|---|---|---|---|---|
| 12 | sans contrats | 35/40 | 212 | 14,9 | 12,1 | 0 | 317 |
| 12 | **§11** | 35/40 | 209 | 15,0 | 12,2 | 5 | 316 |
| 8 | sans contrats | 40/40 | 181 | 15,2 | 13,8 | 0 | 114 |
| 8 | **§11** | 40/40 | 189 | 15,2 | 13,9 | 7 | 116 |

**Le port commercial sert, et ne déséquilibre rien.** Cinq à sept conversions
par partie, aucun effet mesurable sur la durée, le nombre de constructions ou
le score du gagnant. La crainte était qu'un 2:1 sans condition de nature
devienne le meilleur taux du jeu offert à qui pose une colonie au bon
endroit ; la contrainte des deux natures différentes le ramène à sa place.

### Ce que ces chiffres ne disent pas

- **Le port minier n'est pas mesuré du tout.** Zéro usage : les bots ne le
  touchent jamais. L'or ne sert qu'à la métropole, et un bot qui en
  thésauriserait sans pouvoir bâtir bloquerait sa main. C'est une lacune
  connue, pas un oubli — mais elle veut dire que l'exemption de marché du
  §11, la décision la plus discutable du lot, n'a été validée que par le
  raisonnement.
- **Cinq usages par partie, c'est peu**, et c'est le plancher : le port
  n'appartient qu'à un joueur, et ce joueur est un bot qui n'y touche que
  lorsqu'il ne peut plus rien bâtir. Un humain qui tient ce port irait le
  chercher.
- Le port royal n'existe pas : il attend l'Influence.

---

## Huitième tour : des adversaires qui jouent

Les sept tours précédents ont mesuré le jeu avec des bots qui construisaient
par ordre de valeur en points sans jamais regarder un jeton, sans plan, sans
proposer un seul échange. C'était assumé — ils étaient là pour faire tourner
des milliers de parties, pas pour bien jouer. Mais cela laissait une question
ouverte : **ce qu'on mesurait était-il le jeu, ou la maladresse des bots ?**

Le paquet `sim` porte désormais un pilote complet
(`packages/sim/src/pilote/`), à quatre niveaux et six caractères. Il ne
reçoit que la vue publique et la vue privée d'un joueur — pas le `GameState`
— et c'est **exactement le même code** qui joue en réseau le soir venu et qui
tourne ici en simulation.

### L'échelle des niveaux

`scripts/adversaires.ts`, 48 parties à 6 joueurs, sièges alternés d'une
partie à l'autre pour que l'ordre du tour ne fausse rien.

| Duel | Victoires | Points moyens | Cycles |
|---|---|---|---|
| niveau 2 contre l'ancien bot | **48 — 0** | 10,5 contre 2,7 | 108 |
| niveau 2 contre niveau 1 | **43 — 0** | 10,7 contre 3,7 | 150 |
| niveau 4 contre niveau 1 | **43 — 0** | 11,1 contre 3,7 | 152 |
| niveau 3 contre niveau 2 | **20 — 16** | 9,9 contre 9,1 | 193 |
| niveau 4 contre niveau 3 | **32 — 27** ¹ | 10,0 contre 9,8 | 183 |

¹ cumul de deux familles de graines, 80 parties : 15 — 17 sur l'une, 17 — 10
sur l'autre. L'écart entre les deux dit ce que vaut la mesure — à une
trentaine de parties décidées par famille, un duel serré ne se tranche pas.

**L'échelle n'est pas régulière, et c'est le fait le plus utile du tour.**
Entre le premier et le deuxième niveau il y a un gouffre : quarante-trois à
zéro. Entre le troisième et le quatrième, à peine un avantage. Ce que le
deuxième niveau ajoute — peser les emplacements, viser un coût précis — vaut
plus que tout ce qui vient après.

C'est d'abord la mesure de ce que **la mise en place** coûte. Une colonie
posée sur le premier sommet de la liste, triée par identifiant, tombe en
moyenne sur des jetons médiocres, et la partie est perdue avant le premier
lancer. Rien de ce qu'un joueur fait ensuite ne rattrape cela.

### Le problème du faiseur de rois, chiffré

Le quatrième niveau devait se distinguer en visant le meneur : voleur posé
sur lui, et plus un échange qui l'arrange. Mesuré, il **perdait** contre le
troisième — huit victoires à quinze sur trente-deux parties — là où le même
niveau visant simplement la main la plus grosse gagnait quatorze à neuf.

Le geste est table-optimal et individuellement coûteux : le voleur posé sur
le meneur ne rapporte rien à celui qui le pose, il rend service aux dix
autres. C'est le problème du faiseur de rois, et il ne se règle pas en
cessant de freiner celui qui gagne — un jeu où personne ne le freine se
décide au cinquième cycle. Il se règle en ne le freinant **que lorsque c'est
urgent** : quand il est à quatre points du but, ou qu'il a pris trois points
d'avance. Avec cette condition, viser le meneur ne coûte plus rien —
treize à treize contre la visée cupide — et le comportement reste visible à
la table.

### Trois mécaniques sortent de l'ombre

Quatre parties à six joueurs au niveau 4, événements comptés :

| Mécanique | Avant | Maintenant |
|---|---|---|
| Choix de l'objectif secret | jamais fait | 24 sur 24 (tous les joueurs) |
| Annonces hors tour (§8) | jamais jouées | 46 déposées, 46 abouties, 0 remboursée |
| Port minier (§11) | zéro usage | 1 — contre 148 pour le port commercial |
| Monopole | joué sur ce qui manque | 19, visés sur ce que la table détient |
| Métropoles bâties | rares | 6 |

Le port minier reste donc **un port rare plutôt qu'un port mort** : un
adversaire ne s'en sert que lorsqu'il vise une métropole et qu'il lui manque
de l'or. L'exemption de marché du §11 n'est toujours pas validée par le
chiffre.

### Les annonces hors tour n'ajoutent pas de constructions, elles les avancent

Douze parties avec et sans, tout le reste égal : **91 constructions contre
92**. Même total, plus tôt. La mécanique du §8 ne fait donc pas construire
davantage une table, elle décale ce qu'elle aurait bâti de toute façon — ce
qui est exactement ce qu'elle promettait, et ce qui n'avait jamais été
vérifié faute d'un bot qui l'exerce.

Une mise en garde de méthode, apprise en chemin : deux variantes de bot ne
jouent pas la même partie à graine égale. Elles consomment le hasard
différemment, donc divergent dès le premier tirage. Une première mesure
donnait aux annonces quatre-vingts cycles de retard ; la même mesure, après
d'autres réglages sans rapport, leur donnait vingt-cinq cycles d'avance.
Seules les grandeurs **cumulées sur beaucoup de parties** — constructions,
victoires — résistent à cela ; la durée d'une partie, non.

### Le niveau et la durée d'une soirée

48 parties par ligne, à 6 joueurs, tous les sièges au même niveau :

| Niveau | Cycles | Conclues | Offres (acceptées) | Banque | Annonces | Défausses |
|---|---|---|---|---|---|---|
| 1 — Apprenti | 229 | 38/48 | 0 | 148 | 0 | 26 |
| 2 — Colon | **192** | 36/48 | 324 (26 %) | 164 | 0 | 48 |
| 3 — Aguerri | 206 | 34/48 | 362 (19 %) | 182 | 13 | 57 |
| 4 — Stratège | 209 | 34/48 | 362 (17 %) | 215 | 14 | 56 |

Une table forte joue un peu plus longtemps qu'une table moyenne, et conclut
un peu moins souvent. La cause n'est pas le talent : c'est que tout le monde
avance, que le plateau se remplit, et qu'un joueur ayant posé ses cinq
colonies, ses quatre villes et son monument plafonne autour de treize points,
titres compris. La partie cesse alors de progresser **faute de place**, et
non faute de ressources — le même mur que le tour sur les échelles de
plateau avait déjà rencontré.

Pour l'hôte, la conséquence est pratique : à niveau élevé, prévoir plus de
terres ou baisser le seuil de victoire. C'est dit sur son écran, sous les
molettes.

### Le taux d'acceptation des échanges

19 % des offres aboutissent, contre 3 % à la première version du pilote. Le
correctif n'était pas de proposer davantage mais de **juger une offre en
valeur continue** plutôt que par un seuil binaire. La première version
n'acceptait que ce qui comblait exactement le coût visé : la table proposait
sans arrêt et n'échangeait jamais. Une carte vaut ce qu'elle vaut — le trou
du plan d'abord, la pénurie de terrain ensuite, presque rien quand on en a
déjà cinq — et deux cartes contre une passent alors presque toujours.

### Ce que ces mesures ne disent toujours pas

- **Le plancher, pas le plafond.** Un stratège regarde un coup en avant,
  jamais deux. Il ne bluffe pas, ne coalise pas, et ne renonce jamais à un
  échange pour empêcher un autre de le faire.
- **Les parties simulées ne connaissent pas le temps.** Le pilote décide
  toujours avant l'expiration du chronomètre ; en soirée, la fenêtre de
  commerce de trente secondes contraint tout autrement.
- **Six caractères ne font pas six styles humains.** Ils font six jeux de
  poids, ce qui suffit à les distinguer à la table — le marchand dépose 1382
  offres là où le corsaire en dépose 395 — mais pas à imiter quelqu'un.
