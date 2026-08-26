# Spécification des écrans — Grand Colonies

> Brief destiné au **designer UI/UX**.
>
> Décrit le contexte, les contraintes, l'inventaire des écrans et le détail de chacun.
>
> Projet : [PLAN_DE_DEVELOPPEMENT.md](PLAN_DE_DEVELOPPEMENT.md) · Assets : [SPEC_ASSETS_IMAGES.md](SPEC_ASSETS_IMAGES.md) · Règles : [Catan_Grand_Colonies_8-12_joueurs.md](Catan_Grand_Colonies_8-12_joueurs.md)

---

## 1. Le projet en une page

**Grand Colonies** est un jeu de plateau numérique inspiré de Catan, conçu pour **8 à 12 joueurs**. Il se joue en **réseau local** : le serveur tourne sur le PC de l'hôte, chaque joueur se connecte depuis le navigateur de son propre appareil. **Tous les joueurs sont physiquement dans la même pièce.**

### Ce qui rend ce jeu différent de tout Catan numérique existant

Un Catan classique est strictement tour par tour : un joueur agit, onze attendent. À 12 joueurs, cela produirait 90 % de temps mort. Le design a donc été conçu pour que **presque tout le monde ait quelque chose à faire en permanence** :

- La partie est découpée en **cycles**. À chaque cycle, un joueur est **actif** (il fait tout : commercer, construire, acheter) et un autre est **associé** (il peut construire et commercer avec la banque, mais pas négocier avec les autres joueurs).
- Chaque cycle contient une **fenêtre de commerce libre de 30 secondes** pendant laquelle *tous* les joueurs peuvent négocier entre eux.
- Les joueurs peuvent **annoncer une construction hors de leur tour**. Si deux joueurs visent le même emplacement, une règle de priorité tranche — et en cas d'égalité, l'emplacement est **gelé** pour le cycle.
- Des **timers serveur** rythment le tout : environ 90 s pour le tour actif, 30 s pour le commerce.

### La conséquence pour le design

> Un joueur n'est jamais simplement « en attente ». Il est en permanence dans l'un de quatre états : **actif**, **associé**, **en fenêtre de commerce**, ou **passif mais autorisé à annoncer une construction**.

L'enjeu central de l'interface est donc de répondre en un coup d'œil, à tout moment, à la question : **« qu'est-ce que je peux faire, là, maintenant, et combien de temps me reste-t-il ? »**

C'est le critère selon lequel toute proposition de design doit être jugée.

---

## 2. Contraintes transversales

### 2.1 Appareils

Chacun joue sur ce qu'il a sous la main. Aucun appareil n'est majoritaire.

| Cible | Résolution de référence | Importance |
|---|---|---|
| Ordinateur portable | 1440 × 900 | **Principale** |
| Ordinateur de bureau | 1920 × 1080 | Élevée |
| Tablette paysage | 1024 × 768 | Élevée |
| Téléphone portrait | 390 × 844 | **À traiter sérieusement** |

Le téléphone est le vrai défi : il faut y afficher un plateau de 50 hexagones, 11 adversaires et un panneau de commerce. Une réorganisation complète de la mise en page y est attendue, pas un simple redimensionnement.

### 2.2 Identité visuelle des 12 joueurs

Contrainte forte et structurante. Douze couleurs réellement distinguables n'existent pas — surtout appliquées à une route de quelques pixels de large sur un plateau dézoomé, et surtout pour un joueur daltonien.

**La solution attendue est redondante** : chaque joueur reçoit une **couleur**, **plus** une **forme** d'avatar, **plus** un **motif** de remplissage (rayures, points, damier, chevrons…). Un joueur doit rester identifiable si l'on retire mentalement la couleur.

Livrable attendu : la palette des 12 identités, validée en simulation de daltonisme (deutéranopie, protanopie, tritanopie).

### 2.3 Lisibilité à distance

Les joueurs sont dans la même pièce et regarderont l'écran du voisin, et éventuellement un écran partagé. **Le timer et la phase en cours doivent être lisibles à deux mètres.**

### 2.4 États à prévoir pour chaque écran

Un écran n'est pas un état unique. Pour chaque maquette, prévoir :

```text
☐ état nominal
☐ joueur déconnecté / en reconnexion
☐ partie en pause
☐ timer sous 10 secondes (alerte)
☐ action impossible (et pourquoi)
☐ limite de main atteinte
☐ chargement / attente serveur
```

### 2.5 Langue

Interface en **français**. Prévoir des libellés qui supportent une traduction ultérieure (pas de mise en page dépendant de la longueur exacte des mots).

---

## 3. Inventaire des écrans

| # | Écran | Utilisateur | Complexité | Priorité |
|---|---|---|---|---|
| 1 | Rejoindre | Joueur | Faible | P0 |
| 2 | Lobby | Joueur | Faible | P0 |
| 3 | Console hôte | Hôte | Moyenne | P0 |
| 4 | **Jeu** | Joueur | **Très élevée** | **P0** |
| 5 | Fin de partie | Joueur | Faible | P0 |
| 6 | Panneau maître de jeu | Hôte | Moyenne (esthétique non prioritaire) | P0 |
| 7 | Tableau de bord métriques | Hôte | Moyenne | P2 |

**L'écran 4 représente environ 90 % de la charge de design.** Les écrans 1, 2 et 5 sont volontairement simples et peuvent réutiliser un même gabarit.

---

## 4. Écrans 1, 2, 3 et 5 — les écrans simples

### Écran 1 — Rejoindre

**Objectif** : entrer dans la partie en moins de 15 secondes, souvent depuis un téléphone scanné au QR code.

**Contenu** : champ pseudo, sélection de couleur/identité parmi celles encore libres, code de partie (pré-rempli si arrivée par QR code), bouton Rejoindre.

**Points d'attention** : la sélection d'identité doit déjà montrer la redondance couleur + forme + motif (§2.2). Les identités déjà prises apparaissent désactivées, avec le nom de celui qui l'a choisie.

### Écran 2 — Lobby

**Objectif** : attendre le démarrage en sachant qui est là.

**Contenu** : liste des joueurs connectés avec leur identité et leur statut (connecté / prêt), nombre de joueurs actuel sur le minimum requis, résumé de la configuration de la partie (nombre de PV pour gagner, durée des tours, modules activés), bouton Prêt, indication que seul l'hôte peut lancer.

**Points d'attention** : à 12 joueurs, la liste doit rester lisible sur téléphone. C'est aussi le premier endroit où le joueur découvre les 12 identités côte à côte — bon terrain de validation de la palette.

### Écran 3 — Console hôte

**Objectif** : permettre à l'hôte d'ouvrir la partie et d'y faire entrer 11 personnes sans assistance technique.

**Contenu** :
- **Adresse LAN en très gros** (ex. `192.168.1.42:3000`) et **QR code** — c'est le contenu principal de l'écran, il sera montré à la ronde ou projeté ;
- code de partie mémorisable (ex. `ORANGE-7`) ;
- liste des sièges avec leur occupant et son état de connexion ;
- réglages de partie : nombre de PV, durée du tour actif, durée du commerce, limite de main, modules activés (exploration, or, objectifs secrets…) ;
- boutons Démarrer, Mettre en pause, Sauvegarder.

**Points d'attention** : cet écran est utilisé debout, en montrant l'écran aux autres. Hiérarchie très marquée : le QR code et l'adresse écrasent tout le reste. Les réglages sont secondaires et peuvent être repliés.

### Écran 5 — Fin de partie

**Objectif** : comprendre qui a gagné et pourquoi, et donner envie de rejouer.

**Contenu** : classement final, détail des points par source (colonies, villes, objectifs secrets révélés, plus long réseau, puissance militaire…), quelques statistiques marquantes de la partie (le plus gros commerçant, le plus grand bâtisseur, le plus malchanceux aux dés), boutons Rejouer et Quitter.

**Points d'attention** : les objectifs secrets se révèlent ici — c'est un moment de jeu, il mérite une mise en scène. Les statistiques proviennent des métriques déjà collectées (§13 du plan).

---

## 5. Écran 4 — L'écran de jeu

### 5.1 Mise en page proposée (à challenger)

```text
┌─────────────────────────────────────────────────────────────┐
│ ① Cycle 12 · Phase Commerce · Actif: Léa · Associé: Marc    │
│                                          ⏱ 00:23            │
├──────────┬──────────────────────────────────┬───────────────┤
│          │                                  │               │
│    ③     │                                  │      ⑥        │
│ Joueurs  │              ②                   │   Commerce    │
│   (12)   │           PLATEAU                │               │
│          │                                  ├───────────────┤
│          │                                  │      ⑦        │
│          │                                  │   Journal     │
├──────────┴──────────────────────────────────┴───────────────┤
│ ④ Ma main : 🌲3 🧱2 🌾1 🐑4 ⛏️0   (9/13)                     │
│ ⑤ [Construire ▾] [Carte dev] [Banque] [Fin d'action]        │
└─────────────────────────────────────────────────────────────┘
```

Cette disposition est un **point de départ**, pas une contrainte. Elle est là pour donner une base de discussion et rendre les zones concrètes.

### 5.2 Zone ① — Barre de statut

La zone la plus importante de l'écran après le plateau.

**Contenu** : numéro du cycle, phase en cours (Production / Tour actif / Tour associé / Commerce libre), joueur actif, joueur associé, **timer**, et surtout **l'action attendue de moi**.

**Le point critique** : ce dernier élément — « c'est à toi de jouer », « tu peux construire », « défausse tes cartes », « tu peux seulement regarder » — est ce qui évite qu'un joueur rate son tour. Il doit être impossible à manquer, et se distinguer nettement de l'information sur les autres.

Le timer doit changer d'apparence sous 10 secondes, sans devenir agressif au point de stresser inutilement (le retour de playtest sur ce point est explicitement prévu).

### 5.3 Zone ② — Plateau

**Contenu** : 44 à 52 hexagones de terrain, jetons numérotés, ports, routes / colonies / villes / comptoirs de 12 joueurs, un ou deux voleurs, tuiles inexplorées, emplacements gelés, et **les intentions de construction en attente**.

**Interactions** : zoom, pan, sélection d'un emplacement constructible, survol/tap d'une tuile pour voir qui produit dessus.

**Trois difficultés spécifiques** :

1. **Densité.** Cinquante hexagones et les constructions de douze joueurs sur un écran de portable. Quelle taille minimale de tuile reste lisible ? Faut-il un mode « vue d'ensemble » distinct d'un mode « vue rapprochée » ?

2. **Les intentions de construction.** C'est un besoin d'affichage qui n'existe dans aucun jeu de plateau numérique connu : il faut montrer qu'un joueur a *annoncé* une construction, qu'elle n'est pas encore résolue, et qu'un autre joueur la conteste. Puis montrer le résultat : construction validée, ou **emplacement gelé** jusqu'à la fin du cycle. Comment rendre cela compréhensible sans surcharger le plateau ?

3. **Le cadrage.** Quand l'action se déroule à l'autre bout de la carte, faut-il recadrer automatiquement, ou signaler la direction sans bouger la vue ? Un recadrage automatique pendant qu'un joueur compose un échange serait pénible.

### 5.4 Zone ③ — Les 12 joueurs

**Contenu affiché en permanence, par joueur** : identité (couleur + forme + motif), pseudo, PV publics, nombre de cartes en main, Influence publique, statut (actif / associé / passif), état de connexion.

**Contenu au clic** : détail — bâtiments, ports contrôlés, cartes développement jouées, contrats en cours.

**Points d'attention** :
- **Ne pas reposer sur le survol** : la moitié des joueurs sont sur tablette ou téléphone, où le survol n'existe pas. Clic/tap obligatoire, survol en bonus.
- Le joueur actif et le joueur associé doivent ressortir immédiatement dans la liste.
- Sur téléphone, comment donner accès à 11 adversaires sans occuper l'écran ? Barre horizontale scrollable, tiroir, vue dédiée ?

### 5.5 Zone ④ — Ma main

**Contenu** : ressources par type avec quantité, cartes développement, jetons spéciaux.

**Point critique** : l'**indicateur de limite de main**. Dans ce jeu, les joueurs produisent beaucoup mais ont peu d'occasions de dépenser (voir §16 du plan de développement). La limite de main sera atteinte souvent, et chaque 7 provoquera une défausse. Le joueur doit voir venir le danger **avant** le lancer de dés, pas le subir.

### 5.6 Zone ⑤ — Barre d'actions

**Contenu** : Construire (route / colonie / ville / comptoir), Acheter une carte développement, Commercer avec la banque, Fin d'action.

**Principe** : les actions disponibles sont calculées par le serveur (système de capacités, §5.5 du plan). L'interface ne devine rien.

**Point d'attention** : une action indisponible ne doit pas seulement être grisée, elle doit **dire pourquoi** — « pas assez de brique », « ce n'est pas ton tour », « emplacement gelé ». C'est ce qui permet d'apprendre les règles sans que le développeur explique en permanence, ce qui est un critère de sortie explicite du projet.

### 5.7 Zone ⑥ — Commerce

**Le sous-projet UX le plus important de l'écran.**

Contexte déterminant : **les joueurs sont dans la même pièce, la négociation est orale.** Personne ne va taper « je te donne 2 bois contre 1 minerai » — ils se le disent à voix haute. L'interface ne sert donc **pas** à négocier, mais à **exécuter très vite** un accord déjà conclu oralement, pendant une fenêtre de 30 secondes.

```text
Je donne : [🌲] [🌲]        Marc te propose :
Je veux  : [⛏️]                 2 🌲  ↔  1 ⛏️
À        : [Marc ▾]
                                [ACCEPTER]  [REFUSER]
        [PROPOSER]
```

**Questions de design** :
- Combien de gestes pour envoyer une offre ? L'objectif devrait être deux ou trois, pas huit.
- Le panneau doit-il rester visible en permanence, ou n'apparaître que pendant la fenêtre de commerce ?
- Comment afficher plusieurs offres reçues simultanément sans noyer le joueur ? À 12 joueurs, en 30 secondes, plusieurs offres peuvent arriver en même temps.
- Comment signaler qu'une offre est devenue **caduque** parce que l'inventaire de l'un des deux joueurs a changé entre-temps ?

### 5.8 Zone ⑦ — Journal

**Contenu** : fil des événements récents — production, constructions, échanges conclus, voleur, conflits résolus.

**Utilité réelle** : un joueur qui regardait ailleurs pendant 20 secondes doit pouvoir rattraper ce qui s'est passé. À 12 joueurs, il se passe beaucoup de choses par minute — le journal doit être filtrable ou hiérarchisé, sinon il devient un mur de texte illisible.

### 5.9 Modales

Quatre pour la première version :

| Modale | Déclenchement | Contrainte |
|---|---|---|
| **Défausse sur 7** | Un 7 est lancé, ma main dépasse la limite | **La plus critique** — voir ci-dessous |
| Déplacement du voleur | J'ai lancé un 7 ou joué un Chevalier | Sélection sur le plateau, choix de la victime |
| Offre d'échange reçue | Un joueur me propose un échange | Doit peut-être être un élément en ligne plutôt qu'une modale |
| Résolution de conflit | Ma construction annoncée a été départagée | Feedback : gagné, perdu, ou emplacement gelé — et pourquoi |

Plus tard : choix de carte développement (Invention, Monopole), révélation d'exploration, objectifs secrets, attaque des barbares.

**La modale de défausse mérite une attention particulière.** Elle se déclenche pour **tous les joueurs concernés en même temps**, une dizaine de fois par partie, et bloque la progression du jeu jusqu'à ce que le dernier ait terminé. C'est le principal pic de temps mort identifié dans le projet — exactement ce que tout le design cherche à éliminer. Objectif : défausse réalisable en moins de 10 secondes, avec sélection en un geste, suggestion automatique, et validation automatique à l'expiration du timer.

### 5.10 Les quatre états du joueur

Chaque état doit être visuellement distinct et immédiatement reconnaissable :

| État | Ce que je peux faire |
|---|---|
| **Actif** | Tout : commercer avec tous, construire, acheter, déplacer le voleur |
| **Associé** | Construire, commercer avec la banque, acheter — mais pas négocier avec les autres joueurs |
| **Fenêtre de commerce** | Négocier avec tout le monde pendant 30 s |
| **Passif** | Éventuellement annoncer une construction, préparer mes actions, observer |

Un joueur ne doit jamais avoir à se demander dans lequel il se trouve.

---

## 6. Écran 6 — Panneau maître de jeu

**Réservé à l'hôte. Esthétique non prioritaire, efficacité maximale.**

Outil de développement et de playtest : donner ou retirer des ressources, forcer un lancer de dés, changer de phase, modifier le timer, ajouter des PV, révéler une tuile, placer ou supprimer une construction, forcer un échange, déplacer le voleur, terminer la partie.

**Raison d'être** : atteindre en 10 secondes une situation de jeu qui demanderait 45 minutes de partie réelle à reproduire. Il sera très utilisé pendant les playtests. Un simple panneau latéral dense, en liste, suffit.

---

## 7. Questions ouvertes pour le designer

Ce sont les points où l'avis d'un designer changera réellement le produit :

1. **Comment rendre évident, en permanence et sans lecture, ce que le joueur peut faire à cet instant ?** C'est la question n° 1 du projet.
2. **Comment afficher 11 adversaires sur un écran de téléphone** tout en gardant le plateau utilisable ?
3. **Comment visualiser les intentions de construction concurrentes et le gel d'emplacement** ? Aucune référence connue n'existe.
4. **Le panneau de commerce doit-il être permanent ou contextuel ?**
5. **Comment rendre la défausse sur 7 exécutable en moins de 10 secondes ?**
6. **Quelle différenciation visuelle entre les rôles actif et associé ?** Assez forte pour ne pas être confondue, assez discrète pour ne pas dominer l'écran.
7. **La palette des 12 identités** — couleur + forme + motif, validée en daltonisme.
8. **Le timer** : comment créer l'urgence sans stresser ? Le retour de playtest sur ce point est explicitement prévu.

---

## 8. Livrables attendus et ordre

L'ordre compte : l'écran de jeu conditionne tout le reste, y compris la faisabilité technique.

1. **Wireframes basse fidélité de l'écran de jeu**, en trois formats (portable, tablette, téléphone), avec les quatre états du joueur. C'est le livrable qui débloque le projet.
2. **Palette des 12 identités** (couleur + forme + motif) avec validation daltonisme.
3. **Design system minimal** : typographie, couleurs, espacements, boutons, modales, badges d'état.
4. **Maquettes haute fidélité de l'écran de jeu**, avec les modales.
5. **Écrans simples** (Rejoindre, Lobby, Console hôte, Fin de partie) — rapides une fois le design system posé.

**Ce qui n'est pas demandé à ce stade** : animations complexes, illustrations (traitées séparément dans [SPEC_ASSETS_IMAGES.md](SPEC_ASSETS_IMAGES.md)), direction artistique poussée. Le jeu n'a jamais été joué, même sur table — le design doit rester peu coûteux à modifier tant que les règles bougent.

---

*Document créé le 2026-08-26.*
