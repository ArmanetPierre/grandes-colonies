# Development plan — Grandes Colonies (v2)

> Digital version of the fan-made board game **"Grandes Colonies"** (8–12 players), inspired by Catan, played over a local network: the server runs on the host's PC, players connect from their browser on the same LAN.
>
> **Reference documents**
> - Game design: [Catan_Grandes_Colonies_8-12_joueurs.md](Catan_Grandes_Colonies_8-12_joueurs.md)
> - Expert review (kept as is): [PLAN_UPDATED.md](PLAN_UPDATED.md)
>
> **v2 — 2026-08-26.** Integrates the expert review. The major changes relative to v1 are flagged with ⚠️ **v2 revision**.

---

## 1. Guiding principle

> Build first the smallest possible version able to demonstrate that **8 players can play Grandes Colonies simultaneously, understand what is happening and stay engaged**.

The project's first success is **not** "we reproduced every rule of Catan", but "eight people finished a digital game of Grandes Colonies, and the cycles, the associated player, the timed trade and the semi-simultaneous building work".

Every scope decision is settled with this principle.

---

## 2. Context and main risk

The game design describes a Catan variant for 8–12 players whose central mechanics aim to eliminate waiting time:

- game organized in **cycles** (phases A–E) instead of classic turns;
- **associated turns**: during the active player's turn, the player 3 seats to their left also plays (bank trade, building, card purchase);
- **timed free trade window** (30 s) on each cycle, open to all;
- **semi-simultaneous building**: announcement possible out of turn, resolution by priority (active player > Influence > spot freeze);
- XXL board of 44–52 hexes, multi-island, with **exploration** (face-down hexes);
- additional systems: gold, fish, Influence, contracts, knights/barbarians, dynamic market, secret objectives, double robber, victory at 15 VP.

**Risk no. 1 is not technical, it is ludic**: nobody has ever played this game, even on a table. The differentiating mechanics (cycles, associated player, timed trade, semi-simultaneous building) may well not work for humans. The whole plan is organized to answer this question as early and as cheaply as possible.

⚠️ **v2 revision** — v1 planned to build a "complete classic Catan" first and then extend it. That was a mistake: it pushed the validation of the only genuinely risky mechanics far off, while producing a deliverable (a 4-player Catan) the project does not need. The engine core now builds only what serves Grandes Colonies, and the first playable version is a **vertical slice of Grandes Colonies**, not a Catan clone.

---

## 3. Analysis of open source projects (unchanged)

### 3.1 Candidates evaluated

| Project | Stack / Licence | Players | Verdict |
|---|---|---|---|
| [catanatron](https://github.com/bcollazo/catanatron) | Python, GPL-3.0, very active | 4 | Excellent **architecture and analysis reference**. See §8: do not fork it. |
| [JSettlers2](https://github.com/jdmonin/JSettlers2) | Java Swing, GPLv3, mature | 4–6 | Best **rules reference** (Seafarers scenarios, fog, bots). Aging desktop client: to read, not to fork. |
| [Viral-Doshi/catan](https://github.com/Viral-Doshi/catan) | React + Socket.io | 2–6 | Good web **UI/network reference**; engine too simple. |
| [Pioneers](https://alternativeto.net/software/pioneers/) | C / GTK | ~6 | Too old, unsuitable ecosystem. |

### 3.2 Decision

**Do not fork an existing clone.** The assumptions "4 players, turn-based, standard board" are wired everywhere in their code; extending them would cost more than a rewrite. These projects serve as design references, not as a code base.

**Stack adopted**: TypeScript monorepo, pure rules engine, WebSocket for real time, React + SVG for the client.

> ⚠️ **Revision of 2026-08-27 — Colyseus dropped.** The plan adopted it for its rooms, its state synchronization and its reconnection. In use, none of the three held up.
>
> Its **state synchronization was deliberately bypassed**: it broadcasts to everyone, which would have forced field-by-field filtering of hands and secret objectives — a single filtering error being enough to reveal a hand. The **token reconnection** had to be written anyway. Only the rooms and the transport were left.
>
> The choice was settled by a hard blocker: **version 0.16 does not install** (a `workspace:` dependency was published by mistake) and **0.18 has no JavaScript client**, that one stopping at 0.16. No version offered both ends.
>
> The server therefore runs on `ws`, in about a hundred lines that only transport. All the logic lives in `GameSession`, testable without a network.

---

## 4. Architecture

### 4.1 Monorepo structure

```text
grandes-colonies/
│
├── packages/
│   ├── engine/      pure rules, authoritative state, deterministic RNG
│   ├── protocol/    network commands, public/private views, shared types
│   ├── server/      WebSocket: seats, timers, sessions, reconnection
│   ├── client/      React, SVG board rendering, trade, log, timers
│   ├── sim/         bots, simulations, balancing metrics
│   └── testkit/     scenario builders, fixtures, helpers, replay
│
└── apps/
    └── host/        application launched on the host PC
```

⚠️ **v2 revision** — Added the `protocol` package (explicit client/server contract) and `testkit` (test scenarios reusable across `engine`, `server` and `sim`).

### 4.2 Golden rule

**The server contains no game rule.** The engine must be able to run a full game without a browser, without WebSocket and without a server. The server transports and serializes; it decides nothing.

```text
Client
   │  Command
   ▼
Server (ordered queue)
   │
   ▼
validate(command, state)
   │
   ▼
resolve(command, state)
   │
   ├──> domain events
   └──> new state
            ├──> public view
            └──> player's private view
```

### 4.3 LAN deployment

```text
Host PC: Node server (WebSocket) + client static files
Players: browser → http://<local-ip>:<port>
```

No authentication, no hosting, no scaling. In exchange, care must go into **reconnection** and the **ergonomics of setup** (see §11).

---

## 5. Structuring technical decisions

These seven decisions are cheap if taken on day one, and very costly to catch up on later. They are the main contribution of the expert review.

### 5.1 Determinism mandatory

Same initial state + same seed + same command sequence ⇒ **exactly the same result**.

`Math.random()` is forbidden in the rules; everything goes through a seeded RNG (`game.random.next()`). The seed is recorded with the game. This gives for free: bug reproduction, replay, deterministic tests, simulation, comparison of engine versions.

### 5.2 Action log and replay

Every validated command is logged (`GameStarted`, `DiceRolled`, `ResourcesProduced`, `TradeCreated`, `TradeAccepted`, `BuildDeclared`, `BuildResolved`, `RobberMoved`, `PhaseEnded`…).

Keep at minimum: `gameId`, `seed`, `initialConfig`, `orderedCommands`, server timestamps. Optional periodic snapshots. A game's state must be reconstructible from the initial configuration + the seed + the ordered list of commands.

### 5.3 No real concurrency on the state

Players send commands simultaneously **from the UX point of view**, but the server processes them in an **ordered queue**, in sequential and deterministic resolution. The engine never modifies the same state from several concurrent callbacks. All priority rules are expressed explicitly in the engine, therefore testable.

### 5.4 `BuildIntent`: semi-simultaneous building

A build announcement does **not** immediately create a building.

```text
BuildIntent
- id, playerId, location, buildingType
- reservedCost, cycleId, phaseId
- createdAtOrder, status
```

```text
resources available → resources reserved → BuildIntent created
```

Reserved resources can no longer be used for a trade or another build. Conflict resolution: active player > Influence > other priority rule > **spot frozen**. Players whose build fails get their reserved resources back.

This is the technical translation of §8 of the game design, which stayed ambiguous about the exact moment resources are spent.

### 5.5 Capability system

Rather than scattering dozens of `if (phase === …)` across the server and client:

```text
getCapabilities(state, playerId)
→ CAN_ROLL_DICE, CAN_TRADE_BANK, CAN_TRADE_PLAYER, CAN_BUILD,
  CAN_DECLARE_BUILD, CAN_BUY_DEV_CARD, CAN_MOVE_ROBBER,
  CAN_END_ACTION, CAN_END_PHASE
```

Roles (active / associated / passive) translate into capabilities:

```text
active player    → CAN_BUILD, CAN_TRADE_BANK, CAN_TRADE_PLAYER
associated player → CAN_BUILD, CAN_TRADE_BANK
other players    → possibly CAN_DECLARE_BUILD
```

The client uses them for UX (greying out buttons), the server stays always authoritative.

### 5.6 Hidden information

Three distinct representations:

- `AuthoritativeGameState` — everything: hands, secret objectives, unexplored tiles;
- `PublicGameView` — only what everyone can know;
- `PrivatePlayerView` — the player's hand, their objectives, their hidden choices.

Never send secret data to an opposing browser and count on React not to display it. Secrecy is enforced on the server side. This is structuring for exploration (face-down tiles) and secret objectives.

### 5.7 Idempotence and session identity

Each command carries `actionId`, `playerId`, `type`, `payload`. The `actionId` allows a duplicate to be detected: a player who clicks twice because the network is slow must not trigger two actions.

No user accounts, but a persistent session identity (`seatId`, `sessionToken`, `playerName`, `playerColor`), the token stored in the browser. An F5 or a network drop ⇒ the player gets their seat back. Plan a host command to manually reassign a seat.

---

## 6. Roadmap

⚠️ **v2 revision** — The numbering has been reworked. Simulation and playtest instrumentation, which v1 placed in late phases, become **cross-cutting**: they start as soon as the engine runs and never stop. The expert review still listed them as "Phase 7" and "Phase 8" while asking that they be continuous — the contradiction is lifted here.

Likewise, the review placed the "web client" (its Phase 5) **after** the vertical slice (its Phase 2), whereas the latter requires getting 8 humans to play, therefore an interface. The vertical slice now explicitly includes a **rudimentary and ugly client**, and the later client phase is about the *polished* client.

### Phase 0 — Framing (a few days)

- Project name without the "CATAN" trademark (registered): **Grandes Colonies**. No official asset reused, fan-made mention.
- Licence: if GPL code (catanatron, JSettlers2) is copied, the project becomes GPL. Recommendation: use it only as a design reference to stay free in the choice of licence.
- TypeScript monorepo (pnpm workspaces), test CI, code conventions.

### Phase 1 — Game design validation (paper / hybrid)

**Without writing game code.** Paper, hybrid or rudimentary prototype, with real people.

Test as a priority: cycle A–E, active player, associated player, 30 s free trade, out-of-turn build announcements, build conflicts, the frequency at which each player can act, understanding of priorities, felt duration between two actions. Do not test the secondary systems.

**Deliverable: the Rules Contract v1** (see §7). No concurrent mechanic is to be coded until its exact rule is written.

### Phase 2 — 12-player network spike (throwaway)

Minimal server application, **meant to be thrown away**. It tests the infrastructure, nothing else: connecting 12 browsers, 12 seats, nickname and colour, public state, differentiated private data, server timer, connection loss, reconnection, F5, command spam, duplicates.

**Exit criteria**

```text
✓ 12 clients stay connected
✓ a player can refresh without losing their seat
✓ a reconnected player recovers their state
✓ private information is never sent to the other clients
✓ timers are authoritative on the server side
✓ near-simultaneous commands are processed cleanly
```

### Phase 3 — Engine core

Pure engine, no network or UI, unit tested. **Only what serves Grandes Colonies** — a complete classic Catan is not a deliverable.

**Geometry** — `Hex`, `Vertex`, `Edge`, `Route`, `MaritimeRoute`, `Building`, `Port`, `Island`, `Board`. The board is an **explicit graph**; placement rules never depend on the rendering. Reference: [Red Blob Games](https://www.redblobgames.com/grids/hexagons/), possible lib [honeycomb](https://github.com/flauwekeul/honeycomb).

**Economy** — `ResourceType`, `ResourceBank`, `PlayerInventory`, `Production`, `Trade`, `ConstructionCost`.

**Infrastructure** — `GameState`, `GameConfig`, `GameCommand`, `DomainEvent`, `CommandValidator`, `CommandResolver`, `SeededRandom`.

**Base rules** — dice, production, distribution, roads, settlements, cities, placement and distance, ports, bank trade, robber, victory points, longest road (the trickiest graph calculation).

**Exit criteria**

```text
✓ no illegal action accepted in the tested scenarios
✓ same seed + same commands = same result
✓ full replay possible
✓ longest road tested on pathological cases
✓ economic invariants verified
✓ no network dependency in engine
```

### Phase 4 — Grandes Colonies vertical slice (the decisive milestone)

First real digital version, deliberately reduced and **deliberately ugly**.

**Included**: 8 players (architecture compatible with 12), fixed map, 5 classic resources, dice, production, roads, settlements, cities, cycles A–E, active player, associated player, trade, timed window, semi-simultaneous building, simplified victory condition, **rudimentary client**, **game master panel** (§12), **first bots**.

**Temporarily excluded**: exploration, gold, special ports, secret objectives, double robber, dynamic market, contracts, barbarians, knights, advanced Influence, specialized cities, events, teams.

This phase answers **one single question**: *Is Grandes Colonies fun and fluid with several players?* If the answer is no, fix the pacing before adding anything.

**Exit criteria**

```text
✓ 8 humans finish a game
✓ rules understood without the developer intervening constantly
✓ no player stays passive too long
✓ trade achievable within the planned window
✓ concurrent building understood by the players
```

### Phase 5 — Robust server

Consolidation after validation: every interaction becomes an explicit command (`ROLL_DICE`, `BUILD_ROAD`, `BUILD_SETTLEMENT`, `BUILD_CITY`, `DECLARE_BUILD`, `CANCEL_BUILD`, `CREATE_TRADE`, `CANCEL_TRADE`, `ACCEPT_TRADE`, `MOVE_ROBBER`, `END_ACTION`, `END_PHASE`), with idempotence by `actionId`, centralized capabilities, full sessions and reconnection, save/restore.

### Phase 6 — Polished web client and trade UX

See §9 and §10.

### Phase 7 — Grandes Colonies ruleset v1

Progressive addition, in this order:

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

Everything that can be becomes configurable, to test variants without touching the code:

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

### Phase 8 — LAN robustness

See §11.

### Phase 9 — Advanced modules

Knights / barbarians → Influence → contracts / market → specialized cities. Each module goes through the same cycle: rule written, engine, simulation, playtest.

### Phase 10 — Art direction (optional)

Only once the game is validated: while the rules are moving, detailed art would be thrown away.

### Overview

```text
Framing
   ↓
Paper / hybrid validation  →  Rules Contract v1
   ↓
12-player network spike
   ↓
Engine core ──────────────────┐
   ↓                          │
8-player vertical slice       │  continuous simulation
   ↓                          │  (as soon as the engine runs)
First digital playtest ───────┤
   ↓                          │  instrumented playtests
Robust server                 │  (from the vertical slice on)
   ↓                          │
Polished client + trade UX    │
   ↓                          │
Ruleset v1 (8 → 12, XXL, …) ──┘
   ↓
LAN robustness
   ↓
Advanced modules
   ↓
Art direction
```

---

## 7. Rules Contract v1 — Phase 1 deliverable

The game design describes intentions, not edge cases. These questions must be settled **in writing** before any concurrent code:

```text
Who can perform which actions, during which phases?

Can an action begun before the end of the timer finish after 0?
What exactly happens when the timer reaches 0?

When are a build's resources reserved?
When are they actually spent?

How are two competing announcements decided between?
What exactly does "spot frozen" mean? When does the freeze end?

What happens if the active player disconnects?
And the associated player?
What does the server do when a player exceeds their timeout?

When is victory checked?
Can it be triggered during a simultaneous phase?
What happens if several players reach the threshold in the same cycle?
```

---

## 8. Continuous simulation (cross-cutting, from Phase 3 on)

⚠️ **v2 revision** — v1 recommended a possible fork of catanatron for balancing. **Not to be done**: it would produce two implementations of the same rules, which would diverge immediately. The bots run directly on the TypeScript engine. Catanatron remains an architecture and analysis reference.

```text
              engine
                ▲
        ┌───────┴────────┐
      server            sim
                          │
              RandomBot / GreedyBot / ExpansionBot / BalancedBot
```

The bots do not need to be intelligent. Goals: detect broken rules and blockages, measure duration, compare configurations, detect the first-player advantage and the snowball, measure the value of resources, compare 8 / 10 / 12 players over hundreds or thousands of games.

**Metrics recorded**: number of cycles and turns, final VP and VP per cycle, production per resource, resources gained and spent per player, number of trades and acceptance rate, builds and roads per player, number of build conflicts, frequency of numbers, theoretical duration, winner's position, winner / last gap.

---

## 9. Web client

⚠️ **v2 revision** — Start in **SVG**, only move to PixiJS if a performance problem is genuinely measured. v1 hesitated between the two; 50–60 hexes and a few hundred edges stay very reasonable in SVG, which brings for free the DOM, clicks, CSS, zoom, pan, accessibility and inspection.

```text
┌───────────────────────────────────────────────┐
│ Phase | Active | Associated | Timer           │
├───────────┬───────────────────────┬───────────┤
│ players   │                       │ activity  │
│           │       BOARD           │ / trades  │
│           │                       │           │
├───────────┴───────────────────────┴───────────┤
│ hand / builds / quick actions                 │
└───────────────────────────────────────────────┘
```

Permanent display: current phase, active player, associated player, timer, expected action, state of the trade window.

**Display of the 12 players** — ⚠️ **v2 revision**: do not depend on hover (the game may be used on laptop, tablet or phone). Each opponent is consultable on **click / tap**, hover being only a bonus. Permanent display limited to: nickname, colour, public VP, number of cards, public Influence, active/associated status, connection state. Distinguish the 12 players by **colour + shape + pattern + icon**, to stay legible in case of colour-blindness.

**Assets** — low need: ~9 tile types, geometric pieces in 12 colours, tokens, typographic cards. Everything is achievable in programmatic SVG, flat style, with [game-icons.net](https://game-icons.net) (CC BY 4.0) and, if needed later, the CC0 packs from [Kenney](https://kenney.nl/assets).

---

## 10. Trade UX (a sub-project in its own right)

Since players are in the same room, **negotiation stays spoken**. The interface only serves to confirm quickly.

```text
I give: [wood] [wood]        The recipient sees:
I want: [ore]                     2 wood ↔ 1 ore
To    : [Julie]
                                  [ACCEPT]  [DECLINE]
[PROPOSE]
```

Acceptance must be **atomic on the server side**: check A's inventory, B's inventory, the phase and the offer's validity, then perform the two transfers. If one player's inventory has changed in the meantime, the offer becomes invalid.

---

## 11. LAN robustness (Phase 8)

Host screen:

```text
Grandes Colonies

LAN address: 192.168.1.42:3000

[ QR CODE ]

Game code: ORANGE-7
```

Features: LAN address detection, QR code, reconnection, pause / resume, save / restore, seat reassignment, manual extension of a timer, replacing a player, switching a player to a bot.

---

## 12. Game master / debug mode (from Phase 4 on)

Panel reserved for the host: give or take resources, force a dice roll, change phase, modify the timer, add VP, reveal a tile, place or remove a build, force a trade, teleport the robber, end the game.

Meant for development and playtests: it avoids playing 45 minutes to reach the situation you want to test.

---

## 13. Instrumented playtests (cross-cutting, from Phase 4 on)

Every LAN game automatically produces metrics: total time, per cycle, per phase; time spent trading; **idle time per player**; trades proposed / accepted / expired; conflicting builds; invalid actions; timeouts; resources and VP per player and per cycle; time spent in the lead; disconnections.

Then a player questionnaire: did I feel I was playing regularly? did I wait too long? was the trade understandable? was the timer stressful? was the associated player's role clear? were the build conflicts understandable? was the board legible? did I have enough information about the others?

The point is to **confront subjective impressions with real data** — and this directly instruments the 5 criteria of §40 of the game design.

---

## 14. Not a priority

Do not invest before the vertical slice is validated: final illustrations, complex animations, visual effects, advanced AI, internet matchmaking, user accounts, cloud, rankings, spectators, native mobile, catanatron fork, dynamic market, contracts, specialized cities, events, teams.

---

## 15. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The simultaneous mechanics do not work for humans | Critical | Paper prototype (Phase 1) and vertical slice (Phase 4) very early |
| Too many rules developed before validation | Critical | Minimal Grandes Colonies MVP, scope frozen by §1 |
| **Insufficient action budget per player** (see §16) | Critical | Dedicated simulation from Phase 3, before the vertical slice |
| Concurrency bugs | High | Commands serialized on the server side |
| Client / server divergence | High | Authoritative server, client never decides |
| Leak of secret information | High | `PublicGameView` / `PrivatePlayerView` |
| Fragile reconnection | High | Persistent seat token |
| Bugs impossible to reproduce | High | Seeded RNG + action log + replay |
| Scope too broad | High | Progressive addition of modules |
| Illegible UX at 12 | High | 12-player screen prototype early |
| Poor balancing | Medium/high | Continuous simulation + metrics |
| LAN usability difficulty | Medium | QR code + host screen + reconnection |
| CATAN trademark | Low (private LAN) | Original name, no official asset, fan-made mention |

---

## 16. Priority open point: the action budget per player

A calculation that neither v1 nor the expert review addresses, and which conditions the overall balancing.

**The calculation.** At 12 players, a cycle lasts about 90 s (active turn) + 30 s (trade) ≈ 2 min. A full round of the table ≈ **24 minutes**. The target duration of §2 of the game design (120–160 min) therefore leaves **5 to 6 rounds of the table**, i.e. **5 to 6 active turns per player** to reach 15 VP.

**The consequence.** The number of dice rolls, meanwhile, stays comparable to a classic Catan (60–72 cycles ≈ as many rolls), and each player produces on *every* roll. In other words:

```text
income per player          ≈ classic Catan
opportunities to spend      ÷ 3
```

The associated turns partly compensate (5–6 active turns + 5–6 associated turns ≈ 10–12 opportunities against 15–20 in classic Catan), and that is precisely the function of semi-simultaneous building. But two effects are to be watched:

1. **Hand saturation**: with normal income and three times fewer chances to spend, the hand limit (§24) is reached constantly, and every 7 (≈ 10 to 12 times per game, each involving 12 players) becomes a spike of discard and dead time — exactly what the game seeks to eliminate.
2. **Victory threshold**: 15 VP in 10–12 action opportunities is probably out of reach, which would lengthen the game far beyond the target.

**The levers**, to arbitrate by simulation before the vertical slice: active turn duration, VP threshold, **number of associated players** (two instead of one at 11–12 players?), scope of what is buildable out of turn, hand limit.

**Action**: this is the first question the simulation (§8) must address, even before resource balancing.

---

## 17. Other questions to settle

1. **Fish** — the game design (§5) introduces it but gives it no structuring role. Simply remove it?
2. **Contracts** (§19) — their only sanction is a loss of 2 Influence. Without automatic enforcement, they rest entirely on the social; should the digital version model them, or leave them outside the system?
3. **Dynamic market** (§10) — the most costly mechanic to implement for an undemonstrated gameplay gain. A natural candidate for abandonment if Phase 1 does not call for it.
4. **Team mode** (§30) — potentially the best remedy for the problem of §16 (two teams of 6 = twice as many active agents per unit of time). To be seriously evaluated rather than treated as a secondary variant.

---

*v2 — 2026-08-26. Sources: [catanatron](https://github.com/bcollazo/catanatron) · [docs.catanatron.com](https://docs.catanatron.com/) · [JSettlers2](https://github.com/jdmonin/JSettlers2) · [Viral-Doshi/catan](https://github.com/Viral-Doshi/catan) · [game-icons.net](https://game-icons.net) · [Kenney](https://kenney.nl/assets) · [Red Blob Games — hexagons](https://www.redblobgames.com/grids/hexagons/)*
