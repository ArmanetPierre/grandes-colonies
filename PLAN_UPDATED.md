Adaptation plan — Grandes Colonies

Objective

Revise the current development plan of Grandes Colonies, a digital game inspired by Catan for 8–12 players over LAN, without changing the main stack:

• TypeScript
• React
• Colyseus
• monorepo
• pure, network-independent rules engine

The main goal of this adaptation is to reduce project risk by validating as early as possible the genuinely differentiating mechanics of Grandes Colonies:

• cycles A–E;
• active player + associated player;
• timed free trade;
• semi-simultaneous building;
• 8–12 players;
• low waiting time.

The MVP must therefore not be "digital classic Catan", but a minimal, unpolished but playable version of Grandes Colonies, able to demonstrate that several players can act regularly without excessive dead time.

────────

1. Architecture principles to keep

Keep the following general architecture:

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

Role of the packages:

text
packages/engine
    pure rules
    authoritative state
    action validation
    rules resolution
    deterministic RNG
    domain events

packages/protocol
    network commands
    public views
    private views
    shared client/server types

packages/server
    Colyseus
    rooms
    lobby
    reconnection
    timers
    sessions
    saves

packages/client
    React
    player interface
    board rendering
    trade
    log
    timers

packages/sim
    bots
    simulations
    balancing metrics

packages/testkit
    scenario builders
    fixtures
    test helpers
    game replay

Fundamental principle:

text
Client
   │
   │ Command
   ▼
Server
   │
   ▼
validate(command, state)
   │
   ▼
resolve(command, state)
   │
   ├──> events
   │
   └──> new state
            │
            ├──> public view
            └──> player's private view

Colyseus must not contain the game rules.

The engine must be able to run a full game without a browser, WebSocket or Colyseus server.

────────

2. Concurrency model

Do not implement genuine concurrent writes on the game state.

Players may send commands simultaneously from the UX point of view, but the server must process them in an ordered queue.

Example:

text
Player A → DECLARE_BUILD
Player B → DECLARE_BUILD
Player C → ACCEPT_TRADE

              ↓

       command queue

              ↓

sequential and deterministic
server resolution

The engine therefore never modifies the same state from several concurrent threads or callbacks.

All priority rules must be expressed explicitly in the engine.

────────

3. Semi-simultaneous building

Do not immediately turn a build announcement into a building.

Create a notion of:

text
BuildIntent

Example of a conceptual structure:

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

When a player announces a build:

text
resources available
        ↓
resources reserved
        ↓
BuildIntent created

Reserved resources can no longer be used for a trade or another build.

On conflict resolution:

text
1. priority to the active player
2. priority by Influence if applicable
3. other possible priority rule
4. remaining tie → spot frozen

Players whose build fails get their reserved resources back.

All rules concerning conflicts must be deterministic and testable.

────────

4. Phase 0A — Game design validation

Before building the full game, make a minimal prototype that lets the riskiest mechanics be tested.

The prototype may be paper, hybrid or extremely rudimentary.

Test as a priority:

• cycle A–E;
• active player;
• associated player;
• free trade for 30 seconds;
• out-of-turn build announcements;
• build conflicts;
• the frequency at which each player can act;
• understanding of priorities;
• felt duration between two actions.

Do not test all the secondary systems at this stage.

Deliverable

Create a Rules Contract v1 explicitly answering the following questions:

text
Who can perform which actions?

During which phases?

Can an action begun before the end of the timer finish after 0?

What exactly happens when the timer reaches 0?

When are a build's resources spent?

When are they reserved?

How are two competing announcements decided between?

What exactly does "spot frozen" mean?

When does the freeze end?

What happens if an active player disconnects?

What happens if an associated player disconnects?

What does the server do when a player exceeds their timeout?

When is victory checked?

Can a victory be triggered during a simultaneous phase?

What happens if several players reach the victory threshold in the same cycle?

No concurrent mechanic is to be coded until its exact rule is defined.

────────

5. Phase 0B — Network technical spike

Create a minimal, throwaway Colyseus application.

It must test only the network infrastructure.

Features:

• connecting 12 browsers;
• assigning 12 seats;
• nickname and colour;
• public state;
• private data differing per player;
• server timer;
• connection loss;
• reconnection;
• browser refresh;
• simultaneous command spam;
• detection of duplicate commands.

Exit criteria

text
✓ 12 clients can stay connected

✓ a player can refresh their browser
  without losing their seat

✓ a reconnected player recovers their state

✓ private information is never
  sent to the other clients

✓ timers are authoritative on the server side

✓ several commands sent near-
  simultaneously are processed cleanly

────────

6. Phase 1 — Engine core

Replace the "complete classic Catan" phase with the creation of a generic core needed for Grandes Colonies.

The goal is not to produce a complete 4-player clone of Catan.

The goal is to produce a robust, reusable engine.

Geometry

Implement:

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

The board must be represented as an explicit graph.

Placement rules must not depend on the graphical rendering.

Economy

Implement:

text
ResourceType
ResourceBank
PlayerInventory
Production
Trade
ConstructionCost

Engine infrastructure

Create:

text
GameState
GameConfig
GameCommand
DomainEvent
CommandValidator
CommandResolver
SeededRandom

Base rules

Implement only the rules needed for the future Grandes Colonies:

• dice roll;
• production;
• resource distribution;
• roads;
• settlements;
• cities;
• placement;
• distance between settlements;
• ports;
• bank trade;
• robber;
• victory points;
• longest road.

The classic rules serve as a reference and for tests, but a complete "classic Catan" application is not a mandatory deliverable.

────────

7. Determinism mandatory

The engine must be fully deterministic.

Requirement:

With the same initial state, the same seed and the same command sequence, the engine must always produce exactly the same result.


Never use directly:

Math.random()

in the rules.

Use a controlled pseudo-random generator:

game.random.next()

The seed must be recorded with the game.

This allows:

• bug reproduction;
• replay;
• simulation;
• deterministic tests;
• comparison of engine versions.

────────

8. Action log and replay

All validated commands must be loggable.

Example:

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

Keep at minimum:

text
gameId
seed
initialConfig
orderedCommands
server timestamps

Optionally, add periodic snapshots:

text
snapshot after N commands

Replay must be able to reconstruct a game's state from:

text
initial configuration
+
seed
+
ordered list of commands

────────

9. Phase 2 — Grandes Colonies vertical slice

Create very early a first real digital version of Grandes Colonies.

This version must be deliberately reduced.

Included

• 8 players;
• architecture compatible with 12;
• fixed map;
• classic resources;
• dice roll;
• production;
• roads;
• settlements;
• cities;
• cycles;
• active player;
• associated player;
• trade;
• timed trade window;
• semi-simultaneous building;
• simplified victory condition.

Temporarily excluded

text
exploration
gold
special ports
secret objectives
double robber
dynamic market
contracts
barbarians
advanced knights
advanced Influence
specialized cities
events
teams

This phase must answer one single question:

Is Grandes Colonies fun and fluid with several players?


If this version does not work, do not add new systems before having fixed the pacing.

────────

10. Phase 3 — Robust Grandes Colonies server

Once the vertical slice is validated, consolidate the server.

Every player interaction must become an explicit command.

Examples:

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

Each command must have at minimum:

text
actionId
playerId
type
payload

actionId must allow a command received twice to be detected.

Typical case:

text
player clicks
↓
network slows down
↓
player clicks again
↓
server receives two commands

The server must execute the action only once.

────────

11. Capability system

Avoid scattering dozens of conditions like the following across the server:

if (phase === ...)

Create a centralized system:

text
getCapabilities(state, playerId)

Examples of capabilities:

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

The active, associated or passive player roles must be translated into capabilities.

Example:

text
active player
→ CAN_BUILD
→ CAN_TRADE_BANK
→ CAN_TRADE_PLAYER

associated player
→ CAN_BUILD
→ CAN_TRADE_BANK

other players
→ possibly CAN_DECLARE_BUILD

The client may use these capabilities for the UX, but the server stays always authoritative.

────────

12. Hidden information

Explicitly separate:

text
AuthoritativeGameState
PublicGameView
PrivatePlayerView

AuthoritativeGameState

Contains everything:

• all players' hands;
• secret objectives;
• unexplored tiles;
• private information;
• internal states.

PublicGameView

Contains only what all players can know.

PrivatePlayerView

Contains the information specific to one player:

• their hand;
• their objectives;
• their hidden choices;
• other private information.

Never send secret data to an opposing browser and count solely on React not to display it.

Secrecy must be enforced on the server side.

────────

13. Identity and reconnection

The game does not need user accounts.

However, each player must have a persistent session identity.

Example:

text
seatId
sessionToken
playerName
playerColor

The token can be stored locally in the browser.

On a refresh or a reconnection:

text
sessionToken
      ↓
server
      ↓
seat recovery

Also plan an administrator command letting the host manually reassign a seat.

────────

14. Phase 4 — Grandes Colonies Ruleset v1

Once the game's pacing is validated, progressively add the content of the Grandes Colonies ruleset.

Suggested order:

1. going from 8 to 12 players;
2. XXL board;
3. multi-island;
4. sea lanes;
5. exploration;
6. gold;
7. special ports;
8. 2/12 rule;
9. dynamic hand limit;
10. double robber;
11. secret objectives;
12. victory at 15 VP.

Make the maximum number of parameters configurable.

Example:

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

This lets different variants be tested quickly without modifying the code.

────────

15. Phase 5 — Web client

Start with an SVG rendering.

Only move to PixiJS if a real performance problem is measured.

50–60 hexes, a few hundred edges and pieces stay reasonable for SVG.

Advantages:

• DOM;
• clicks;
• CSS;
• zoom;
• pan;
• accessibility;
• inspection;
• simple development.

General structure of the screen

text
┌───────────────────────────────────────────────┐
│ Phase | Active | Associated | Timer           │
├───────────┬───────────────────────┬───────────┤
│ players   │                       │ activity  │
│           │       BOARD           │ / trades  │
│           │                       │           │
├───────────┴───────────────────────┴───────────┤
│ hand / builds / quick actions                │
└───────────────────────────────────────────────┘

The interface must display at all times:

• current phase;
• active player;
• associated player;
• timer;
• expected action;
• state of the trade window.

────────

16. Display of the 12 players

Do not depend solely on hover.

The game may be used on a laptop, a tablet or a phone.

Each opponent must be consultable by:

• click;
• tap;
• hover as a bonus.

Display at all times only the important information:

text
nickname
colour
public VP
number of cards
public Influence
active / associated status
connection

Use:

• colour;
• shape;
• pattern;
• icon;

so that the 12 players stay distinguishable even in case of colour-blindness.

────────

17. Phase 6 — Trade UX

Treat trade as an important UX sub-project.

Since players are in the same room, negotiation can stay mainly spoken.

The interface mostly serves to confirm the trade quickly.

Example:

text
I give:

[wood] [wood]

I want:

[ore]

To:

[Julie]

[PROPOSE]

The recipient sees:

text
2 wood ↔ 1 ore

[ACCEPT]

[DECLINE]

An acceptance must be atomic on the server side:

text
check inventory A
+
check inventory B
+
check phase
+
check offer validity
+
perform the two transfers

If one player's inventory has changed in the meantime, the offer becomes invalid.

────────

18. Phase 7 — Continuous simulation

Simulation must not be an isolated phase located late in the project.

It must become available as soon as the engine works.

Architecture:

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

The bots do not need to be very intelligent.

Create for example:

text
RandomBot
GreedyBot
ExpansionBot
BalancedBot

Simulation goals:

• detect broken rules;
• detect blockages;
• measure duration;
• compare configurations;
• detect the first-player advantage;
• detect the snowball;
• measure the value of resources;
• compare 8, 10 and 12 players.

Do not initially create a fork of catanatron for Grandes Colonies.

Use the TypeScript engine directly to avoid two implementations of the same rules.

Catanatron can remain an architecture and analysis reference.

────────

19. Simulation metrics

Record at minimum:

text
number of cycles
number of turns
final VP
VP per cycle
production per resource
resources gained per player
resources spent
number of trades
trade acceptance rate
builds per player
roads per player
number of build conflicts
frequency of numbers
theoretical duration
winner's position
winner / last gap

Compare regularly:

text
8 players
10 players
12 players

over several hundred or thousand games.

────────

20. Phase 8 — Instrumented playtests

Every real LAN game must automatically produce metrics.

Measure:

text
total time
time per cycle
time per phase
time spent trading
idle time per player
number of trades proposed
number of trades accepted
number of trades expired
number of conflicting builds
number of invalid actions
number of timeouts
resources per player and per cycle
VP per player and per cycle
time spent in the lead
number of disconnections

Then add a player questionnaire.

Examples:

text
Did I feel I was playing regularly?

Did I wait too long?

Was the trade understandable?

Was the timer stressful?

Was the associated player's role clear?

Were the build conflicts understandable?

Was the board legible?

Did I have enough information about the other players?

The metrics allow subjective impressions to be compared to real data.

────────

21. Phase 9 — LAN robustness

Add a phase dedicated to real use in a room.

The host's screen must clearly display:

text
Grandes Colonies

LAN address:
192.168.1.42:3000

[ QR CODE ]

Game code:
ORANGE-7

Recommended features:

• LAN address detection;
• QR code;
• reconnection;
• pause;
• resume;
• save;
• restore;
• seat reassignment;
• manual extension of a timer;
• replacing a player;
• the ability to switch a player to a bot.

────────

22. Game master / debug mode

Create very early a panel accessible only to the host.

Functions:

text
give resources
take resources
force a dice roll
change phase
modify the timer
add VP
move a player
reveal a tile
place a build
remove a build
force a trade
teleport the robber
end the game

This panel is meant for development and playtests.

It lets situations be reproduced quickly without having to play 45 minutes to reach them.

────────

23. Exit criteria per phase

Each phase must have measurable criteria.

Engine core

text
✓ no illegal action accepted in the tested scenarios

✓ same seed + same commands
  = same result

✓ full replay possible

✓ longest road tested
  on pathological cases

✓ economic invariants verified

✓ no network dependency in engine

Network

text
✓ 12 simultaneous clients

✓ reconnection after F5

✓ reconnection after network drop

✓ no seat loss

✓ duplicate commands ignored

✓ private information not transmitted

✓ server-authoritative timers

✓ concurrent commands
  resolved cleanly

Vertical slice

text
✓ 8 humans can finish a game

✓ rules understood without the developer
  intervening constantly

✓ no player stays passive
  too long

✓ trade achievable within
  the planned window

✓ concurrent building understood
  by the players

────────

24. Recommended order of features

New order:

text
Paper / hybrid validation
        ↓
12-player network spike
        ↓
Engine core
        ↓
Grandes Colonies vertical slice
        ↓
First digital playtest
        ↓
Robust server
        ↓
8 → 12 players
        ↓
XXL board
        ↓
Multi-island / sea lanes
        ↓
Exploration
        ↓
Gold
        ↓
Secret objectives
        ↓
Double robber
        ↓
Knights / barbarians
        ↓
Influence
        ↓
Contracts / market
        ↓
Specialized cities
        ↓
Art direction

────────

25. Elements explicitly out of priority

Do not invest heavily in the following elements before the vertical slice is validated:

text
final illustrations
complex animations
visual effects
advanced AI
internet matchmaking
user accounts
cloud
rankings
spectators
native mobile
full catanatron fork
dynamic market
contracts
specialized cities
events
teams

────────

26. Revised main risks

|Risk                                                      |Impact     |Mitigation                          |
|----------------------------------------------------------|-----------|------------------------------------|
|The simultaneous mechanics do not work for humans         |Critical   |Prototype and vertical slice very early|
|Too many rules developed before validation                |Critical   |Minimal Grandes Colonies MVP          |
|Concurrency bugs                                          |High       |Commands serialized on the server side|
|Client / server divergence                                |High       |Authoritative server                 |
|Leak of secret information                                |High       |PublicGameView + PrivatePlayerView   |
|Fragile reconnection                                      |High       |Persistent seat token                |
|Bugs impossible to reproduce                              |High       |Seeded RNG + action log              |
|Scope too broad                                           |High       |Progressive addition of modules      |
|Illegible UX at 12                                        |High       |12-player screen prototype early     |
|Poor balancing                                            |Medium/high|Continuous simulation + metrics      |
|LAN usability difficulty                                  |Medium     |QR code + host screen + reconnection |

────────

27. Recommended final architecture

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
│ Network commands        │
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
│ trade UX                │
│ timers                  │
│ log                     │
└─────────────────────────┘

────────

28. Guiding principle of the project

The principle to use for all scope decisions is:

Build first the smallest possible version able to demonstrate that 8 players can play Grandes Colonies simultaneously, understand what is happening and stay engaged.


The project's first success is therefore not:

"We reproduced every rule of Catan."


The first success must be:

"Eight people finished a digital game of Grandes Colonies and the system of cycles, associated player, timed trade and semi-simultaneous building works."


Once this hypothesis is validated, the rest of the content can be added progressively.
