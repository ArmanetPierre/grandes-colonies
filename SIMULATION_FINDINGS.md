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
