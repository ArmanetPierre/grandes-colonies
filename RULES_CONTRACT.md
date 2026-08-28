# Rules Contract v1 — Grand Colonies

> Les règles exactes des mécaniques concurrentes, tranchées à partir du 2026-08-27.
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

L'échange avec la **banque** relève du §10 : son prix bouge, celui d'une offre entre joueurs jamais.

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

## 7. Cartes développement

Le paquet en compte cinq sortes (`GRAND_COLONIES_DECK`, 60 cartes). Deux
règles valent pour toutes, et comptent plus à douze qu'à quatre : **une carte
ne se joue pas le tour de son achat**, et **une seule carte par tour**. Sans
la première, on convertirait des ressources en chevalier au moment précis où
l'on en a besoin ; sans la seconde, un joueur qui a thésaurisé viderait sa
main d'un coup, hors de toute réaction.

Seul le **joueur actif** joue des cartes. L'associé construit et commerce,
mais ne joue pas de cartes : c'est déjà la règle du chevalier, et l'étendre
évite d'avoir à arbitrer deux monopoles dans le même tour.

| Carte | Effet | Fenêtre |
|---|---|---|
| Chevalier | Déplace le voleur, compte pour la puissance militaire | Production **ou** tour actif |
| Construction de routes | Une ou deux routes gratuites | Tour actif |
| Invention | Deux ressources au choix, prises à la banque | Tour actif |
| Monopole | Tous les autres joueurs cèdent la ressource nommée | Tour actif |
| Bâtisseur | **Une** construction offerte, au choix | Tour actif |

Le chevalier garde sa fenêtre plus large parce qu'il faut pouvoir écarter le
voleur *avant* de lancer les dés.

### Précisions

**Construction de routes** accepte une seule route. Un joueur enfermé, ou à
court de pièces, doit pouvoir jouer sa carte plutôt que de la garder morte en
main. Les deux emplacements sont validés dans l'ordre donné, car la seconde
route s'appuie souvent sur la première ; si la seconde est illégale, aucune
des deux n'est posée.

**Invention** respecte le stock de la banque, qui est fini.

**Bâtisseur** offre la *combinaison de ressources* d'une construction — route,
colonie ou cité — et non une construction supplémentaire : règles de
placement, pièces disponibles et emplacements gelés s'appliquent normalement.
Ce chiffrage la met à parité avec Construction de routes (deux routes, soit
quatre ressources) tout en laissant le choix au joueur.

> **À confirmer.** L'effet du Bâtisseur n'était défini nulle part ; le nom
> seul (« combinaison de construction offerte ») autorisait plusieurs
> lectures. Celle retenue est la plus économe et la mieux équilibrée, mais
> elle reste à valider en partie.

---

## 8. Métropoles et monuments

Le barème de victoire chiffrait ces deux constructions depuis le début — 3
points et 2 points — mais rien ne les attribuait : la table était morte. Ce
sont pourtant les mécaniques qui séparent Grand Colonies du Catan de base, et
elles répondent au problème mesuré en simulation : les parties s'éternisent
parce que les joueurs finissent **à court d'emplacements**, pas à court de
ressources. Métropole et monument font croître le score **en hauteur** plutôt
qu'en surface.

### La métropole

Améliore une de tes cités. Coût : **3 minerai, 2 blé, 2 or**. Elle vaut
3 points **au lieu** des 2 de la cité — un point net — et produit autant
qu'elle, ni plus.

**Il n'y en a que trois pour toute la partie.** C'est un prix de course,
comme la route la plus longue : à douze joueurs, une amélioration accessible
à tous gonflerait tous les scores sans rien départager.

> **Pourquoi l'or.** L'or était une ressource morte : produit par ses
> hexagones, compté par la banque, mais réclamé par aucun coût — le seul
> objectif qui s'en servait est désactivé faute de système. Il s'accumulait
> en main jusqu'à la défausse. La métropole lui donne enfin une raison
> d'exister, et donne aux tuiles d'or une valeur de placement.

### Le monument

Se bâtit sur une de tes cités ou métropoles. Coût : **une ressource de
chaque** — bois, brique, laine, blé, minerai. **Un seul par joueur.** Vaut
2 points.

Cinq ressources pour deux points, c'est le tarif d'une cité, mais **sans
emplacement à trouver**. C'est délibéré : le monument est la sortie d'un
joueur bloqué, celui qui a des ressources et plus aucun sommet libre. « Une
de chaque » l'oblige à passer par le commerce, ce qui fait vivre la table au
lieu de l'assécher.

### Ce qui reste inerte

`defenderToken` (1 point) et `majorExploration` (1 point) demeurent dans le
barème sans être attribués. Le premier attend les barbares, le second
l'archipel. Ils sont conservés plutôt que retirés, sur le modèle des
objectifs indisponibles : le jour où leur système arrive, il n'y aura rien à
rechiffrer.

---

## 9. Archipel et exploration

Le §4 du game design décrit une île centrale disputée et deux à trois îles
majeures, reliées seulement par la mer. Les plateaux étaient pourtant des
disques pleins : les voies maritimes n'avaient nulle part où mener, et
`majorExploration` restait inerte au barème.

### Le plateau

Une **île centrale** porte un peu plus de la moitié des terres, et **deux ou
trois îles secondaires** se partagent le reste — trois à partir de onze
joueurs, comme le prévoit le §4. Chaque île est séparée des autres par au
moins un hexagone de mer : c'est cette séparation qui rend la voie maritime
obligatoire plutôt qu'optionnelle.

La mise en place initiale se fait sur l'île centrale. Commencer sur une île
secondaire donnerait un point d'exploration gratuit, et priverait la partie
de la course qui en fait l'intérêt.

### L'exploration majeure

**Le premier joueur à bâtir une colonie sur une île secondaire gagne
1 point.** Une fois par île, jamais pendant la mise en place.

C'est la lecture la plus économe du §13, et la seule mesurable aujourd'hui.
Le game design y prévoit aussi des hexagones face cachée révélant ressources
rares, villages neutres, événements ou zones dangereuses — huit natures de
tuiles qui demandent chacune leurs propres règles. Ce système-là reste à
concevoir ; le point d'exploration, lui, récompense déjà ce qui compte :
avoir traversé le premier.

---

## 10. Le marché dynamique

Le §10 du game design demande « un indicateur de demande » par ressource,
qui baisse quand on en vend beaucoup et monte quand elle manque — et insiste
pour que le marché reste **simple**, sous peine de transformer la soirée en
simulation économique. Il donne six valeurs et rien d'autre : ni unité, ni
palier, ni bornes.

### L'indicateur est le taux bancaire

La lecture retenue est la plus économe possible : cet indicateur **est** le
taux d'échange avec la banque, celui qui existait déjà. Le jeu avait un 4:1
figé ; il a maintenant un cours qui bouge. Rien de nouveau à apprendre pour
un joueur — c'est le même geste, à un prix qui change.

Les six valeurs du §10 se lisent alors directement, et elles décrivent bien
l'économie de la table : bois 5, brique 4, laine 4, blé 3, minerai 3, or 2.
Le bois est partout et vaut peu ; l'or est rare et achète beaucoup.

### Le port remise, il n'impose pas

Le cours fixe le prix, **le port en retranche une remise** : une carte pour
un port générique, deux pour un port spécialisé ou marchand. C'est
exactement l'ancien barème — 4 nu, 3 générique, 2 spécialisé — mais exprimé
de façon à ce que les deux systèmes coexistent.

L'inverse aurait tué le marché : un port qui *impose* son taux le rendrait
invisible à tout joueur installé, c'est-à-dire à tous après quelques cycles.

Le taux final ne descend jamais sous **2**, le plancher du cours lui-même.
Sans quoi un port spécialisé sur une ressource déjà rare finirait par donner
du 1:1. L'or, qui ouvre au plancher, ne tire donc aucun bénéfice d'un port —
il est déjà au meilleur prix du jeu.

### Ce qui fait bouger le cours

**Une transaction bancaire, un cran de solde** : la ressource donnée afflue
et se déprécie, celle qui sort se raréfie et se renchérit. **Quatre
transactions nettes** dans le même sens déplacent le cours d'une carte.

On compte des transactions et non des cartes. Un échange donne toujours
`cours` cartes contre une seule : compter les cartes ferait monter le côté
vendu quatre à six fois plus vite que ne descend le côté acheté, et tous les
cours dériveraient vers le plafond en quelques dizaines d'échanges.

Le cours est borné à **2–6**, et le solde qui le porte l'est aussi, un cran
au-delà. Cette seconde borne n'est pas cosmétique : sans elle, la mesure a
montré une ressource vendue quatre cents fois de suite et un cours qu'il
aurait fallu quatre cents achats pour décoller. Une ressource saturée le
reste tant qu'on la brade, et repart dès qu'on cesse.

### Ce qui n'y touche pas

Le cours ne bouge **que** par la banque. Production, vol, monopole,
défausse, et surtout **échanges entre joueurs** n'y changent rien.

C'est délibéré, et c'est le cœur de l'intérêt du dispositif à douze joueurs :
plus la banque devient chère sur une ressource, plus il devient rentable de
se tourner vers la table. Le marché ne remplace pas la négociation, il la
pousse.

### Le cours est public

Chacun voit les six prix et le sens du prochain mouvement. Un marché que
l'on découvrirait au moment de cliquer ne serait pas un marché : c'est de le
voir monter qu'on décide de vendre maintenant plutôt qu'au cycle suivant.
Le taux affiché à chaque joueur est le sien, remise de ses ports comprise.

### Le poisson

`fish` porte une valeur d'ouverture pour que le barème soit complet, mais
aucun plateau actuel n'a de terrain qui en produise. Il ne sert pas.

---

## 11. Les ports à contrat

Le §11 introduit quatre ports en plus des classiques. Trois sont
implémentés ; le quatrième attend son système.

### Le port marchand

Déjà en place : remise de deux cartes sur n'importe quelle ressource. C'est
le seul des quatre dont l'effet se comprend sans avoir lu la règle, et c'est
pourquoi il est le premier semé quand la côte est courte.

### Le port minier — 2 minerai → 1 or

L'échange du §11, pris à la lettre. Mais il fallait trancher une chose que le
game design ne pouvait pas prévoir, puisqu'il ignore le marché : **ce prix
est-il soumis au cours ?**

**Non.** Le port minier est un contrat à prix fixe, et le marché ne le touche
jamais.

Sans cette exemption le port serait mort-né. Un port spécialisé minerai donne
déjà deux cartes de remise sur *tout*, y compris l'or, donc un port minier
soumis au même plancher de 2 n'aurait rien apporté que le port ordinaire ne
donnait déjà. Exempté, il devient exactement ce qu'un contrat doit être :
sans intérêt quand le minerai est bon marché, et très précieux quand le
marché l'a poussé à six.

### Le port commercial — 2 ressources différentes → 1 au choix

**Deux cartes de natures différentes**, jamais deux fois la même, et jamais
la ressource demandée en paiement. Prix fixe lui aussi.

C'est la contrainte de nature qui le distingue de tout le reste : on n'y
écoule pas un surplus, on y convertit une main éparpillée. La simulation
avait montré que le blocage à douze joueurs n'est pas la pénurie mais la
dispersion — dix cartes réparties sur cinq types ne font jamais une ville.
Ce port répond à ce problème-là, et à lui seul.

### Les contrats ne font pas bouger le marché

Un échange à l'un de ces ports n'émet pas de `MarketMoved` et ne touche pas
au solde du §10.

Ce n'est pas seulement cohérent avec leur prix fixe, c'est nécessaire : le
port commercial consomme deux cartes pour en rendre une. Les compter aurait
poussé deux cours vers le haut pour un seul vers le bas à chaque usage, et
fait dériver l'ensemble du marché vers son plafond — précisément le
déséquilibre que le §10 évite en comptant des transactions plutôt que des
cartes.

### Un seul exemplaire de chacun

Le marchand, le minier et le commercial sont semés **une fois par plateau**,
comme les métropoles sont trois pour la partie. Ce sont des positions de
course : deux ports miniers sur la même côte n'apprendraient rien de plus à
la table, et un plateau immense en aurait semé deux ou trois puisque les
types s'y répètent.

Ils sont plafonnés au tiers des ports du plateau : sur une côte de six, en
mettre trois ferait un plateau où le commerce ordinaire est l'exception.

### Le port royal reste à faire

Le §11 lui donne « un bonus d'Influence aux joueurs qui contrôlent sa
région ». Ni l'Influence ni la notion de région n'existent. Il n'est ni semé,
ni déclaré : contrairement aux jetons de défenseur du §8, il n'y a rien à
garder au chaud — un type de port inutilisé ne se contente pas d'être inerte,
il occupe un sommet de côte.

---

## 12. Journal des décisions

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
| 2026-08-27 | Qui joue les cartes développement | **Le joueur actif seul** — comme le chevalier |
| 2026-08-27 | Fenêtre des cartes autres que le chevalier | **Tour actif uniquement** |
| 2026-08-27 | Construction de routes avec une seule pose | **Autorisée** — sinon la carte reste morte en main |
| 2026-08-27 | Effet du Bâtisseur | **Une construction offerte au choix** — *à confirmer en partie* |
| 2026-08-27 | Effet de la métropole | **Amélioration d'une cité, 3 PV au lieu de 2**, trois pour la partie |
| 2026-08-27 | Coût de la métropole | **3 minerai, 2 blé, 2 or** — donne enfin un usage à l'or |
| 2026-08-27 | Effet du monument | **2 PV, un seul par joueur**, bâti sur une cité |
| 2026-08-27 | Coût du monument | **Une ressource de chaque** — oblige à commercer |
| 2026-08-27 | Jetons de défenseur et exploration majeure | **Conservés au barème, inertes** en attendant leur système |
| 2026-08-27 | Structure du plateau | **Île centrale + 2 ou 3 îles secondaires**, séparées par la mer |
| 2026-08-27 | Mise en place | **Sur l'île centrale seulement** |
| 2026-08-27 | Exploration majeure | **1 point au premier arrivé sur chaque île secondaire**, hors mise en place |
| 2026-08-27 | Hexagones face cachée du §13 | **Repoussés** — huit natures de tuiles à concevoir |
| 2026-08-28 | Nature de l'indicateur du §10 | **C'est le taux bancaire lui-même**, pas une valeur séparée |
| 2026-08-28 | Cours d'ouverture | **Les six valeurs du §10** : bois 5, brique 4, laine 4, blé 3, minerai 3, or 2 |
| 2026-08-28 | Ports et marché | **Le cours fixe, le port remise** — 1 carte en générique, 2 en spécialisé |
| 2026-08-28 | Plancher du taux | **2 contre 1**, port compris — l'or n'y gagne donc rien |
| 2026-08-28 | Unité de mouvement | **La transaction, pas la carte** — sinon tous les cours dérivent vers le plafond |
| 2026-08-28 | Palier | **4 transactions nettes** pour un cran ; cours borné à 2–6 |
| 2026-08-28 | Solde porteur du cours | **Borné lui aussi**, un cran au-delà — sans quoi un cours saturé ne redescend jamais |
| 2026-08-28 | Ce qui fait bouger le cours | **La banque seule** — les échanges entre joueurs n'y touchent pas |
| 2026-08-28 | Visibilité du cours | **Public**, avec le sens du prochain cran |
| 2026-08-28 | Port minier et marché | **Exempté du cours** — sinon un port spécialisé minerai le rendait inutile |
| 2026-08-28 | Port commercial | **Deux cartes de natures différentes** contre une au choix, prix fixe |
| 2026-08-28 | Paiement au port commercial | **Jamais avec la ressource demandée** |
| 2026-08-28 | Contrats et cours | **Sans effet sur le marché** — deux entrées pour une sortie l'auraient fait dériver |
| 2026-08-28 | Semis des ports particuliers | **Un seul de chaque par plateau**, plafonnés au tiers des ports |
| 2026-08-28 | Port royal | **Non semé** — il attend l'Influence, et un port inutilisé occupe une côte |
