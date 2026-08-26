# Plan de développement — Grand Colonies (version numérique)

> Version numérique du jeu de plateau fan-made **"Catan: Grand Colonies"** (8–12 joueurs), jouée en réseau local : le serveur tourne sur le PC de l'hôte, les joueurs se connectent depuis leur navigateur sur le même LAN.
>
> Document de game design de référence : [Catan_Grand_Colonies_8-12_joueurs.md](Catan_Grand_Colonies_8-12_joueurs.md)
>
> Statut : plan validé, en attente de revue par expert avant démarrage.

---

## 1. Contexte et objectif

Le document de game design décrit une variante de Catan pour 8–12 joueurs dont les mécaniques centrales sont pensées pour éliminer le temps d'attente :

- partie organisée en **cycles** (phases A–E) au lieu de tours classiques ;
- **tours associés** : pendant le tour du joueur actif, le joueur situé 3 positions à sa gauche joue aussi (commerce banque, construction, achat de cartes) ;
- **fenêtre de commerce libre chronométrée** (30 s) à chaque cycle, ouverte à tous ;
- **construction semi-simultanée** : annonce possible hors tour, résolution par priorité (joueur actif > Influence > blocage) ;
- plateau XXL de 44–52 hexagones, multi-îles, avec **exploration** (hexagones face cachée) ;
- systèmes additionnels : or, poisson, Influence, contrats, chevaliers/barbares, marché dynamique, objectifs secrets, double voleur, victoire à 15 PV.

**Objectif du projet** : une application web jouable à 8–12 sur réseau local, développée en s'appuyant sur l'écosystème open source existant.

---

## 2. Analyse des projets open source existants

### 2.1 Contraintes techniques imposées par le design

Trois hypothèses cassent toutes les implémentations open source existantes :

1. **8–12 joueurs** — l'existant plafonne à 4 ou 6 ;
2. **jeu non strictement tour par tour** — tours associés, fenêtre chronométrée et constructions hors tour imposent un serveur *temps réel* avec timers et actions concurrentes, pas une boucle de tours ;
3. **plateau et règles très étendus** — exploration = information cachée gérée côté serveur, économie étendue (or, marché, contrats), double voleur.

### 2.2 Candidats évalués

| Projet | Stack / Licence | Joueurs | Verdict |
|---|---|---|---|
| [catanatron](https://github.com/bcollazo/catanatron) | Python, GPL-3.0, très actif | 4 | Excellent **moteur + simulateur de bots** (milliers de parties/minute). Outil d'équilibrage, pas de base pour le produit final. |
| [JSettlers2](https://github.com/jdmonin/JSettlers2) | Java Swing, GPLv3, mature | 4–6 | Meilleure **référence de règles** (scénarios Seafarers, brouillard, bots). Client desktop vieillissant : à lire, pas à forker. |
| [Viral-Doshi/catan](https://github.com/Viral-Doshi/catan) | React + Socket.io, 2–6 joueurs | 2–6 | Bonne **référence UI/réseau** web ; moteur trop simple. |
| [Pioneers](https://alternativeto.net/software/pioneers/) | C / GTK | ~6 | Trop ancien, écosystème inadapté. |

### 2.3 Décision d'architecture

**Ne pas forker un clone existant** : les hypothèses « 4 joueurs, tour par tour, plateau standard » sont câblées partout dans leur code ; les étendre coûterait plus cher qu'une réécriture. À la place :

- **moteur de règles custom en TypeScript**, pur et découplé du réseau, en s'inspirant de la logique de catanatron et JSettlers2 (génération de plateau, plus longue route, production) ;
- **[Colyseus](https://colyseus.io/)** (MIT, activement maintenu) comme serveur temps réel : rooms multi-joueurs, synchronisation d'état, reconnexion. Préféré à boardgame.io (conceptuellement adapté mais peu maintenu) et au Socket.io brut (tout à réécrire) ;
- **client React** avec rendu SVG ou Canvas/PixiJS ;
- **catanatron** (ou des bots branchés sur notre moteur) comme banc d'équilibrage par simulation.

### 2.4 Architecture cible

```text
┌─────────────────────────────────────────────┐
│                 Monorepo TS                 │
│                                             │
│  packages/engine    règles pures, testées   │
│  packages/server    Colyseus (rooms, timers)│
│  packages/client    React (SVG/PixiJS)      │
│  packages/sim       bots + simulations      │
└─────────────────────────────────────────────┘

Déploiement LAN :
  PC hôte : serveur (node) + fichiers statiques du client
  Joueurs : navigateur → http://<ip-locale>:<port>
```

Le mode LAN simplifie beaucoup : pas d'authentification, pas d'hébergement, pas de scaling. Il faut en revanche soigner la **reconnexion** (un joueur qui recharge sa page doit retrouver sa partie) et prévoir un écran d'accueil « rejoindre la partie » avec choix du pseudo/couleur.

---

## 3. Plan par phases

### Phase 0 — Cadrage (quelques jours)

- Nom du projet sans la marque « CATAN » (déposée) ; aucun asset officiel réutilisé.
- Décision de licence : si du code GPL (catanatron, JSettlers2) est copié, le projet devient GPL. Recommandation : s'en servir uniquement comme référence de conception pour rester libre du choix de licence.
- Mise en place du monorepo TypeScript (pnpm workspaces), CI de tests, conventions.

### Phase 1 — Moteur de règles « Catan classique » (le socle)

Moteur pur TypeScript, sans réseau ni UI, entièrement testé unitairement :

- génération de plateau hexagonal (référence : [Red Blob Games](https://www.redblobgames.com/grids/hexagons/), lib possible : [honeycomb](https://github.com/flauwekeul/honeycomb)) ;
- production sur lancer de dés, distribution des ressources ;
- construction (routes, colonies, villes), règles de placement et distances ;
- commerce 4:1 et ports 3:1 / 2:1 ;
- voleur (défausse à 7, vol, blocage) ;
- cartes développement classiques ;
- plus longue route (le calcul de graphe le plus délicat), plus grande armée ;
- décompte des PV et détection de victoire.

Livrable : une partie classique à 4 jouable via une API programmatique (tests de scénario complets).

### Phase 2 — Extension « Grand Colonies » v1

Périmètre exact du **§39 du game design** (première version à tester) :

- plateau XXL multi-îles (44–52 hexagones), généré par configuration selon le nombre de joueurs (§2 et §4) ;
- 8–12 joueurs ;
- or (2 or → 1 ressource), ports spéciaux (§11) ;
- routes maritimes (1 bois + 1 laine) ;
- exploration : hexagones face cachée, révélation à l'arrivée (§13) ;
- règle 2/12 doublée (§6) ;
- double voleur à 11–12 joueurs (§25) ;
- limite de main selon le nombre de joueurs (§24) ;
- 15 PV, objectifs secrets simples (2 reçus, 1 conservé, +2 PV) (§21–22).

Hors scope v1 (conformément au §31) : marché dynamique, contrats, villes spécialisées, événements, Influence avancée, équipes.

### Phase 3 — Serveur temps réel (le cœur différenciant)

- Room Colyseus : lobby, attribution des couleurs, démarrage de partie ;
- machine à états des **cycles A–E** : production → tour actif → tour associé → commerce libre 30 s → cycle suivant ;
- **tours associés** : deux joueurs habilités simultanément avec des droits différents ;
- **construction semi-simultanée** : file d'annonces hors tour, résolution par priorité (actif > Influence > gel de l'emplacement) ;
- timers serveur (tour actif 90 s, commerce 30 s — configurables) ;
- information cachée côté serveur : hexagones non explorés, mains adverses, objectifs secrets ;
- reconnexion et reprise d'état ;
- protocole d'actions validées serveur (le client ne fait jamais autorité).

### Phase 4 — Client web React

- rendu du plateau en SVG ou PixiJS (50+ hexagones → zoom/pan fluide obligatoire) ;
- design system minimal : palette terrains, **12 couleurs joueurs distinguables** (couleur + motif/forme pour l'accessibilité daltoniens), icônes [game-icons.net](https://game-icons.net) (CC BY 4.0) ;
- bandeau compact des 11 adversaires (score, taille de main, influence), détail au survol ;
- affichage permanent du rythme : joueur actif, joueur associé, phase en cours, temps restant ;
- **interface de négociation** : la fenêtre d'échange à 30 s est l'écran le plus important du jeu (proposer/accepter vite, à plusieurs) — à maquetter avant développement ;
- journal de partie, sons discrets sur événements clés.

### Phase 5 — Équilibrage par simulation

- bots simples (heuristiques) branchés directement sur `packages/engine` ;
- simulation de centaines de parties à 8–12 pour vérifier : durées cibles (§2), anti-snowball (§33–34), pertinence de la limite de main, effet de la règle 2/12, fréquence des barbares ;
- option : porter les règles dans un fork de catanatron pour profiter de ses outils d'analyse.

### Phase 6 — Playtests réels

- parties LAN avec le groupe cible, grille d'évaluation du **§40** (5 questions par joueur, seuil 4/5) ;
- itération sur les règles d'après les retours, rejouées en simulation avant chaque nouvelle session ;
- ajout progressif des modules selon la courbe d'apprentissage du **§32** : chevaliers/barbares → Influence/contrats/marché → villes spécialisées.

### Phase 7 (optionnelle) — Direction artistique

Uniquement une fois le jeu validé en playtest (tant que les règles bougent, l'art détaillé serait jeté) :

- illustrations de tuiles et cartes (packs CC0 [Kenney](https://kenney.nl/assets) ou créations dédiées) ;
- animations, ambiance sonore, écran de fin de partie.

---

## 4. Design et UX — position

Le besoin artistique est **faible** : ~9 types de tuiles, pièces géométriques en 12 couleurs, jetons, cartes typographiques. Tout est réalisable en **SVG programmatique** style flat design, sans graphiste, avec les banques d'icônes libres citées ci-dessus.

Le vrai enjeu est l'**UX**, sans équivalent dans les Catan numériques existants :

1. lisibilité d'un plateau de 50+ hexagones avec les constructions de 12 joueurs ;
2. affichage de 11 adversaires sans saturer l'écran ;
3. visibilité permanente du rythme (phases, timers, rôles actif/associé) ;
4. fluidité de la négociation à 12 dans une fenêtre de 30 s.

Livrable design recommandé avant la Phase 4 : **maquette de l'écran de jeu à 12 joueurs** (Figma ou HTML statique) pour valider la disposition.

---

## 5. Risques identifiés

| Risque | Impact | Mitigation |
|---|---|---|
| La négociation orale à 12 ne passe pas bien via une UI | Cœur du jeu affaibli | Le jeu se joue en LAN **dans la même pièce** : la négociation reste orale, l'UI ne sert qu'à exécuter les échanges. À valider en playtest tôt. |
| Complexité de la machine à états temps réel (actions concurrentes) | Bugs de synchronisation | Moteur pur + validation serveur systématique + tests de scénario ; Colyseus gère la synchro d'état. |
| Équilibrage d'un design non testé (le jeu n'a jamais été joué, même sur table) | Refontes de règles | Phase 5 (simulation) avant les gros playtests ; périmètre v1 volontairement réduit (§39). |
| Portée du projet (beaucoup de systèmes) | Épuisement / abandon | Découpage strict par phases ; chaque phase livre quelque chose de jouable ou de mesurable. |
| Marque CATAN | Juridique (faible en LAN privé) | Nom original, aucun asset officiel, mention fan-made. |

---

## 6. Questions ouvertes pour la revue d'expert

1. **Validation table d'abord ?** Faut-il un prototype papier (§38) ou une session sur table simulée avant d'investir dans le développement, pour dérisquer le design ?
2. **Périmètre v1** : le §39 est-il le bon premier périmètre, ou faut-il encore le réduire (ex. sans exploration) ?
3. **Choix Colyseus** vs alternative (boardgame.io, Socket.io custom, autre) ?
4. **Négociation** : orale (même pièce) + exécution UI, ou système d'offres complet dans l'interface ?
5. **Simulation** : bots maison sur notre moteur vs fork catanatron — quel meilleur rapport effort/valeur pour l'équilibrage ?
6. **12 joueurs sur un écran** : des références d'UI de jeux numériques à grand nombre de joueurs à étudier ?

---

*Document généré le 2026-08-26. Sources d'analyse : [catanatron](https://github.com/bcollazo/catanatron) · [docs.catanatron.com](https://docs.catanatron.com/) · [JSettlers2](https://github.com/jdmonin/JSettlers2) · [Viral-Doshi/catan](https://github.com/Viral-Doshi/catan) · [Colyseus](https://colyseus.io/) · [game-icons.net](https://game-icons.net) · [Kenney](https://kenney.nl/assets) · [Red Blob Games — hexagons](https://www.redblobgames.com/grids/hexagons/)*
