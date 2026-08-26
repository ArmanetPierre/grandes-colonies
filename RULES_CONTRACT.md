# Rules Contract v1 — Grand Colonies

> Les règles exactes des mécaniques concurrentes, tranchées le 2026-08-27.
>
> Ce document existe parce que le game design décrit des **intentions**, pas des cas limites. Coder une mécanique simultanée sans avoir écrit sa règle revient à l'inventer par accident — et à devoir la défaire quand on s'aperçoit qu'elle ne correspondait pas à l'intention.
>
> Il fait autorité sur le code. En cas de désaccord entre ce document et le moteur, c'est le moteur qui a tort.
>
> Game design : [Catan_Grand_Colonies_8-12_joueurs.md](Catan_Grand_Colonies_8-12_joueurs.md) · Plan : [PLAN_DE_DEVELOPPEMENT.md](PLAN_DE_DEVELOPPEMENT.md)

---

## 1. Structure du cycle

Un cycle se déroule en trois temps, et non cinq : les phases B et C du §7 du game design sont **fusionnées**.

```text
A · PRODUCTION      le joueur actif lance les dés, tout le monde produit
                    ↓
B · TOUR            90 s — joueur actif ET joueur associé jouent SIMULTANÉMENT
                    les autres joueurs peuvent annoncer des constructions
                    ↓
C · COMMERCE        30 s — tout le monde peut échanger avec tout le monde
                    ↓
                    résolution des annonces, contrôle de victoire, cycle suivant
```

**Durée d'un cycle : 2 minutes.** À 12 joueurs, un tour de table complet prend 24 minutes, ce qui donne 5 à 6 tours actifs par joueur sur une partie de deux heures.

### Pourquoi simultanés

C'est le seul choix compatible avec la durée cible. En séquentiel, le cycle passerait à 3,5 minutes, soit 42 minutes par tour de table et moins de 3 tours actifs par joueur — atteindre 15 points de victoire deviendrait hors de portée.

Le coût est que le serveur reçoit deux flux d'actions en parallèle. Il les sérialise déjà dans une file ordonnée, donc le moteur ne voit jamais de vraie concurrence.

### Droits par rôle

| Rôle | Commercer avec la banque | Commercer entre joueurs | Construire | Acheter une carte | Annoncer une construction |
|---|:--:|:--:|:--:|:--:|:--:|
| Actif | oui | oui | oui | oui | — |
| Associé | oui | **non** | oui | oui | — |
| Autres | non | pendant la phase C | non | non | **oui** |

Le joueur associé est celui situé **trois positions à gauche** de l'actif.

---

## 2. Le chronomètre

**À zéro, ce qui est sélectionné est validé automatiquement.** L'action en cours n'est jamais annulée.

La raison est qu'aucun joueur ne doit pouvoir bloquer la partie, et qu'à 5 ou 6 tours actifs par personne, perdre un tour coûterait 20 % de sa partie. C'est déjà ce que montrent les wireframes pour la défausse : « à 0 s, la proposition est validée automatiquement ».

Une action **entamée** avant zéro se termine donc après zéro. Le moteur ne connaît pas le temps : c'est le serveur qui, à l'expiration, émet la commande de validation correspondant à l'état sélectionné par le client.

---

## 3. Construction hors tour

**Tout joueur peut annoncer une construction à tout moment**, y compris hors de son tour et hors de la phase de commerce.

C'est la mécanique la plus ambitieuse du jeu et celle qui sert le mieux son objectif — que personne ne soit jamais passif. C'est aussi la plus complexe à coder et à rendre lisible.

### Cycle de vie d'une annonce

```text
ressources disponibles
        ↓  annonce
ressources RÉSERVÉES  ──────────────┐
        ↓                           │ annulation
   BuildIntent en attente           │ (libre, à tout moment)
        ↓  fin de phase C           │
     résolution                     │
    ↙         ↘                     ↓
construite   perdue → ressources rendues
```

### Réservation

**Les ressources sont réservées dès l'annonce.** Elles ne sont plus échangeables, ni utilisables pour une autre construction. Elles sont rendues si la construction échoue.

Sans cela, un joueur pourrait promettre le même bois à trois constructions, puis le vendre entre-temps : l'annonce ne voudrait plus rien dire.

### Résolution des conflits

Quand plusieurs annonces visent le même emplacement :

1. **le joueur actif l'emporte** ;
2. sinon, **la plus ancienne annonce l'emporte** — l'ordre d'arrivée au serveur fait foi ;
3. les perdants récupèrent leurs ressources réservées.

Cette règle **désigne toujours un vainqueur**.

> **Conséquence assumée : le gel d'emplacement est aujourd'hui inatteignable.** La règle du §8 du game design le prévoyait pour départager une égalité d'Influence, mais l'Influence n'existera qu'en phase tardive. La mécanique de gel est implémentée et testée, elle ne se déclenche simplement jamais tant que le départage par ancienneté tranche tout. Le jour où l'Influence arrivera, il suffira de l'insérer entre les règles 1 et 2.

### Gel

Quand il se produit, un emplacement gelé le reste **jusqu'à la fin du cycle**. Il redevient libre au cycle suivant, pour tout le monde à égalité.

---

## 4. Commerce

Une **fenêtre dédiée de 30 secondes** par cycle, pendant laquelle tous les joueurs peuvent échanger entre eux.

L'acceptation d'une offre est **atomique côté serveur** : inventaire de A, inventaire de B, phase, validité de l'offre, puis les deux transferts. Si l'inventaire de l'un a changé entre-temps, l'offre devient caduque.

Les ressources réservées par une annonce de construction **ne sont pas échangeables**.

> **À surveiller au playtest.** À 12 joueurs, 30 secondes pour négocier *et* valider, c'est très court. Si la fenêtre se révèle insuffisante, les leviers sont : l'allonger, ou basculer sur un commerce permanent pendant tout le cycle.

---

## 5. Victoire

**La victoire est vérifiée à la fin du cycle, jamais en cours de phase.**

Personne n'est coupé en plein geste : toutes les actions engagées se terminent, y compris celles des autres joueurs pendant la phase simultanée.

Si **plusieurs joueurs** atteignent le seuil dans le même cycle :

1. le plus haut total l'emporte ;
2. à égalité parfaite, l'ordre du tour tranche, **en partant du joueur actif** puis vers sa gauche.

---

## 6. Questions encore ouvertes

Elles ne bloquent pas le moteur, mais devront être tranchées avant le premier playtest — ce sont des règles de **serveur**, pas de jeu.

- Que se passe-t-il si le **joueur actif se déconnecte** ? Son tour est-il joué par défaut, passé, ou la partie attend-elle ?
- Et si le **joueur associé** se déconnecte ? (moins grave : son tour peut simplement être sauté)
- Un joueur déconnecté pendant une **défausse** : validation automatique de la suggestion, comme à l'expiration du timer ?
- Combien de temps garde-t-on un **siège** avant de proposer de le remplacer par un bot ?

---

## 7. Journal des décisions

| Date | Question | Décision |
|---|---|---|
| 2026-08-27 | Tour actif et associé | **Simultanés** — seul choix compatible avec la durée cible |
| 2026-08-27 | Commerce | **Fenêtre dédiée de 30 s** |
| 2026-08-27 | Construction hors tour | **Tous, à tout moment** |
| 2026-08-27 | Chronomètre à zéro | **Validation automatique** |
| 2026-08-27 | Ressources d'une annonce | **Réservées dès l'annonce** |
| 2026-08-27 | Conflit de construction | **Actif, puis ancienneté** |
| 2026-08-27 | Durée du gel | **Jusqu'à la fin du cycle** |
| 2026-08-27 | Victoire en phase simultanée | **Contrôlée en fin de cycle** |
