# Screen specification — Grandes Colonies

> Brief for the **UI/UX designer**.
>
> Describes the context, the constraints, the inventory of screens and the detail of each one.
>
> Project: [PLAN_DE_DEVELOPPEMENT.md](PLAN_DE_DEVELOPPEMENT.md) · Assets: [SPEC_ASSETS_IMAGES.md](SPEC_ASSETS_IMAGES.md) · Rules: [Catan_Grandes_Colonies_8-12_joueurs.md](Catan_Grandes_Colonies_8-12_joueurs.md)

---

## 1. The project on one page

**Grandes Colonies** is a digital board game inspired by Catan, designed for **8 to 12 players**. It is played over a **local network**: the server runs on the host's PC, each player connects from the browser on their own device. **All players are physically in the same room.**

### What makes this game different from any existing digital Catan

A classic Catan is strictly turn-based: one player acts, eleven wait. At 12 players, that would produce 90 % dead time. The design was therefore built so that **almost everyone has something to do at all times**:

- The game is split into **cycles**. On each cycle, one player is **active** (they do everything: trade, build, buy) and another is **associated** (they can build and trade with the bank, but not negotiate with the other players).
- Each cycle contains a **free 30-second trade window** during which *all* players can negotiate with each other.
- Players can **announce a build out of turn**. If two players aim for the same spot, a priority rule decides — and in a tie, the spot is **frozen** for the cycle.
- **Server timers** pace the whole thing: about 90 s for the active turn, 30 s for trade.

### The consequence for design

> A player is never simply "waiting". They are at all times in one of four states: **active**, **associated**, **in the trade window**, or **passive but allowed to announce a build**.

The central challenge of the interface is therefore to answer at a glance, at any moment, the question: **"what can I do, right here, right now, and how much time do I have left?"**

That is the criterion against which every design proposal must be judged.

---

## 2. Cross-cutting constraints

### 2.1 Devices

Everyone plays on whatever they have to hand. No device is in the majority.

| Target | Reference resolution | Importance |
|---|---|---|
| Laptop | 1440 × 900 | **Primary** |
| Desktop | 1920 × 1080 | High |
| Landscape tablet | 1024 × 768 | High |
| Portrait phone | 390 × 844 | **To be taken seriously** |

The phone is the real challenge: it must show a 50-hex board, 11 opponents and a trade panel. A full re-layout is expected there, not a simple resize.

### 2.2 Visual identity of the 12 players

A strong, structuring constraint. Twelve genuinely distinguishable colours do not exist — especially applied to a road a few pixels wide on a zoomed-out board, and especially for a colour-blind player.

**The expected solution is redundant**: each player gets a **colour**, **plus** an avatar **shape**, **plus** a fill **pattern** (stripes, dots, checkerboard, chevrons…). A player must stay identifiable if you mentally remove the colour.

Expected deliverable: the palette of the 12 identities, validated in colour-blindness simulation (deuteranopia, protanopia, tritanopia).

### 2.3 Readability at a distance

Players are in the same room and will look at their neighbour's screen, and possibly a shared screen. **The timer and the current phase must be readable from two metres.**

### 2.4 States to plan for each screen

A screen is not a single state. For each mockup, plan for:

```text
☐ nominal state
☐ player disconnected / reconnecting
☐ game paused
☐ timer under 10 seconds (alert)
☐ action impossible (and why)
☐ hand limit reached
☐ loading / waiting on the server
```

### 2.5 Language

Interface in **French**. Plan for labels that support later translation (no layout that depends on the exact length of words).

---

## 3. Inventory of screens

| # | Screen | User | Complexity | Priority |
|---|---|---|---|---|
| 1 | Join | Player | Low | P0 |
| 2 | Lobby | Player | Low | P0 |
| 3 | Host console | Host | Medium | P0 |
| 4 | **Game** | Player | **Very high** | **P0** |
| 5 | End of game | Player | Low | P0 |
| 6 | Game master panel | Host | Medium (aesthetics not a priority) | P0 |
| 7 | Metrics dashboard | Host | Medium | P2 |

**Screen 4 represents about 90 % of the design load.** Screens 1, 2 and 5 are deliberately simple and can reuse a single template.

---

## 4. Screens 1, 2, 3 and 5 — the simple screens

### Screen 1 — Join

**Goal**: get into the game in under 15 seconds, often from a phone that scanned the QR code.

**Content**: nickname field, colour/identity selection among those still free, game code (pre-filled if arriving via QR code), Join button.

**Points of attention**: the identity selection must already show the colour + shape + pattern redundancy (§2.2). Identities already taken appear disabled, with the name of whoever chose them.

### Screen 2 — Lobby

**Goal**: wait for the start while knowing who is there.

**Content**: list of connected players with their identity and status (connected / ready), current player count against the minimum required, summary of the game configuration (VP to win, turn duration, enabled modules), Ready button, note that only the host can launch.

**Points of attention**: at 12 players, the list must stay readable on a phone. It is also the first place a player sees the 12 identities side by side — good ground for validating the palette.

### Screen 3 — Host console

**Goal**: let the host open the game and bring 11 people into it without technical assistance.

**Content**:
- **LAN address, very large** (e.g. `192.168.1.42:3000`) and **QR code** — this is the main content of the screen, it will be shown around or projected;
- a memorable game code (e.g. `ORANGE-7`);
- list of seats with their occupant and connection state;
- game settings: VP count, active turn duration, trade duration, hand limit, enabled modules (exploration, gold, secret objectives…);
- Start, Pause, Save buttons.

**Points of attention**: this screen is used standing up, showing it to others. Very marked hierarchy: the QR code and the address crush everything else. The settings are secondary and can be collapsed.

### Screen 5 — End of game

**Goal**: understand who won and why, and make people want to play again.

**Content**: final ranking, breakdown of points by source (settlements, cities, revealed secret objectives, longest network, military strength…), a few striking game statistics (the biggest trader, the biggest builder, the unluckiest with the dice), Play again and Quit buttons.

**Points of attention**: secret objectives are revealed here — it is a moment of play, it deserves a staging. The statistics come from the metrics already collected (§13 of the plan).

---

## 5. Screen 4 — The game screen

### 5.1 Proposed layout (to be challenged)

```text
┌─────────────────────────────────────────────────────────────┐
│ ① Cycle 12 · Phase Trade · Active: Léa · Associated: Marc   │
│                                          ⏱ 00:23            │
├──────────┬──────────────────────────────────┬───────────────┤
│          │                                  │               │
│    ③     │                                  │      ⑥        │
│ Players  │              ②                   │     Trade     │
│   (12)   │            BOARD                 │               │
│          │                                  ├───────────────┤
│          │                                  │      ⑦        │
│          │                                  │      Log      │
├──────────┴──────────────────────────────────┴───────────────┤
│ ④ My hand: 🌲3 🧱2 🌾1 🐑4 ⛏️0   (9/13)                      │
│ ⑤ [Build ▾] [Dev card] [Bank] [End action]                  │
└─────────────────────────────────────────────────────────────┘
```

This layout is a **starting point**, not a constraint. It is there to give a basis for discussion and make the zones concrete.

### 5.2 Zone ① — Status bar

The most important zone of the screen after the board.

**Content**: cycle number, current phase (Production / Active turn / Associated turn / Free trade), active player, associated player, **timer**, and above all **the action expected of me**.

**The critical point**: that last element — "it's your turn", "you can build", "discard your cards", "you can only watch" — is what stops a player missing their turn. It must be impossible to miss, and stand out clearly from information about the others.

The timer must change appearance under 10 seconds, without becoming so aggressive that it needlessly stresses people (playtest feedback on this point is explicitly planned).

### 5.3 Zone ② — Board

**Content**: 44 to 52 terrain hexes, numbered tokens, ports, roads / settlements / cities / trading posts of 12 players, one or two robbers, unexplored tiles, frozen spots, and **pending build intents**.

**Interactions**: zoom, pan, selecting a buildable spot, hovering/tapping a tile to see who produces on it.

**Three specific difficulties**:

1. **Density.** Fifty hexes and the builds of twelve players on a phone screen. What minimum tile size stays readable? Do we need an "overview" mode distinct from a "close-up" mode?

2. **The build intents.** This is a display need that exists in no known digital board game: we must show that a player has *announced* a build, that it is not yet resolved, and that another player is contesting it. Then show the result: build validated, or **spot frozen** until the end of the cycle. How to make this understandable without overloading the board?

3. **Framing.** When the action takes place at the other end of the map, should we re-frame automatically, or signal the direction without moving the view? An automatic re-frame while a player is composing a trade would be painful.

> **Settled on 2026-08-30 — the opening frame.** It holds **the land and the ports, not the sea**: the archipelago sets a wide border of water, and holding it pushed the islands down to a third of the height on a phone. It **lays the board along the screen's long axis**, trying both orientations and keeping the one that **covers the most area** — and not the one that lets you get closest, which is the worse of the two: laid crosswise, an archipelago lets you get closer but is now just a band. Measured on the twelve-player board: 27.6 % of the screen versus 19.8 %.
>
> Automatic re-framing during the game stays ruled out. The player has **three explicit controls** — plus, minus, "Show all" — on the right edge, within thumb reach; "Show all" only appears when there is something to undo.
>
> **Still open**: framing straight onto the central island, where setup happens (contract §9), would fill the screen far better but would hide the secondary islands at start. That is a gameplay trade-off, not a framing one.

### 5.4 Zone ③ — The 12 players

**Content shown at all times, per player**: identity (colour + shape + pattern), nickname, public VP, number of cards in hand, public Influence, status (active / associated / passive), connection state.

**Content on click**: detail — buildings, controlled ports, development cards played, contracts in progress.

**Points of attention**:
- **Do not rely on hover**: half the players are on tablet or phone, where hover does not exist. Click/tap mandatory, hover as a bonus.
- The active player and the associated player must stand out immediately in the list.
- On a phone, how do we give access to 11 opponents without taking over the screen? Scrollable horizontal bar, drawer, dedicated view?

> **Settled on 2026-08-30 — neither: the twelve fit on one line.** The scrolling bar was tried and it fails: seventy pixels per player on a screen that offers three hundred and seventy-five gives three players visible out of twelve, and at twelve, knowing who is where *is* the game. On a narrow screen the **name gives way to the colour** — that is already the identity §2.2 gives the twelve players — and only the badge and the points remain. A tap opens the full card, with names.
>
> Active and associated are marked with a **solid rule at the foot**, not a background tint: at thirty pixels wide, a tinted background behind a coloured badge is no longer distinguishable — and this is precisely the cell where you are looking for who is playing.

### 5.5 Zone ④ — My hand

**Content**: resources by type with quantity, development cards, special tokens.

**Critical point**: the **hand-limit indicator**. In this game, players produce a lot but have few chances to spend (see §16 of the development plan). The hand limit will be reached often, and every 7 will trigger a discard. The player must see the danger coming **before** the dice roll, not suffer it.

### 5.6 Zone ⑤ — Action bar

**Content**: Build (road / settlement / city / trading post), Buy a development card, Trade with the bank, End action.

**Principle**: the available actions are computed by the server (capability system, §5.5 of the plan). The interface guesses nothing.

**Point of attention**: an unavailable action must not merely be greyed out, it must **say why** — "not enough brick", "it's not your turn", "spot frozen". That is what lets people learn the rules without the developer explaining all the time, which is an explicit exit criterion of the project.

> **Settled on 2026-08-30 — announcing is not a mode.** An "Announce" toggle sat next to the build choice; once armed, nothing on screen recalled it, and you clicked "Settlement" thinking you were building. The button now says itself what it does: out of turn, "**Announce a settlement**", with "end of cycle" underneath; in turn, "Settlement". An invisible state must not decide the meaning of a click — that is the same requirement as the paragraph above, applied to the action rather than to its unavailability.

### 5.7 Zone ⑥ — Trade

**The most important UX sub-project of the screen.**

The decisive context: **players are in the same room, negotiation is spoken.** Nobody is going to type "I give you 2 wood for 1 ore" — they say it out loud. The interface therefore does **not** serve to negotiate, but to **execute very quickly** a deal already agreed out loud, during a 30-second window.

```text
I give: [🌲] [🌲]           Marc offers you:
I want: [⛏️]                    2 🌲  ↔  1 ⛏️
To    : [Marc ▾]
                               [ACCEPT]  [DECLINE]
       [PROPOSE]
```

**Design questions**:
- How many actions to send an offer? The target should be two or three, not eight.
- Should the panel stay visible at all times, or only appear during the trade window?
- How to show several offers received simultaneously without drowning the player? At 12 players, in 30 seconds, several offers may arrive at once.
- How to signal that an offer has **lapsed** because one of the two players' inventories changed in the meantime?

> **Added on 2026-08-30 — the panel opens on what is missing.** Before the form, one line per buildable build: what is missing, and the first trade that would bring it closer — the cheapest resource to give up, at the current rate, ports included. Nothing that is not already on screen, but the subtraction is done, which nobody does in their head in thirty seconds.
>
> The bank rate is shown there as a **floor price**: that is what the neighbour has to beat. The panel is not for buying, it is for getting people talking — the lever the simulation puts at forty per cent fewer cycles.

### 5.8 Zone ⑦ — Log

**Content**: feed of recent events — production, builds, concluded trades, robber, resolved conflicts.

**Real use**: a player who was looking elsewhere for 20 seconds must be able to catch up on what happened. At 12 players, a lot happens per minute — the log must be filterable or ranked, otherwise it becomes an unreadable wall of text.

### 5.9 Modals

Four for the first version:

| Modal | Trigger | Constraint |
|---|---|---|
| **Discard on 7** | A 7 is rolled, my hand exceeds the limit | **The most critical** — see below |
| Moving the robber | I rolled a 7 or played a Knight | Selection on the board, choice of victim |
| Trade offer received | A player offers me a trade | May need to be an inline element rather than a modal |
| Conflict resolution | My announced build was decided | Feedback: won, lost, or spot frozen — and why |

Later: development card choice (Year of plenty, Monopoly), exploration reveal, secret objectives, barbarian attack.

**The discard modal deserves particular attention.** It triggers for **all affected players at the same time**, about ten times per game, and blocks the game's progress until the last one has finished. It is the main dead-time spike identified in the project — exactly what the whole design seeks to eliminate. Goal: discard achievable in under 10 seconds, with one-gesture selection, automatic suggestion, and automatic validation on timer expiry.

### 5.10 The four player states

Each state must be visually distinct and immediately recognizable:

| State | What I can do |
|---|---|
| **Active** | Everything: trade with all, build, buy, move the robber |
| **Associated** | Build, trade with the bank, buy — but not negotiate with the other players |
| **Trade window** | Negotiate with everyone for 30 s |
| **Passive** | Possibly announce a build, prepare my actions, observe |

A player must never have to wonder which one they are in.

---

## 6. Screen 6 — Game master panel

**Reserved for the host. Aesthetics not a priority, maximum efficiency.**

Development and playtest tool: give or take resources, force a dice roll, change phase, modify the timer, add VP, reveal a tile, place or remove a build, force a trade, move the robber, end the game.

**Reason for being**: reach in 10 seconds a game situation that would take 45 minutes of real play to reproduce. It will be heavily used during playtests. A simple dense side panel, as a list, is enough.

---

## 7. Open questions for the designer

These are the points where a designer's input will genuinely change the product:

1. **How to make obvious, at all times and without reading, what the player can do at this instant?** This is the project's question no. 1.
2. **How to show 11 opponents on a phone screen** while keeping the board usable?
3. **How to visualize the competing build intents and the spot freeze?** No known reference exists.
4. **Should the trade panel be permanent or contextual?**
5. **How to make the discard on 7 executable in under 10 seconds?**
6. **What visual differentiation between the active and associated roles?** Strong enough not to be confused, discreet enough not to dominate the screen.
7. **The palette of the 12 identities** — colour + shape + pattern, validated for colour-blindness.
8. **The timer**: how to create urgency without stress? Playtest feedback on this point is explicitly planned.

---

## 8. Expected deliverables and order

The order matters: the game screen conditions everything else, including technical feasibility.

1. **Low-fidelity wireframes of the game screen**, in three formats (laptop, tablet, phone), with the four player states. This is the deliverable that unblocks the project.
2. **Palette of the 12 identities** (colour + shape + pattern) with colour-blindness validation.
3. **Minimal design system**: typography, colours, spacing, buttons, modals, state badges.
4. **High-fidelity mockups of the game screen**, with the modals.
5. **Simple screens** (Join, Lobby, Host console, End of game) — quick once the design system is in place.

**What is not asked at this stage**: complex animations, illustrations (handled separately in [SPEC_ASSETS_IMAGES.md](SPEC_ASSETS_IMAGES.md)), a developed art direction. The game has never been played, even on a table — the design must stay cheap to change while the rules are moving.

---

*Document created on 2026-08-26.*
