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

## Ce qu'il faut trancher

Trois leviers, non exclusifs.

**Implémenter les objectifs secrets.** Ils valent 2 points et le §39 les prévoit déjà dans la première version jouable — ils ne sont donc pas un ajout mais un oubli. Ils portent le plafond réaliste de 12 à 14, ce qui reste juste sous le seuil.

**Augmenter la dotation de routes.** C'est le verrou mesuré. Passer de 15 à 20 routes par joueur desserre directement l'expansion, sans toucher au barème.

**Abaisser le seuil de victoire.** À 12 points, les parties se concluent avec le barème actuel. C'est le levier le plus simple, mais il contredit l'intention du §22, qui justifiait 15 par la taille de la carte.

> Ma recommandation : **les trois premiers d'abord, le seuil en dernier recours.** Le seuil de 15 n'est pas arbitraire — il vient de la taille du plateau. Le baisser reviendrait à traiter le symptôme plutôt que la cause, qui est un barème incomplet et une dotation de routes calquée sur un jeu à quatre joueurs.

---

## Limites de ces mesures

- Les bots sont volontairement simples : ils construisent par ordre de valeur en points et ne planifient rien. Un humain expanderait mieux et atteindrait probablement quelques points de plus.
- Le commerce **entre joueurs** n'est pas simulé, faute d'être implémenté. C'est un manque important : le §37 du game design en fait le cœur du jeu à douze.
- Les ports, l'or, l'exploration et les chevaliers ne sont pas encore dans le moteur.
- La construction semi-simultanée existe dans le moteur mais les bots ne l'utilisent pas : ils n'annoncent jamais hors de leur tour.

Ces mesures disent donc où se situe le **plancher**, pas le plafond réel du jeu fini.
