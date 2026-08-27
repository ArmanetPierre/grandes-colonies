# Plan de développement — Grand Colonies (v2)

> Version numérique du jeu de plateau fan-made **"Grand Colonies"** (8–12 joueurs), inspiré de Catan, joué en réseau local : le serveur tourne sur le PC de l'hôte, les joueurs se connectent depuis leur navigateur sur le même LAN.
>
> **Documents de référence**
> - Game design : [Catan_Grand_Colonies_8-12_joueurs.md](Catan_Grand_Colonies_8-12_joueurs.md)
> - Revue d'expert (conservée telle quelle) : [PLAN_UPDATED.md](PLAN_UPDATED.md)
>
> **v2 — 2026-08-26.** Intègre la revue d'expert. Les changements majeurs par rapport à la v1 sont signalés par ⚠️ **Révision v2**.

---

## 1. Principe directeur

> Construire d'abord la plus petite version possible capable de démontrer que **8 joueurs peuvent jouer à Grand Colonies simultanément, comprendre ce qui se passe et rester engagés**.

Le premier succès du projet n'est **pas** « nous avons reproduit toutes les règles de Catan », mais « huit personnes ont terminé une partie numérique de Grand Colonies, et les cycles, le joueur associé, le commerce chronométré et la construction semi-simultanée fonctionnent ».

Toutes les décisions de périmètre se tranchent avec ce principe.

---

## 2. Contexte et risque principal

Le game design décrit une variante de Catan pour 8–12 joueurs dont les mécaniques centrales visent à éliminer le temps d'attente :

- partie organisée en **cycles** (phases A–E) au lieu de tours classiques ;
- **tours associés** : pendant le tour du joueur actif, le joueur situé 3 positions à sa gauche joue aussi (commerce banque, construction, achat de cartes) ;
- **fenêtre de commerce libre chronométrée** (30 s) à chaque cycle, ouverte à tous ;
- **construction semi-simultanée** : annonce possible hors tour, résolution par priorité (joueur actif > Influence > gel de l'emplacement) ;
- plateau XXL de 44–52 hexagones, multi-îles, avec **exploration** (hexagones face cachée) ;
- systèmes additionnels : or, poisson, Influence, contrats, chevaliers/barbares, marché dynamique, objectifs secrets, double voleur, victoire à 15 PV.

**Le risque n° 1 n'est pas technique, il est ludique** : personne n'a jamais joué à ce jeu, même sur table. Les mécaniques différenciantes (cycles, joueur associé, commerce chronométré, construction semi-simultanée) peuvent très bien ne pas fonctionner humainement. Tout le plan est organisé pour répondre à cette question le plus tôt et le moins cher possible.

⚠️ **Révision v2** — La v1 prévoyait de construire d'abord un « Catan classique complet » puis de l'étendre. C'était une erreur : cela repoussait très loin la validation des seules mécaniques réellement risquées, tout en produisant un livrable (un Catan à 4 joueurs) dont le projet n'a pas besoin. Le noyau moteur ne construit désormais que ce qui sert à Grand Colonies, et la première version jouable est une **vertical slice de Grand Colonies**, pas un clone de Catan.

---

## 3. Analyse des projets open source (inchangée)

### 3.1 Candidats évalués

| Projet | Stack / Licence | Joueurs | Verdict |
|---|---|---|---|
| [catanatron](https://github.com/bcollazo/catanatron) | Python, GPL-3.0, très actif | 4 | Excellente **référence d'architecture et d'analyse**. Voir §8 : ne pas en faire un fork. |
| [JSettlers2](https://github.com/jdmonin/JSettlers2) | Java Swing, GPLv3, mature | 4–6 | Meilleure **référence de règles** (scénarios Seafarers, brouillard, bots). Client desktop vieillissant : à lire, pas à forker. |
| [Viral-Doshi/catan](https://github.com/Viral-Doshi/catan) | React + Socket.io | 2–6 | Bonne **référence UI/réseau** web ; moteur trop simple. |
| [Pioneers](https://alternativeto.net/software/pioneers/) | C / GTK | ~6 | Trop ancien, écosystème inadapté. |

### 3.2 Décision

**Ne pas forker un clone existant.** Les hypothèses « 4 joueurs, tour par tour, plateau standard » sont câblées partout dans leur code ; les étendre coûterait plus cher qu'une réécriture. Ces projets servent de références de conception, pas de base de code.

**Stack retenue** : monorepo TypeScript, moteur de règles pur, WebSocket pour le temps réel, React + SVG pour le client.

> ⚠️ **Révision du 2026-08-27 — Colyseus écarté.** Le plan le retenait pour ses salles, sa synchronisation d'état et sa reconnexion. À l'usage, aucune des trois n'a tenu.
>
> Sa **synchronisation d'état a été contournée délibérément** : elle diffuse à tout le monde, ce qui aurait obligé à filtrer champ par champ les mains et les objectifs secrets — une seule erreur de filtrage suffisant à révéler une main. La **reconnexion par jeton** a dû être écrite de toute façon. Ne restaient que les salles et le transport.
>
> Le choix a été tranché par un blocage matériel : **la version 0.16 ne s'installe pas** (une dépendance `workspace:` a été publiée par erreur) et **la 0.18 n'a pas de client JavaScript**, celui-ci s'arrêtant à 0.16. Aucune version n'offrait les deux bouts.
>
> Le serveur tourne donc sur `ws`, en une centaine de lignes qui ne font que transporter. Toute la logique vit dans `GameSession`, testable sans réseau.

---

## 4. Architecture

### 4.1 Structure du monorepo

```text
grand-colonies/
│
├── packages/
│   ├── engine/      règles pures, état autoritaire, RNG déterministe
│   ├── protocol/    commandes réseau, vues publiques/privées, types partagés
│   ├── server/      Colyseus : rooms, lobby, timers, sessions, persistance
│   ├── client/      React, rendu plateau SVG, commerce, journal, timers
│   ├── sim/         bots, simulations, métriques d'équilibrage
│   └── testkit/     builders de scénarios, fixtures, helpers, replay
│
└── apps/
    └── host/        application lancée sur le PC hôte
```

⚠️ **Révision v2** — Ajout des packages `protocol` (contrat client/serveur explicite) et `testkit` (scénarios de test réutilisables entre `engine`, `server` et `sim`).

### 4.2 Règle d'or

**Colyseus ne contient aucune règle du jeu.** Le moteur doit pouvoir exécuter une partie complète sans navigateur, sans WebSocket et sans serveur.

```text
Client
   │  Commande
   ▼
Serveur (file ordonnée)
   │
   ▼
validate(command, state)
   │
   ▼
resolve(command, state)
   │
   ├──> événements de domaine
   └──> nouvel état
            ├──> vue publique
            └──> vue privée du joueur
```

### 4.3 Déploiement LAN

```text
PC hôte : serveur Node (Colyseus) + fichiers statiques du client
Joueurs : navigateur → http://<ip-locale>:<port>
```

Pas d'authentification, pas d'hébergement, pas de scaling. En contrepartie, il faut soigner la **reconnexion** et l'**ergonomie de mise en place** (voir §11).

---

## 5. Décisions techniques structurantes

Ces sept décisions sont peu coûteuses si elles sont prises dès le premier jour, et très coûteuses à rattraper ensuite. Elles constituent l'apport principal de la revue d'expert.

### 5.1 Déterminisme obligatoire

Même état initial + même seed + même séquence de commandes ⇒ **exactement le même résultat**.

`Math.random()` est interdit dans les règles ; tout passe par un RNG seedé (`game.random.next()`). Le seed est enregistré avec la partie. Cela donne gratuitement : reproduction des bugs, replay, tests déterministes, simulation, comparaison de versions du moteur.

### 5.2 Journal d'actions et replay

Toute commande validée est journalisée (`GameStarted`, `DiceRolled`, `ResourcesProduced`, `TradeCreated`, `TradeAccepted`, `BuildDeclared`, `BuildResolved`, `RobberMoved`, `PhaseEnded`…).

Conserver au minimum : `gameId`, `seed`, `initialConfig`, `orderedCommands`, timestamps serveur. Snapshots périodiques optionnels. L'état d'une partie doit être reconstructible à partir de la configuration initiale + le seed + la liste ordonnée de commandes.

### 5.3 Aucune concurrence réelle sur l'état

Les joueurs envoient des commandes simultanément **du point de vue UX**, mais le serveur les traite dans une **file ordonnée**, en résolution séquentielle et déterministe. Le moteur ne modifie jamais le même état depuis plusieurs callbacks concurrents. Toutes les règles de priorité sont exprimées explicitement dans le moteur, donc testables.

### 5.4 `BuildIntent` : la construction semi-simultanée

Une annonce de construction ne crée **pas** immédiatement un bâtiment.

```text
BuildIntent
- id, playerId, location, buildingType
- reservedCost, cycleId, phaseId
- createdAtOrder, status
```

```text
ressources disponibles → ressources réservées → création du BuildIntent
```

Les ressources réservées ne peuvent plus servir à un échange ni à une autre construction. Résolution d'un conflit : joueur actif > Influence > autre règle de priorité > **emplacement gelé**. Les joueurs dont la construction échoue récupèrent leurs ressources réservées.

C'est la traduction technique du §8 du game design, qui restait ambigu sur le moment exact où les ressources sont dépensées.

### 5.5 Système de capacités

Plutôt que disperser des dizaines de `if (phase === …)` dans le serveur et le client :

```text
getCapabilities(state, playerId)
→ CAN_ROLL_DICE, CAN_TRADE_BANK, CAN_TRADE_PLAYER, CAN_BUILD,
  CAN_DECLARE_BUILD, CAN_BUY_DEV_CARD, CAN_MOVE_ROBBER,
  CAN_END_ACTION, CAN_END_PHASE
```

Les rôles (actif / associé / passif) se traduisent en capacités :

```text
joueur actif    → CAN_BUILD, CAN_TRADE_BANK, CAN_TRADE_PLAYER
joueur associé  → CAN_BUILD, CAN_TRADE_BANK
autres joueurs  → éventuellement CAN_DECLARE_BUILD
```

Le client s'en sert pour l'UX (griser les boutons), le serveur reste toujours autoritaire.

### 5.6 Information cachée

Trois représentations distinctes :

- `AuthoritativeGameState` — tout : mains, objectifs secrets, tuiles non explorées ;
- `PublicGameView` — uniquement ce que tous peuvent savoir ;
- `PrivatePlayerView` — la main du joueur, ses objectifs, ses choix cachés.

Ne jamais envoyer une donnée secrète au navigateur adverse en comptant sur React pour ne pas l'afficher. Le secret est assuré côté serveur. C'est structurant pour l'exploration (tuiles face cachée) et les objectifs secrets.

### 5.7 Idempotence et identité de session

Chaque commande porte `actionId`, `playerId`, `type`, `payload`. L'`actionId` permet de détecter un doublon : un joueur qui clique deux fois parce que le réseau rame ne doit pas déclencher deux actions.

Pas de comptes utilisateurs, mais une identité de session persistante (`seatId`, `sessionToken`, `playerName`, `playerColor`), le token stocké dans le navigateur. Un F5 ou une coupure réseau ⇒ le joueur retrouve son siège. Prévoir une commande hôte pour réattribuer manuellement un siège.

---

## 6. Roadmap

⚠️ **Révision v2** — La numérotation a été refondue. La simulation et l'instrumentation des playtests, que la v1 plaçait en phases tardives, deviennent **transversales** : elles démarrent dès que le moteur tourne et ne s'arrêtent plus. La revue d'expert les listait encore comme « Phase 7 » et « Phase 8 » tout en demandant qu'elles soient continues — la contradiction est levée ici.

De même, la revue plaçait le « Client web » (sa Phase 5) **après** la vertical slice (sa Phase 2) alors que celle-ci exige de faire jouer 8 humains, donc une interface. La vertical slice inclut désormais explicitement un **client rudimentaire et laid**, et la phase client ultérieure porte sur le client *soigné*.

### Phase 0 — Cadrage (quelques jours)

- Nom du projet sans la marque « CATAN » (déposée) : **Grand Colonies**. Aucun asset officiel réutilisé, mention fan-made.
- Licence : si du code GPL (catanatron, JSettlers2) est copié, le projet devient GPL. Recommandation : s'en servir uniquement comme référence de conception pour rester libre du choix de licence.
- Monorepo TypeScript (pnpm workspaces), CI de tests, conventions de code.

### Phase 1 — Validation du game design (papier / hybride)

**Sans écrire de code de jeu.** Prototype papier, hybride ou rudimentaire, avec de vraies personnes.

Tester en priorité : cycle A–E, joueur actif, joueur associé, commerce libre de 30 s, annonces de construction hors tour, conflits de construction, fréquence à laquelle chaque joueur peut agir, compréhension des priorités, durée ressentie entre deux actions. Ne pas tester les systèmes secondaires.

**Livrable : le Rules Contract v1** (voir §7). Aucune mécanique concurrente ne doit être codée tant que sa règle exacte n'est pas écrite.

### Phase 2 — Spike réseau 12 joueurs (jetable)

Application Colyseus minimale et **destinée à être jetée**. Elle teste l'infrastructure, rien d'autre : connexion de 12 navigateurs, 12 sièges, pseudo et couleur, état public, données privées différenciées, timer serveur, perte de connexion, reconnexion, F5, spam de commandes, doublons.

**Critères de sortie**

```text
✓ 12 clients restent connectés
✓ un joueur peut rafraîchir sans perdre son siège
✓ un joueur reconnecté retrouve son état
✓ une information privée n'est jamais envoyée aux autres clients
✓ les timers sont autoritaires côté serveur
✓ des commandes quasi simultanées sont traitées proprement
```

### Phase 3 — Noyau moteur

Moteur pur, sans réseau ni UI, testé unitairement. **Uniquement ce qui sert à Grand Colonies** — un Catan classique complet n'est pas un livrable.

**Géométrie** — `Hex`, `Vertex`, `Edge`, `Route`, `MaritimeRoute`, `Building`, `Port`, `Island`, `Board`. Le plateau est un **graphe explicite** ; les règles de placement ne dépendent jamais du rendu. Référence : [Red Blob Games](https://www.redblobgames.com/grids/hexagons/), lib possible [honeycomb](https://github.com/flauwekeul/honeycomb).

**Économie** — `ResourceType`, `ResourceBank`, `PlayerInventory`, `Production`, `Trade`, `ConstructionCost`.

**Infrastructure** — `GameState`, `GameConfig`, `GameCommand`, `DomainEvent`, `CommandValidator`, `CommandResolver`, `SeededRandom`.

**Règles de base** — dés, production, distribution, routes, colonies, villes, placement et distance, ports, commerce banque, voleur, points de victoire, plus longue route (le calcul de graphe le plus délicat).

**Critères de sortie**

```text
✓ aucune action illégale acceptée dans les scénarios testés
✓ même seed + mêmes commandes = même résultat
✓ replay complet possible
✓ plus longue route testée sur cas pathologiques
✓ invariants économiques vérifiés
✓ aucune dépendance réseau dans engine
```

### Phase 4 — Vertical slice Grand Colonies (le jalon décisif)

Première vraie version numérique, volontairement réduite et **volontairement laide**.

**Inclus** : 8 joueurs (architecture compatible 12), carte fixe, 5 ressources classiques, dés, production, routes, colonies, villes, cycles A–E, joueur actif, joueur associé, commerce, fenêtre chronométrée, construction semi-simultanée, condition de victoire simplifiée, **client rudimentaire**, **panneau maître de jeu** (§12), **premiers bots**.

**Exclus temporairement** : exploration, or, ports spéciaux, objectifs secrets, double voleur, marché dynamique, contrats, barbares, chevaliers, Influence avancée, villes spécialisées, événements, équipes.

Cette phase répond à **une seule question** : *Grand Colonies est-il amusant et fluide à plusieurs ?* Si la réponse est non, corriger le rythme avant d'ajouter quoi que ce soit.

**Critères de sortie**

```text
✓ 8 humains terminent une partie
✓ règles comprises sans intervention permanente du développeur
✓ aucun joueur ne reste passif trop longtemps
✓ commerce réalisable dans la fenêtre prévue
✓ construction concurrente comprise par les joueurs
```

### Phase 5 — Serveur robuste

Consolidation après validation : chaque interaction devient une commande explicite (`ROLL_DICE`, `BUILD_ROAD`, `BUILD_SETTLEMENT`, `BUILD_CITY`, `DECLARE_BUILD`, `CANCEL_BUILD`, `CREATE_TRADE`, `CANCEL_TRADE`, `ACCEPT_TRADE`, `MOVE_ROBBER`, `END_ACTION`, `END_PHASE`), avec idempotence par `actionId`, capacités centralisées, sessions et reconnexion complètes, sauvegarde/restauration.

### Phase 6 — Client web soigné et UX du commerce

Voir §9 et §10.

### Phase 7 — Ruleset Grand Colonies v1

Ajout progressif, dans cet ordre :

1. passage de 8 à 12 joueurs ;
2. plateau XXL ;
3. multi-îles ;
4. routes maritimes ;
5. exploration ;
6. or ;
7. ports spéciaux ;
8. règle 2/12 ;
9. limite de main dynamique ;
10. double voleur ;
11. objectifs secrets ;
12. victoire à 15 PV.

Tout ce qui peut l'être devient configurable, pour tester des variantes sans toucher au code :

```text
GameConfig
├─ minPlayers / maxPlayers
├─ victoryPoints
├─ activeTurnDuration
├─ associatedTurnDuration
├─ tradingWindowDuration
├─ handLimit
├─ robberCount
├─ doubledNumbers
├─ explorationEnabled
├─ goldEnabled
├─ secretObjectivesEnabled
└─ mapPreset
```

### Phase 8 — Robustesse LAN

Voir §11.

### Phase 9 — Modules avancés

Chevaliers / barbares → Influence → contrats / marché → villes spécialisées. Chaque module passe par le même cycle : règle écrite, moteur, simulation, playtest.

### Phase 10 — Direction artistique (optionnelle)

Uniquement une fois le jeu validé : tant que les règles bougent, l'art détaillé serait jeté.

### Vue d'ensemble

```text
Cadrage
   ↓
Validation papier / hybride  →  Rules Contract v1
   ↓
Spike réseau 12 joueurs
   ↓
Noyau moteur ─────────────────┐
   ↓                          │
Vertical slice 8 joueurs      │  simulation continue
   ↓                          │  (dès que le moteur tourne)
Premier playtest numérique ───┤
   ↓                          │  playtests instrumentés
Serveur robuste               │  (dès la vertical slice)
   ↓                          │
Client soigné + UX commerce   │
   ↓                          │
Ruleset v1 (8 → 12, XXL, …) ──┘
   ↓
Robustesse LAN
   ↓
Modules avancés
   ↓
Direction artistique
```

---

## 7. Rules Contract v1 — livrable de la Phase 1

Le game design décrit les intentions, pas les cas limites. Ces questions doivent être tranchées **par écrit** avant tout code concurrent :

```text
Qui peut effectuer quelles actions, pendant quelles phases ?

Une action commencée avant la fin du timer peut-elle se terminer après 0 ?
Que se passe-t-il exactement lorsque le timer atteint 0 ?

Quand les ressources d'une construction sont-elles réservées ?
Quand sont-elles réellement dépensées ?

Comment deux annonces concurrentes sont-elles départagées ?
Que signifie précisément « emplacement gelé » ? Quand le gel prend-il fin ?

Que se passe-t-il si le joueur actif se déconnecte ?
Et le joueur associé ?
Que fait le serveur lorsqu'un joueur dépasse son timeout ?

Quand la victoire est-elle vérifiée ?
Peut-elle être déclenchée pendant une phase simultanée ?
Que se passe-t-il si plusieurs joueurs atteignent le seuil dans le même cycle ?
```

---

## 8. Simulation continue (transversale, dès la Phase 3)

⚠️ **Révision v2** — La v1 recommandait un éventuel fork de catanatron pour l'équilibrage. **À ne pas faire** : cela produirait deux implémentations des mêmes règles, qui divergeraient immédiatement. Les bots tournent directement sur le moteur TypeScript. Catanatron reste une référence d'architecture et d'analyse.

```text
              engine
                ▲
        ┌───────┴────────┐
      server            sim
                          │
              RandomBot / GreedyBot / ExpansionBot / BalancedBot
```

Les bots n'ont pas besoin d'être intelligents. Objectifs : détecter des règles cassées et des blocages, mesurer la durée, comparer les configurations, détecter l'avantage du premier joueur et le snowball, mesurer la valeur des ressources, comparer 8 / 10 / 12 joueurs sur des centaines ou milliers de parties.

**Métriques enregistrées** : nombre de cycles et de tours, PV finaux et PV par cycle, production par ressource, ressources gagnées et dépensées par joueur, nombre de trades et taux d'acceptation, constructions et routes par joueur, nombre de conflits de construction, fréquence des nombres, durée théorique, position du gagnant, écart gagnant / dernier.

---

## 9. Client web

⚠️ **Révision v2** — Commencer en **SVG**, ne passer à PixiJS que si un problème de performance est réellement mesuré. La v1 hésitait entre les deux ; 50–60 hexagones et quelques centaines d'arêtes restent très raisonnables en SVG, qui apporte gratuitement le DOM, les clics, le CSS, le zoom, le pan, l'accessibilité et l'inspection.

```text
┌───────────────────────────────────────────────┐
│ Phase | Actif | Associé | Timer               │
├───────────┬───────────────────────┬───────────┤
│ joueurs   │                       │ activité  │
│           │       PLATEAU         │ / trades  │
│           │                       │           │
├───────────┴───────────────────────┴───────────┤
│ main / constructions / actions rapides        │
└───────────────────────────────────────────────┘
```

Affichage permanent : phase actuelle, joueur actif, joueur associé, timer, action attendue, état de la fenêtre commerciale.

**Affichage des 12 joueurs** — ⚠️ **Révision v2** : ne pas dépendre du survol (le jeu peut être utilisé sur portable, tablette ou téléphone). Chaque adversaire est consultable au **clic / tap**, le survol n'étant qu'un bonus. Affichage permanent limité à : pseudo, couleur, PV publics, nombre de cartes, Influence publique, statut actif/associé, état de connexion. Distinguer les 12 joueurs par **couleur + forme + motif + icône**, pour rester lisible en cas de daltonisme.

**Assets** — besoin faible : ~9 types de tuiles, pièces géométriques en 12 couleurs, jetons, cartes typographiques. Tout est réalisable en SVG programmatique, style flat, avec [game-icons.net](https://game-icons.net) (CC BY 4.0) et, si besoin plus tard, les packs CC0 de [Kenney](https://kenney.nl/assets).

---

## 10. UX du commerce (sous-projet à part entière)

Les joueurs étant dans la même pièce, **la négociation reste orale**. L'interface ne sert qu'à confirmer vite.

```text
Je donne : [bois] [bois]     Le destinataire voit :
Je veux  : [minerai]              2 bois ↔ 1 minerai
À        : [Julie]
                                  [ACCEPTER]  [REFUSER]
[PROPOSER]
```

L'acceptation doit être **atomique côté serveur** : vérifier l'inventaire de A, celui de B, la phase et la validité de l'offre, puis effectuer les deux transferts. Si l'inventaire de l'un a changé entre-temps, l'offre devient invalide.

---

## 11. Robustesse LAN (Phase 8)

Écran de l'hôte :

```text
Grand Colonies

Adresse LAN : 192.168.1.42:3000

[ QR CODE ]

Code partie : ORANGE-7
```

Fonctionnalités : détection de l'adresse LAN, QR code, reconnexion, pause / reprise, sauvegarde / restauration, réattribution de siège, prolongation manuelle d'un timer, remplacement d'un joueur, bascule d'un joueur en bot.

---

## 12. Mode maître de jeu / debug (dès la Phase 4)

Panneau réservé à l'hôte : donner ou retirer des ressources, forcer un lancer de dés, changer de phase, modifier le timer, ajouter des PV, révéler une tuile, placer ou supprimer une construction, forcer un trade, téléporter le voleur, terminer la partie.

Destiné au développement et aux playtests : il évite de jouer 45 minutes pour atteindre la situation que l'on veut tester.

---

## 13. Playtests instrumentés (transversal, dès la Phase 4)

Chaque partie LAN produit automatiquement des métriques : temps total, par cycle, par phase ; temps passé en commerce ; **temps d'inactivité par joueur** ; trades proposés / acceptés / expirés ; constructions conflictuelles ; actions invalides ; timeouts ; ressources et PV par joueur et par cycle ; temps passé en tête ; déconnexions.

Puis un questionnaire joueur : ai-je eu l'impression de jouer régulièrement ? ai-je attendu trop longtemps ? le commerce était-il compréhensible ? le timer était-il stressant ? le rôle du joueur associé était-il clair ? les conflits de construction étaient-ils compréhensibles ? le plateau était-il lisible ? avais-je assez d'informations sur les autres ?

L'intérêt est de **confronter les impressions subjectives aux données réelles** — et cela instrumente directement les 5 critères du §40 du game design.

---

## 14. Hors priorité

Ne pas investir avant validation de la vertical slice : illustrations finales, animations complexes, effets visuels, IA avancée, matchmaking internet, comptes utilisateurs, cloud, classements, spectateurs, mobile natif, fork catanatron, marché dynamique, contrats, villes spécialisées, événements, équipes.

---

## 15. Risques

| Risque | Impact | Mitigation |
|---|---|---|
| Les mécaniques simultanées ne fonctionnent pas humainement | Critique | Prototype papier (Phase 1) et vertical slice (Phase 4) très tôt |
| Trop de règles développées avant validation | Critique | MVP minimal Grand Colonies, périmètre gelé par le §1 |
| **Budget d'actions par joueur insuffisant** (voir §16) | Critique | Simulation dédiée dès la Phase 3, avant la vertical slice |
| Bugs de concurrence | Élevé | Commandes sérialisées côté serveur |
| Divergence client / serveur | Élevé | Serveur autoritaire, client jamais décisionnaire |
| Fuite d'informations secrètes | Élevé | `PublicGameView` / `PrivatePlayerView` |
| Reconnexion fragile | Élevé | Token de siège persistant |
| Bugs impossibles à reproduire | Élevé | RNG seedé + journal d'actions + replay |
| Scope trop large | Élevé | Ajout progressif des modules |
| UX illisible à 12 | Élevé | Prototype d'écran 12 joueurs tôt |
| Mauvais équilibrage | Moyen/élevé | Simulation continue + métriques |
| Difficulté d'usage LAN | Moyen | QR code + écran hôte + reconnexion |
| Marque CATAN | Faible (LAN privé) | Nom original, aucun asset officiel, mention fan-made |

---

## 16. Point ouvert prioritaire : le budget d'actions par joueur

Un calcul que ni la v1 ni la revue d'expert n'abordent, et qui conditionne l'équilibrage général.

**Le calcul.** À 12 joueurs, un cycle dure environ 90 s (tour actif) + 30 s (commerce) ≈ 2 min. Un tour de table complet ≈ **24 minutes**. La durée cible du §2 du game design (120–160 min) laisse donc **5 à 6 tours de table**, soit **5 à 6 tours actifs par joueur** pour atteindre 15 PV.

**La conséquence.** Le nombre de lancers de dés, lui, reste comparable à un Catan classique (60–72 cycles ≈ autant de lancers), et chaque joueur produit sur *tous* les lancers. Autrement dit :

```text
revenu par joueur          ≈ Catan classique
opportunités de dépense    ÷ 3
```

Les tours associés compensent partiellement (5–6 tours actifs + 5–6 tours associés ≈ 10–12 opportunités contre 15–20 en Catan classique), et c'est précisément la fonction de la construction semi-simultanée. Mais deux effets sont à surveiller :

1. **Saturation des mains** : avec un revenu normal et trois fois moins d'occasions de dépenser, la limite de main (§24) est atteinte en permanence, et chaque 7 (≈ 10 à 12 fois par partie, chacun impliquant 12 joueurs) devient un pic de défausse et de temps mort — exactement ce que le jeu cherche à éliminer.
2. **Seuil de victoire** : 15 PV en 10–12 opportunités d'action est probablement hors de portée, ce qui allongerait la partie bien au-delà de la cible.

**Les leviers**, à arbitrer par simulation avant la vertical slice : durée du tour actif, seuil de PV, **nombre de joueurs associés** (deux au lieu d'un à 11–12 joueurs ?), périmètre de ce qui est constructible hors tour, limite de main.

**Action** : c'est la première question que la simulation (§8) doit traiter, avant même l'équilibrage des ressources.

---

## 17. Autres questions à trancher

1. **Poisson** — le game design (§5) l'introduit mais ne lui donne pas de rôle structurant. Le supprimer purement et simplement ?
2. **Contrats** (§19) — leur seule sanction est une perte de 2 Influence. Sans exécution automatique, ils reposent entièrement sur le social ; est-ce que le numérique doit les modéliser, ou les laisser hors du système ?
3. **Marché dynamique** (§10) — mécanique la plus coûteuse à implémenter pour un gain de gameplay non démontré. Candidat naturel à l'abandon si la Phase 1 ne le réclame pas.
4. **Mode équipes** (§30) — potentiellement le meilleur remède au problème du §16 (deux équipes de 6 = deux fois plus d'agents actifs par unité de temps). À évaluer sérieusement plutôt qu'à traiter comme une variante secondaire.

---

*v2 — 2026-08-26. Sources : [catanatron](https://github.com/bcollazo/catanatron) · [docs.catanatron.com](https://docs.catanatron.com/) · [JSettlers2](https://github.com/jdmonin/JSettlers2) · [Viral-Doshi/catan](https://github.com/Viral-Doshi/catan) · [Colyseus](https://colyseus.io/) · [game-icons.net](https://game-icons.net) · [Kenney](https://kenney.nl/assets) · [Red Blob Games — hexagons](https://www.redblobgames.com/grids/hexagons/)*
