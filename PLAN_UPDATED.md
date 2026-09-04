Plan d’adaptation — Grandes Colonies

Objectif

Réviser le plan de développement actuel de Grandes Colonies, jeu numérique inspiré de Catan pour 8–12 joueurs en LAN, sans changer la stack principale :

• TypeScript
• React
• Colyseus
• monorepo
• moteur de règles pur et indépendant du réseau

L’objectif principal de cette adaptation est de réduire le risque projet en validant le plus tôt possible les mécaniques réellement différenciantes de Grandes Colonies :

• cycles A–E ;
• joueur actif + joueur associé ;
• commerce libre chronométré ;
• construction semi-simultanée ;
• 8–12 joueurs ;
• faible temps d’attente.

Le MVP ne doit donc pas être « Catan classique numérique », mais une version minimale, peu esthétique mais jouable de Grandes Colonies, capable de démontrer que plusieurs joueurs peuvent agir régulièrement sans temps mort excessif.

────────

1. Principes d’architecture à conserver

Conserver l’architecture générale suivante :

text
grandes-colonies/
│
├── packages/
│   ├── engine/
│   ├── protocol/
│   ├── server/
│   ├── client/
│   ├── sim/
│   └── testkit/
│
└── apps/
    └── host/

Rôle des packages :

text
packages/engine
    règles pures
    état autoritaire
    validation des actions
    résolution des règles
    RNG déterministe
    événements du domaine

packages/protocol
    commandes réseau
    vues publiques
    vues privées
    types partagés client/serveur

packages/server
    Colyseus
    rooms
    lobby
    reconnexion
    timers
    sessions
    sauvegardes

packages/client
    React
    interface joueur
    rendu plateau
    commerce
    journal
    timers

packages/sim
    bots
    simulations
    métriques d’équilibrage

packages/testkit
    builders de scénarios
    fixtures
    helpers de tests
    replay de parties

Principe fondamental :

text
Client
   │
   │ Commande
   ▼
Serveur
   │
   ▼
validate(command, state)
   │
   ▼
resolve(command, state)
   │
   ├──> événements
   │
   └──> nouvel état
            │
            ├──> vue publique
            └──> vue privée du joueur

Colyseus ne doit pas contenir les règles du jeu.

Le moteur doit pouvoir exécuter une partie complète sans navigateur, WebSocket ni serveur Colyseus.

────────

2. Modèle de concurrence

Ne pas implémenter de véritables écritures concurrentes sur l’état du jeu.

Les joueurs peuvent envoyer des commandes simultanément du point de vue UX, mais le serveur doit les traiter dans une file ordonnée.

Exemple :

text
Joueur A → DECLARE_BUILD
Joueur B → DECLARE_BUILD
Joueur C → ACCEPT_TRADE

              ↓

       file de commandes

              ↓

résolution serveur séquentielle
et déterministe

Le moteur ne modifie donc jamais le même état depuis plusieurs threads ou callbacks concurrents.

Toutes les règles de priorité doivent être exprimées explicitement dans le moteur.

────────

3. Construction semi-simultanée

Ne pas transformer immédiatement une annonce de construction en bâtiment.

Créer une notion de :

text
BuildIntent

Exemple de structure conceptuelle :

text
BuildIntent
- id
- playerId
- location
- buildingType
- reservedCost
- cycleId
- phaseId
- createdAtOrder
- status

Lorsqu’un joueur annonce une construction :

text
ressources disponibles
        ↓
ressources réservées
        ↓
création du BuildIntent

Les ressources réservées ne peuvent plus être utilisées pour un échange ou une autre construction.

Lors de la résolution d’un conflit :

text
1. priorité au joueur actif
2. priorité selon Influence si applicable
3. autre règle de priorité éventuelle
4. égalité restante → emplacement gelé

Les joueurs dont la construction échoue récupèrent leurs ressources réservées.

Toutes les règles concernant les conflits doivent être déterministes et testables.

────────

4. Phase 0A — Validation du game design

Avant de construire le jeu complet, réaliser un prototype minimal permettant de tester les mécaniques les plus risquées.

Le prototype peut être papier, hybride ou extrêmement rudimentaire.

Tester en priorité :

• cycle A–E ;
• joueur actif ;
• joueur associé ;
• commerce libre pendant 30 secondes ;
• annonces de construction hors tour ;
• conflits de construction ;
• fréquence à laquelle chaque joueur peut agir ;
• compréhension des priorités ;
• durée ressentie entre deux actions.

Ne pas tester tous les systèmes secondaires à ce stade.

Livrable

Créer un Rules Contract v1 répondant explicitement aux questions suivantes :

text
Qui peut effectuer quelles actions ?

Pendant quelles phases ?

Une action commencée avant la fin du timer peut-elle se terminer après 0 ?

Que se passe-t-il exactement lorsque le timer atteint 0 ?

Quand les ressources d’une construction sont-elles dépensées ?

Quand sont-elles réservées ?

Comment deux annonces concurrentes sont-elles départagées ?

Que signifie précisément « emplacement gelé » ?

Quand le gel prend-il fin ?

Que se passe-t-il si un joueur actif se déconnecte ?

Que se passe-t-il si un joueur associé se déconnecte ?

Que fait le serveur lorsqu’un joueur dépasse son timeout ?

Quand la victoire est-elle vérifiée ?

Une victoire peut-elle être déclenchée pendant une phase simultanée ?

Que se passe-t-il si plusieurs joueurs atteignent le seuil de victoire dans le même cycle ?

Aucune mécanique concurrente ne doit être codée tant que sa règle exacte n’est pas définie.

────────

5. Phase 0B — Spike technique réseau

Créer une application Colyseus minimale et jetable.

Elle doit tester uniquement l’infrastructure réseau.

Fonctionnalités :

• connexion de 12 navigateurs ;
• attribution de 12 sièges ;
• pseudo et couleur ;
• état public ;
• données privées différentes selon le joueur ;
• timer serveur ;
• perte de connexion ;
• reconnexion ;
• rafraîchissement navigateur ;
• spam de commandes simultanées ;
• détection des commandes dupliquées.

Critères de sortie

text
✓ 12 clients peuvent rester connectés

✓ un joueur peut rafraîchir son navigateur
  sans perdre son siège

✓ un joueur reconnecté retrouve son état

✓ une information privée n’est jamais
  envoyée aux autres clients

✓ les timers sont autoritaires côté serveur

✓ plusieurs commandes envoyées quasi
  simultanément sont traitées proprement

────────

6. Phase 1 — Noyau du moteur

Remplacer la phase « Catan classique complet » par la création d’un noyau générique nécessaire à Grandes Colonies.

Le but n’est pas de produire un clone complet de Catan à 4 joueurs.

Le but est de produire un moteur robuste et réutilisable.

Géométrie

Implémenter :

text
Hex
Vertex
Edge
Route
MaritimeRoute
Building
Port
Island
Board

Le plateau doit être représenté comme un graphe explicite.

Les règles de placement ne doivent pas dépendre du rendu graphique.

Économie

Implémenter :

text
ResourceType
ResourceBank
PlayerInventory
Production
Trade
ConstructionCost

Infrastructure moteur

Créer :

text
GameState
GameConfig
GameCommand
DomainEvent
CommandValidator
CommandResolver
SeededRandom

Règles de base

Implémenter uniquement les règles nécessaires au futur Grandes Colonies :

• lancer de dés ;
• production ;
• distribution des ressources ;
• routes ;
• colonies ;
• villes ;
• placement ;
• distance entre colonies ;
• ports ;
• commerce banque ;
• voleur ;
• points de victoire ;
• plus longue route.

Les règles classiques servent de référence et de tests, mais une application complète « Catan classique » n’est pas un livrable obligatoire.

────────

7. Déterminisme obligatoire

Le moteur doit être entièrement déterministe.

Exigence :

Avec le même état initial, le même seed et la même séquence de commandes, le moteur doit toujours produire exactement le même résultat.


Ne jamais utiliser directement :

Math.random()

dans les règles.

Utiliser un générateur pseudo-aléatoire contrôlé :

game.random.next()

Le seed doit être enregistré avec la partie.

Cela permet :

• reproduction des bugs ;
• replay ;
• simulation ;
• tests déterministes ;
• comparaison de versions du moteur.

────────

8. Journal d’actions et replay

Toutes les commandes validées doivent pouvoir être journalisées.

Exemple :

text
GameStarted
DiceRolled
ResourcesProduced
TradeCreated
TradeAccepted
BuildDeclared
BuildResolved
RobberMoved
PhaseEnded

Conserver au minimum :

text
gameId
seed
initialConfig
orderedCommands
timestamps serveur

Optionnellement, ajouter des snapshots périodiques :

text
snapshot après N commandes

Le replay doit pouvoir reconstruire l’état d’une partie à partir :

text
configuration initiale
+
seed
+
liste ordonnée de commandes

────────

9. Phase 2 — Vertical slice Grandes Colonies

Créer très tôt une première vraie version numérique de Grandes Colonies.

Cette version doit être volontairement réduite.

Inclus

• 8 joueurs ;
• architecture compatible 12 ;
• carte fixe ;
• ressources classiques ;
• lancer de dés ;
• production ;
• routes ;
• colonies ;
• villes ;
• cycles ;
• joueur actif ;
• joueur associé ;
• commerce ;
• fenêtre commerciale chronométrée ;
• construction semi-simultanée ;
• condition de victoire simplifiée.

Exclus temporairement

text
exploration
or
ports spéciaux
objectifs secrets
double voleur
marché dynamique
contrats
barbares
chevaliers avancés
Influence avancée
villes spécialisées
événements
équipes

Cette phase doit répondre à une seule question :

Est-ce que Grandes Colonies est amusant et fluide avec plusieurs joueurs ?


Si cette version ne fonctionne pas, ne pas ajouter de nouveaux systèmes avant d’avoir corrigé le rythme de jeu.

────────

10. Phase 3 — Serveur Grandes Colonies robuste

Une fois la vertical slice validée, consolider le serveur.

Chaque interaction joueur doit devenir une commande explicite.

Exemples :

text
ROLL_DICE
BUILD_ROAD
BUILD_SETTLEMENT
BUILD_CITY
DECLARE_BUILD
CANCEL_BUILD
CREATE_TRADE
CANCEL_TRADE
ACCEPT_TRADE
MOVE_ROBBER
END_ACTION
END_PHASE

Chaque commande doit avoir au minimum :

text
actionId
playerId
type
payload

actionId doit permettre de détecter une commande reçue deux fois.

Cas typique :

text
joueur clique
↓
réseau ralentit
↓
joueur clique à nouveau
↓
serveur reçoit deux commandes

Le serveur doit exécuter l’action une seule fois.

────────

11. Système de capacités

Éviter de disperser dans le serveur des dizaines de conditions de type :

if (phase === ...)

Créer un système centralisé :

text
getCapabilities(state, playerId)

Exemples de capacités :

text
CAN_ROLL_DICE
CAN_TRADE_BANK
CAN_TRADE_PLAYER
CAN_BUILD
CAN_DECLARE_BUILD
CAN_BUY_DEV_CARD
CAN_MOVE_ROBBER
CAN_END_ACTION
CAN_END_PHASE

Les rôles actif, associé ou joueur passif doivent être traduits en capacités.

Exemple :

text
joueur actif
→ CAN_BUILD
→ CAN_TRADE_BANK
→ CAN_TRADE_PLAYER

joueur associé
→ CAN_BUILD
→ CAN_TRADE_BANK

autres joueurs
→ éventuellement CAN_DECLARE_BUILD

Le client peut utiliser ces capacités pour l’UX, mais le serveur reste toujours autoritaire.

────────

12. Information cachée

Séparer explicitement :

text
AuthoritativeGameState
PublicGameView
PrivatePlayerView

AuthoritativeGameState

Contient tout :

• mains de tous les joueurs ;
• objectifs secrets ;
• tuiles non explorées ;
• informations privées ;
• états internes.

PublicGameView

Contient uniquement ce que tous les joueurs peuvent connaître.

PrivatePlayerView

Contient les informations spécifiques à un joueur :

• sa main ;
• ses objectifs ;
• ses choix cachés ;
• autres informations privées.

Ne jamais envoyer une donnée secrète au navigateur adverse en comptant uniquement sur React pour ne pas l’afficher.

Le secret doit être assuré côté serveur.

────────

13. Identité et reconnexion

Le jeu n’a pas besoin de comptes utilisateurs.

En revanche, chaque joueur doit avoir une identité de session persistante.

Exemple :

text
seatId
sessionToken
playerName
playerColor

Le token peut être stocké localement dans le navigateur.

Lors d’un rafraîchissement ou d’une reconnexion :

text
sessionToken
      ↓
serveur
      ↓
récupération du siège

Prévoir également une commande administrateur permettant à l’hôte de réattribuer manuellement un siège.

────────

14. Phase 4 — Grandes Colonies Ruleset v1

Une fois le rythme du jeu validé, ajouter progressivement le contenu du ruleset Grandes Colonies.

Ordre conseillé :

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

Rendre le maximum de paramètres configurables.

Exemple :

text
GameConfig
├─ minPlayers
├─ maxPlayers
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

Cela permet de tester rapidement différentes variantes sans modifier le code.

────────

15. Phase 5 — Client web

Commencer par un rendu SVG.

Ne passer à PixiJS que si un problème de performance réel est mesuré.

50–60 hexagones, quelques centaines d’arêtes et de pièces restent raisonnables pour SVG.

Avantages :

• DOM ;
• clics ;
• CSS ;
• zoom ;
• pan ;
• accessibilité ;
• inspection ;
• développement simple.

Structure générale de l’écran

text
┌───────────────────────────────────────────────┐
│ Phase | Actif | Associé | Timer               │
├───────────┬───────────────────────┬───────────┤
│ joueurs   │                       │ activité  │
│           │       PLATEAU         │ / trades  │
│           │                       │           │
├───────────┴───────────────────────┴───────────┤
│ main / constructions / actions rapides       │
└───────────────────────────────────────────────┘

L’interface doit afficher en permanence :

• phase actuelle ;
• joueur actif ;
• joueur associé ;
• timer ;
• action attendue ;
• état de la fenêtre commerciale.

────────

16. Affichage des 12 joueurs

Ne pas dépendre uniquement du survol.

Le jeu peut être utilisé sur ordinateur portable, tablette ou téléphone.

Chaque adversaire doit pouvoir être consulté par :

• clic ;
• tap ;
• survol en bonus.

Afficher en permanence uniquement les informations importantes :

text
pseudo
couleur
PV publics
nombre de cartes
Influence publique
statut actif / associé
connexion

Utiliser :

• couleur ;
• forme ;
• motif ;
• icône ;

afin que les 12 joueurs restent distinguables même en cas de daltonisme.

────────

17. Phase 6 — Commerce UX

Traiter le commerce comme un sous-projet UX important.

Puisque les joueurs sont dans la même pièce, la négociation peut rester principalement orale.

L’interface sert surtout à confirmer rapidement l’échange.

Exemple :

text
Je donne :

[bois] [bois]

Je veux :

[minerai]

À :

[Julie]

[PROPOSER]

Le destinataire voit :

text
2 bois ↔ 1 minerai

[ACCEPTER]

[REFUSER]

Une acceptation doit être atomique côté serveur :

text
vérifier inventaire A
+
vérifier inventaire B
+
vérifier phase
+
vérifier validité offre
+
effectuer les deux transferts

Si l’inventaire de l’un des joueurs a changé entre-temps, l’offre devient invalide.

────────

18. Phase 7 — Simulation continue

La simulation ne doit pas être une phase isolée située tard dans le projet.

Elle doit devenir disponible dès que le moteur fonctionne.

Architecture :

text
              engine
                ▲
                │
        ┌───────┴────────┐
        │                │
      server            sim
                          │
                    ┌─────┴─────┐
                    │           │
                RandomBot   GreedyBot
                                │
                           ExpansionBot

Les bots n’ont pas besoin d’être très intelligents.

Créer par exemple :

text
RandomBot
GreedyBot
ExpansionBot
BalancedBot

Objectifs de la simulation :

• détecter des règles cassées ;
• détecter les blocages ;
• mesurer la durée ;
• comparer les configurations ;
• détecter l’avantage du premier joueur ;
• détecter le snowball ;
• mesurer la valeur des ressources ;
• comparer 8, 10 et 12 joueurs.

Ne pas créer initialement un fork de catanatron pour Grandes Colonies.

Utiliser directement le moteur TypeScript afin d’éviter deux implémentations des mêmes règles.

Catanatron peut rester une référence d’architecture et d’analyse.

────────

19. Métriques de simulation

Enregistrer au minimum :

text
nombre de cycles
nombre de tours
PV finaux
PV par cycle
production par ressource
ressources gagnées par joueur
ressources dépensées
nombre de trades
taux d’acceptation des trades
constructions par joueur
routes par joueur
nombre de conflits de construction
fréquence des nombres
durée théorique
position du gagnant
écart gagnant / dernier

Comparer régulièrement :

text
8 joueurs
10 joueurs
12 joueurs

sur plusieurs centaines ou milliers de parties.

────────

20. Phase 8 — Playtests instrumentés

Chaque vraie partie LAN doit produire automatiquement des métriques.

Mesurer :

text
temps total
temps par cycle
temps par phase
temps passé en commerce
temps d’inactivité par joueur
nombre de trades proposés
nombre de trades acceptés
nombre de trades expirés
nombre de constructions conflictuelles
nombre d’actions invalides
nombre de timeouts
ressources par joueur et par cycle
PV par joueur et par cycle
temps passé en tête
nombre de déconnexions

Ajouter ensuite un questionnaire joueur.

Exemples :

text
Ai-je eu l’impression de jouer régulièrement ?

Ai-je attendu trop longtemps ?

Le commerce était-il compréhensible ?

Le timer était-il stressant ?

Le rôle du joueur associé était-il clair ?

Les conflits de construction étaient-ils compréhensibles ?

Le plateau était-il lisible ?

Avais-je suffisamment d’informations sur les autres joueurs ?

Les métriques permettent de comparer les impressions subjectives aux données réelles.

────────

21. Phase 9 — Robustesse LAN

Ajouter une phase dédiée à l’usage réel dans une pièce.

L’écran de l’hôte doit afficher clairement :

text
Grandes Colonies

Adresse LAN :
192.168.1.42:3000

[ QR CODE ]

Code partie :
ORANGE-7

Fonctionnalités recommandées :

• détection de l’adresse LAN ;
• QR code ;
• reconnexion ;
• pause ;
• reprise ;
• sauvegarde ;
• restauration ;
• réattribution de siège ;
• prolongation manuelle d’un timer ;
• remplacement d’un joueur ;
• possibilité de passer un joueur en bot.

────────

22. Mode maître de jeu / debug

Créer très tôt un panneau accessible uniquement à l’hôte.

Fonctions :

text
donner des ressources
retirer des ressources
forcer un lancer de dés
changer de phase
modifier le timer
ajouter des PV
déplacer un joueur
révéler une tuile
placer une construction
supprimer une construction
forcer un trade
téléporter le voleur
terminer la partie

Ce panneau est destiné au développement et aux playtests.

Il permet de reproduire rapidement des situations sans devoir jouer 45 minutes pour les atteindre.

────────

23. Critères de sortie par phase

Chaque phase doit avoir des critères mesurables.

Noyau moteur

text
✓ aucune action illégale acceptée dans les scénarios testés

✓ même seed + mêmes commandes
  = même résultat

✓ replay complet possible

✓ plus longue route testée
  sur cas pathologiques

✓ invariants économiques vérifiés

✓ aucune dépendance réseau dans engine

Réseau

text
✓ 12 clients simultanés

✓ reconnexion après F5

✓ reconnexion après coupure réseau

✓ aucune perte de siège

✓ commandes dupliquées ignorées

✓ informations privées non transmises

✓ timers autoritaires serveur

✓ commandes concurrentes
  résolues proprement

Vertical slice

text
✓ 8 humains peuvent terminer une partie

✓ règles comprises sans intervention
  permanente du développeur

✓ aucun joueur ne reste passif
  trop longtemps

✓ commerce réalisable dans
  la fenêtre prévue

✓ construction concurrente comprise
  par les joueurs

────────

24. Ordre recommandé des fonctionnalités

Nouvel ordre :

text
Validation papier / hybride
        ↓
Spike réseau 12 joueurs
        ↓
Noyau moteur
        ↓
Vertical slice Grandes Colonies
        ↓
Premier playtest numérique
        ↓
Serveur robuste
        ↓
8 → 12 joueurs
        ↓
Plateau XXL
        ↓
Multi-îles / routes maritimes
        ↓
Exploration
        ↓
Or
        ↓
Objectifs secrets
        ↓
Double voleur
        ↓
Chevaliers / barbares
        ↓
Influence
        ↓
Contrats / marché
        ↓
Villes spécialisées
        ↓
Direction artistique

────────

25. Éléments explicitement hors priorité

Ne pas investir fortement dans les éléments suivants avant validation de la vertical slice :

text
illustrations finales
animations complexes
effets visuels
IA avancée
matchmaking internet
comptes utilisateurs
cloud
classements
spectateurs
mobile natif
fork catanatron complet
marché dynamique
contrats
villes spécialisées
événements
équipes

────────

26. Risques principaux révisés

|Risque                                                    |Impact     |Mitigation                          |
|----------------------------------------------------------|-----------|------------------------------------|
|Les mécaniques simultanées ne fonctionnent pas humainement|Critique   |Prototype et vertical slice très tôt|
|Trop de règles développées avant validation               |Critique   |MVP minimal Grandes Colonies          |
|Bugs de concurrence                                       |Élevé      |Commandes sérialisées côté serveur  |
|Divergence client / serveur                               |Élevé      |Serveur autoritaire                 |
|Fuite d’informations secrètes                             |Élevé      |PublicGameView + PrivatePlayerView  |
|Reconnexion fragile                                       |Élevé      |Token de siège persistant           |
|Bugs impossibles à reproduire                             |Élevé      |RNG seedé + journal d’actions       |
|Scope trop large                                          |Élevé      |Ajout progressif des modules        |
|UX illisible à 12                                         |Élevé      |Prototype écran 12 joueurs tôt      |
|Mauvais équilibrage                                       |Moyen/élevé|Simulation continue + métriques     |
|Difficulté d’usage LAN                                    |Moyen      |QR code + écran hôte + reconnexion  |

────────

27. Architecture finale recommandée

text
┌─────────────────────────────────────────────────┐
│                 packages/engine                 │
│                                                 │
│ GameState                                       │
│ Commands                                        │
│ Rules                                           │
│ Resolver                                        │
│ Domain Events                                   │
│ Seeded RNG                                      │
│ Board Graph                                     │
└────────────────────────┬────────────────────────┘
                         │
               ┌─────────┴─────────┐
               │                   │
               ▼                   ▼
┌─────────────────────────┐   ┌────────────────────┐
│ packages/server         │   │ packages/sim       │
│                         │   │                    │
│ Colyseus                │   │ Bots               │
│ timers                  │   │ simulations        │
│ sessions                │   │ analytics          │
│ persistence             │   │ balance tests      │
└────────────┬────────────┘   └────────────────────┘
             │
             ▼
┌─────────────────────────┐
│ packages/protocol       │
│                         │
│ Commands réseau         │
│ PublicGameView          │
│ PrivatePlayerView       │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ packages/client         │
│                         │
│ React                   │
│ SVG                     │
│ UX commerce             │
│ timers                  │
│ journal                 │
└─────────────────────────┘

────────

28. Principe directeur du projet

Le principe à utiliser pour toutes les décisions de scope est :

Construire d’abord la plus petite version possible capable de démontrer que 8 joueurs peuvent jouer à Grandes Colonies simultanément, comprendre ce qui se passe et rester engagés.


Le premier succès du projet n’est donc pas :

« Nous avons reproduit toutes les règles de Catan. »


Le premier succès doit être :

« Huit personnes ont terminé une partie numérique de Grandes Colonies et le système de cycles, joueur associé, commerce chronométré et construction semi-simultanée fonctionne. »


Une fois cette hypothèse validée, le reste du contenu peut être ajouté progressivement.