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

### Qui peut répondre pendant le tour actif

Le §1 accorde au joueur actif le droit de négocier avec les autres pendant son tour, mais ne précisait pas **qui pouvait lui répondre**. Restreindre la réponse au seul joueur actif rendait la règle vide : une offre sans contrepartie possible ne sert à rien.

**Pendant le tour, un échange est recevable dès lors que le joueur actif en est l'une des deux parties.** N'importe quel joueur peut donc accepter une offre du joueur actif, ou lui répondre s'il l'a sollicité — mais deux joueurs non actifs ne peuvent pas échanger entre eux avant la phase C.

Les offres **ne franchissent pas le cycle** : les inventaires ont trop changé pour qu'une offre d'un cycle précédent garde un sens. Elles expirent à la résolution.

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

## 6. Absences et déconnexions

Une règle unique gouverne ces cas : **le jeu ne s'arrête jamais**, et ce qui est décidé à la place d'un joueur l'est de façon **minimale**. On débloque la partie, on ne joue pas à sa place.

### Joueur actif absent

**Son tour est joué par défaut** : les dés sont lancés, un éventuel 7 est traité, la main passe.

Rien d'autre. Aucune construction, aucun achat, aucun échange — ces décisions appartiennent au joueur, et les prendre pour lui fausserait sa partie bien plus que de les lui faire manquer.

C'est le même mécanisme qui sert à l'expiration du chronomètre (§2) : les deux situations posent le même problème et reçoivent la même réponse.

### Joueur associé absent

**Son tour est simplement sauté.** Aucun traitement n'est nécessaire : le tour associé est facultatif par nature, et son absence ne bloque personne.

### Défausse

**La suggestion du jeu est validée automatiquement**, exactement comme à l'expiration du chronomètre.

La suggestion entame toujours la pile la plus fournie de la main. Perdre sa seule brique coûte bien plus cher que perdre un bois sur cinq : préserver la diversité est ce qui se rapproche le plus de ce qu'aurait choisi le joueur.

### Voleur

Le voleur est posé sur un hexagone **ne touchant aucune construction**. Décider à la place d'un absent qui il doit bloquer serait arbitraire, et pourrait changer l'issue de la partie.

### Siège abandonné

Un siège est conservé **deux tours de table** avant que l'hôte ne se voie proposer de le remplacer par un bot.

> Toutes ces décisions sont déterministes : à graine et commandes égales, un tour joué par défaut produit toujours le même résultat. Sans quoi une partie comportant une déconnexion cesserait d'être rejouable.

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
| 2026-08-27 | Joueur actif absent | **Tour joué par défaut**, au strict minimum |
| 2026-08-27 | Joueur associé absent | **Tour sauté** |
| 2026-08-27 | Défausse d'un absent | **Suggestion validée d'office** |
| 2026-08-27 | Siège abandonné | **Deux tours de table** avant de proposer un bot |
| 2026-08-27 | Réponse à une offre pendant le tour | **Recevable si le joueur actif est l'une des deux parties** |
| 2026-08-27 | Durée de vie d'une offre | **Le cycle en cours** |
