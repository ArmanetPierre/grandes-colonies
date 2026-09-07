# Grandes Colonies

A digital version of a Catan variant for **8 to 12 players**, playable over a
local network: the server runs on one PC, and everyone joins from their own
browser.

---

## Running a game night

```bash
npm install
npm run play
```

The terminal then prints:

```
  Host screen  http://192.168.1.34:2567
  Players      http://192.168.1.34:5173
  Code         AMPHORE-46
  Board        archipelago, 44 land tiles
  Seats        8
  Log          /path/to/grandes-colonies/parties
```

**Open the host screen on the PC** (the first address). It shows a QR code and
the address to hand to your guests, and fills up as they arrive.

**Guests scan the QR code**, type their first name, and wait. They can arrive
in any order.

**When everyone is in, click "Start the game"** on the host screen. You can
start without waiting for latecomers: their seats will be played at the
minimum, and they take their place back when they arrive.

`Ctrl+C` stops everything.

### During the night, on the host screen

**Pause** suspends everything: the timer, the turns played automatically, and
player commands. A veil is drawn over the table screen so the whole room
understands at a glance why nothing is moving anymore. The remaining time is
handed back untouched when play resumes — pausing neither steals nor grants
time.

**+30 s** extends the current phase, when the table is still negotiating.

**Hand over to a bot** appears on the card of a player who has been gone for
two rounds of the table. Without this action, the game waits for them
indefinitely: their turn is played at the minimum, cycle after cycle, and
their position stops moving. The leaver's reconnection token is invalidated —
giving up your seat means giving it up for good.

### Game master mode

The **Game master** button opens a panel on the host screen: give or take
resources, force the next roll, push the barbarian track or trigger the
invasion, crown a player.

It is there for playtests. Reproducing a bug that only shows up at fifteen
points otherwise meant playing forty-five minutes on every attempt.

These actions ignore the phase, the turn and resources — that is their whole
point. The safeguard is elsewhere: the panel lives on the host's port, which
guests do not know, and the players' WebSocket refuses any `GM_` command
whatever the client. They are logged like the others: a rigged game replays
rigged.

### Measuring a game

```bash
npx tsx scripts/mesures.ts            # the most recent game
npx tsx scripts/mesures.ts parties/partie-xxx.jsonl
```

Duration, cycles, median cycle, trades proposed and accepted, build
announcements, turns played automatically, and per player: their actions and
above all their **longest wait**. That is the one that matters — with twelve
players you are bound to wait, and a total idle time would say nothing,
whereas the longest wait pinpoints the exact moment someone checked out.

The host screen serves the same figures on `/api/metrics`.

Everything is replayed from the log, not from live counters: a question you
had not thought to ask during the game — "how long between an announcement and
its resolution?" — can be answered afterwards, on games already played.

### If the server goes down

Every game writes its log to `parties/`: the seed, the configuration, and the
ordered sequence of commands, timestamped. Since the engine is deterministic,
that is enough to replay the game identically.

```bash
REPRENDRE=parties/partie-1787966450972-0.jsonl npm run play
```

The game comes back **paused**, exactly where it stopped, player names
included. Everyone reopens the link and takes a seat again — the reconnection
tokens died with the previous process — then the host resumes.

The file is line-delimited JSON, appended as it goes: a power cut only damages
its last line, and the replay ignores it.

### Options

| Command | Effect |
|---|---|
| `PLAYERS=8 npm run play` | Eight players instead of twelve |
| `BOARD=disque npm run play` | Disc board: a shorter night (≈ 2 h 20 instead of 3 h 30 at twelve) |
| `BOTS=11 npm run play` | Eleven automatic opponents, one seat for you |
| `BOT_NIVEAU=1 npm run play` | Beginner opponents, from 1 to 4 (3 by default) |
| `BOT_CARACTERE=corsaire npm run play` | All of the same character, instead of a mix |
| `TERRES=72 npm run play` | Seventy-two land hexes. Also adjustable from the host screen, from 19 to 130, independently of the player count |
| `REPRENDRE=parties/xxx.jsonl npm run play` | Resumes an interrupted game where it stopped |
| `PARTIES= npm run play` | Writes no game log |

---

## The automatic opponents

They go through the same WebSocket as the players and only see what a player
sees: their public view and their private view. **They cannot cheat** — the
board geometry and everyone's inventories are public, and that is all they
use.

Two settings, independent of each other, are adjusted from the host screen
while the room fills up.

### Level — what they know how to do

| | | |
|---|---|---|
| **1** | Apprentice | Plays legal moves without weighing them. Loses without a grudge. |
| **2** | Settler | Looks at the number tokens before placing, builds in order of value, proposes simple trades. |
| **3** | Seasoned | Works its ports, announces out of turn, plays its cards to the point, addresses its offers to those who can honour them. |
| **4** | Strategist | Slows the leader down the moment they near the goal, contests spots, keeps its hand under the limit. |

The scale is measured, and it is not even. Over forty-eight six-player games
with alternating seats: the **settler beats the apprentice forty-three to
zero**, and the old bots forty-eight out of forty-eight. But the seasoned bot
only beats the settler twenty to sixteen, and the strategist beats the
seasoned bot by a hair. **What level 2 adds — weighing spots, aiming for a
precise cost — is worth more than everything that comes after.**

A strong table plays a little longer: everyone advances, the board fills up,
and it is space — not skill — that then decides the length. At a high level,
plan for more land tiles or lower the victory threshold.

### Character — what they want

Six of them, dealt in rotation so that none is missing and none shows up five
times. The bot's name carries it: **Ariane (trade)** will haggle.

| | |
|---|---|
| **Builder** | Takes ground early and holds it: settlements, roads, then cities. |
| **Merchant** | Proposes non-stop, occupies the ports, and lives off the market rate rather than the dice. |
| **Corsair** | Knights, the robber on the leader, and the spots someone else was eyeing. |
| **Navigator** | Leaves the central island early, even at the cost of a turn's lead. |
| **Scholar** | Buys cards, aims for the monument and the metropolis, and bides its time. |
| **Cautious** | Never holds ten cards, prefers a safe city to an exposed settlement. |

It is not window dressing: over three measured games the merchant places 1382
trade offers and the corsair 395; the builder announces eighty builds out of
turn, the scholar none.

Their brain lives in [`packages/sim/src/pilote/`](packages/sim/src/pilote/),
and it is **exactly the same** in simulation and on game night: what gets
tested over ten thousand games is what sits down at the table.

```bash
npx tsx scripts/adversaires.ts     # duels by level, whole tables
```

---

## During the game

A **cycle** is one player's turn. The active player rolls the dice and builds;
the **associated** player — three seats away — plays at the same time. Everyone
produces on every roll, trades during the trade window, and can **announce a
build out of turn**, which resolves at the end of the cycle.

The bank has no fixed price: each resource has a **rate** that rises when the
table dumps it and falls when it grows scarce. The strip of numbers above the
trade area gives it, port included, with an arrow when it is about to move.

A player who refreshes their page **gets their seat back**. An absent player
has their turn played at the minimum rather than blocking the table.

**The documentation:** [docs/index.html](docs/index.html) — fifteen pages
explaining the world, the rules and the mechanics of the game (in French).
Open it in a browser, without running anything.

**The rules alone, for players:** [docs/regles.html](docs/regles.html) — the
manual on one page, to send to your guests before the night (in French).

The decisions made where the original game was ambiguous are recorded in
[RULES_CONTRACT.md](RULES_CONTRACT.md), which is authoritative over the code.

---

## If something is stuck

**"The game is full" when nobody has joined.**
A Grandes Colonies tab left open takes its seat back on every restart. Close
the stray tabs, or restart the server.

**A guest cannot connect.**
Check that they are on the same Wi-Fi network. The address must be the
`192.168.x.x` one, not `localhost`.

**The port is already taken.**

```bash
lsof -ti:2567 -ti:5173 | xargs kill -9
```

---

## Development

```bash
npm test          # 512 tests
npm run typecheck # the six packages
npm run assets    # brings the generated images within the client's reach

node docs/tisser.mjs        # reassembles the documentation from docs/_pages/

npx tsx scripts/marche.ts       # measures the market against a frozen rate
npx tsx scripts/ports.ts        # measures contract ports against a coastline without them
npx tsx scripts/adversaires.ts  # ranks the four opponent levels
```

The board is rendered in Three.js, in
[`packages/client/src/ui/board3d/`](packages/client/src/ui/board3d/): the tiles
are hexagonal prisms whose surface is sculpted — the mountain has a peak, the
hill a ridge, the field barely ripples — the sea is an animated sheet, and the
pieces are solids. The relief is described terrain by terrain in
[`board3d/relief.ts`](packages/client/src/ui/board3d/relief.ts), under a
constraint that governs the whole file: **a tile's edge is flat and almost at
the same level as its neighbours**, because roads run along the edges and
settlements sit on the corners. All the volume is at the centre. Everything is
instanced — a twelve-player game fits in about thirty draw calls, which leaves
a low-end phone at sixty frames per second. One finger moves the map, two
fingers zoom and rotate it, a tap builds — and three buttons on the right edge
do the same thing without a gesture, because a missed pinch left the player
with no recourse.

The framing holds **the land, not the sea**, and lays the board along the
screen's long axis: on a phone held upright, holding the archipelago's sea
border pushed the islands down to a third of the height. Both orientations are
tried and it is **the area covered** that decides, not the distance reached —
laid crosswise, an archipelago lets you get closer but is now just a band.

What moves answers a question the screen was asking without answering. A piece
that is placed **falls from the sky** and kicks up a little dust: with twelve
players, where you build out of turn, a road that appeared silently went
unnoticed. A hex that produces makes **its token jump**, and the cards won
**fly to their pile** in the bottom bar: the amount comes from the server, the
path says where it comes from. The curves are gathered in
[`board3d/chute.ts`](packages/client/src/ui/board3d/chute.ts), and all of them
fall silent under `prefers-reduced-motion`.

The **roll is played on the board**. The button stays where it was — it is the
one that sends the order to the server — but the two dice fall from the sky at
the centre of the map, roll, collide, stop, and the number rolled rises above
them large, long enough to read from across the room.

They fall for real: `board3d/physique.ts` is a small rigid-body solver —
gravity, contacts through the eight corners, bounce, Coulomb friction — and
not a disguised curve. **How does a freely falling die land on the number the
server drew?** Through the cube's twenty-four symmetries. We simulate an
honest fall without knowing what it will give, look at which face stopped
facing up, then rotate the die's *paint* — not its trajectory — so that the
wanted number is the one looking at the sky. Same impacts, same bounces, same
stop: the die was not deflected by a millimetre, it was repainted. The client
never draws anything; the engine remains the sole judge, and the image cannot
lie about the state of the game.

The whole roll is computed at release, in a fraction of a millisecond, then
replayed frame by frame — which lets us know the face before showing it, know
where to place the total, and throw nothing off when a frame is dropped. The
computation uses only the four operations and a square root, exact to the bit:
at equal seed — cycle, active player, two numbers — the twelve screens compute
**the same** roll, which is half the point of showing it on the table. The
rest of the interface takes its cue from it: the banner only gives the total
once the dice have settled, the tokens only jump after that, and a seven's
discard waits its turn.

The images live in `assets/generated` and the client serves them from its
`public` folder, which is not versioned: `npm run play` makes the copy, and
`npm run assets` remakes it on demand. Without it, the board displays without
its terrains.

| Package | Role |
|---|---|
| `packages/engine` | The rules. Depends on neither the network nor the browser. |
| `packages/protocol` | The public and private views, and event serialization. |
| `packages/server` | Seats, timers, reconnection, WebSocket transport. |
| `packages/client` | The players' screen (React), and the 3D board. |
| `packages/sim` | The automatic opponents, and the simulation that measures them. |
| `apps/host` | The host's screen: QR code and start. |

The **dynamic market** of §10 is wired in: the bank rate is no longer the
constant 4:1 but a per-resource rate, which moves by one step every four
transactions and which ports discount instead of replacing.

Two **contract ports** from §11 are added, sown once per board: the mining
port smelts 2 ore into 1 gold, the trading port converts 2 resources of
different kinds into 1 of your choice. Their prices are fixed — the market
does not touch them, which makes them valuable exactly when it runs hot.

The decisions are in §10 and §11 of
[RULES_CONTRACT.md](RULES_CONTRACT.md), the measurements in the sixth and
seventh rounds of [SIMULATION_FINDINGS.md](SIMULATION_FINDINGS.md).

What is left to do is listed in
[SIMULATION_FINDINGS.md](SIMULATION_FINDINGS.md) — notably the barbarians,
Influence — on which the royal port of §11 depends — the contracts and the
face-down exploration hexes, which are not implemented.
