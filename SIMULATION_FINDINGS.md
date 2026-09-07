# Simulation — first measurements

> Results of the bot simulation, 2026-08-27.
>
> Reproducible: `npx vitest run packages/sim`. All games are seeded, so replayable identically.
>
> Rules contract: [RULES_CONTRACT.md](RULES_CONTRACT.md) · Plan: [PLAN_DE_DEVELOPPEMENT.md](PLAN_DE_DEVELOPPEMENT.md)

---

## Main result

**The threshold of 15 victory points is currently unreachable.** No simulated game crossed it, at any player count, even after 200 cycles.

This is neither an engine bug nor a bot flaw: it is a property of the scale as implemented.

### The ceiling, calculated

§22 of the game design lists nine sources of points. **Only four exist** today:

| Source | Points | Implemented |
|---|---:|:--:|
| Settlement | 1 | yes |
| City | 2 | yes |
| Longest network | 2 | yes |
| Largest army | 2 | yes |
| Secret objective | 2 | **no** |
| Metropolis | 3 | **no** |
| Monument | 2 | **no** |
| Defender of Catan | 1 | **no** |
| Major exploration | 1 | **no** |

With the first four, a player's theoretical maximum is **13 points**: 4 cities (8) + 1 settlement (1), plus the two titles (4). In practice the simulation tops out around **12**.

---

## The real lock: the road allowance

The cause is not the one you would expect. It is neither resources nor spots that are lacking, but **roads**.

Typical state of a player at the end of a 200-cycle game, at 8 players:

```text
p4 : 9 VP  (1 settlement, 4 cities)
     reserve: 4 settlements, 0 city, 0 ROAD
     available settlement spots: 0
```

The player still has four settlements in reserve and cannot place them: they have not a single road left to reach a legal spot. The distance rule requires two edges between two builds, and **fifteen roads are not enough** to serve nine buildings on a board of this size.

Resources, on the other hand, are plentiful: the simulation observes average hands of 9 to 11 cards and around a hundred discards per game.

---

## What the simulation fixed along the way

**The bots did not trade with the bank.** A hand of ten cards spread over five types almost never contains the three ore of a city: the bots piled up without ever assembling a precise cost. Adding the 4:1 stopgap trade took concluded games from 1/5 to 4/5 at the threshold of 10.

This is a lesson that holds beyond the bots: **at twelve players, access to trade conditions expansion far more than at four**. The ports, not yet implemented, will therefore be more decisive here than in a classic Catan.

---

## Measurements by player count

200-cycle games, greedy bots, threshold lowered to 10 points so that games conclude.

| Players | Active turns per player | Average hand | Hand peak | Discards |
|---:|---:|---:|---:|---:|
| 4 | 49 | 9.3 | 72 | 56 |
| 8 | 24 | 9.5 | 28 | 104 |
| 12 | 16 | 11.3 | 39 | 102 |

The peak of 72 cards at 4 players illustrates a point of §16 of the plan: **the hand limit only applies on a 7**. Between two 7s, a hand can swell without bound. At four players on a board sized for twelve, production far exceeds the chances to spend.

---

## Fixes applied and second round of measurement

Two of the three levers were pulled on 2026-08-27.

**Secret objectives implemented.** Five of them are measurable today — architect, city builder, colonizer, master builder, warlord. The other three of §21 are declared but unavailable: a player must never draw an objective the engine cannot evaluate. Each player receives two and keeps only one; in the absence of a choice, the first is authoritative — same principle as the automatic validation of §2 of the contract.

**Road allowance raised from 15 to 20.** That was the measured lock.

### Result

**The threshold of 15 has become reachable again.** Before fixes: no game, at any player count. After:

| Players | Games concluded | Average cycles |
|---:|---:|---:|
| 4 | 3 / 6 | 242 |
| 6 | 2 / 6 | 226 |
| 8 | 2 / 6 | 149 |
| 10 | 2 / 6 | 206 |
| 12 | 3 / 6 | 240 |

### A measurement bug, fixed along the way

The simulator recomposed the score by hand and **forgot the secret objective**, underestimating every total by two points. The count now goes through a single function, `playerPoints`, which includes titles and objective. It is also the one the client will have to use: recomposing a score elsewhere condemns you to forget part of it.

### A second bug, more serious

`xxlOptionsFor(4)` returned **44 hexes — the twelve-player board for a four-player game**. Each player touched only six tiles out of forty-four and almost never produced. Below eight players, the simulator now uses the classic board, in line with §2 of the game design which reserves Grandes Colonies for player counts of 8 to 12.

---

## The next problem: duration

This is now the most glaring gap, and it is important.

The target of §2 is **120 to 160 minutes**. At two minutes per cycle, that allows about **60 cycles**. The measurements demand **150 to 240**, i.e. **five to eight hours** of play.

In other words: the game is winnable, but **four times too slowly**. And one game in two still does not conclude within the 300-cycle limit.

### What could close the gap

Several missing systems are precisely accelerators, which makes the current measurement pessimistic:

- **the ports** — the simulation has already shown that access to trade conditions expansion; 4:1 is a punitive rate;
- **trade between players**, the heart of the game according to §37, entirely absent;
- **the metropolises** (3 points), **monuments** (2), **exploration** and **defense** — four sources of points still absent from the scale;
- **semi-simultaneous building**, implemented but which the bots never use.

It would be premature to retouch the costs or the victory threshold before having measured with these systems: we would be correcting an imbalance that will no longer exist.

---

## What needs to be settled

Three levers, not mutually exclusive.

**Implement the secret objectives.** They are worth 2 points and §39 already plans them in the first playable version — they are therefore not an addition but an oversight. They lift the realistic ceiling from 12 to 14, which is still just under the threshold.

**Increase the road allowance.** It is the measured lock. Going from 15 to 20 roads per player directly loosens expansion, without touching the scale.

**Lower the victory threshold.** At 12 points, games conclude with the current scale. It is the simplest lever, but it contradicts the intention of §22, which justified 15 by the size of the map.

> My recommendation: **the first three first, the threshold as a last resort.** The threshold of 15 is not arbitrary — it comes from the size of the board. Lowering it would treat the symptom rather than the cause, which is an incomplete scale and a road allowance modelled on a four-player game.
>
> **Update of 2026-08-27:** the first two levers were pulled and were enough to make victory reachable. The threshold stays at 15. The next measurement will only make sense after the implementation of ports and trade between players.

---

## Third round: ports and trade between players

Implemented on 2026-08-27, with 22 dedicated tests.

**Ports** — generic at 3:1, specialized at 2:1, plus the trading port of §11 that gives 2:1 on any resource. They are placed on **spaced** coastal corners: two adjacent ports would be captured by a single settlement, which would give a decisive advantage to the first player to place it.

**Trade between players** — named or open offers, atomic acceptance, expiry at end of cycle.

### What the measurement showed

With bots accepting freely, concluded games shortened by **40 %** — from 159-240 cycles to 101-126. Trade is therefore indeed the lever expected by §37.

But the result proved **very sensitive to the bots' negotiation policy**. Three successive settings gave acceptance rates of 73 %, 8 % then 14 %, and conclusion rates ranging from 1/6 to 4/6 with no clear correlation.

> **Methodological conclusion: the bots have become the limiting factor, not the game.** Continuing to tune them would measure my heuristics rather than your design. The next balancing conclusions require either markedly better bots, or — and it is faster — a human playtest.

### A gap in the contract, revealed by the tests

The contract granted the active player the right to negotiate during their turn, but did not say **who could respond to them**. Restricting the response to the active player alone made the rule empty: an offer with no possible counterparty is useless. Settled and recorded: during the turn, a trade is admissible as long as the active player is one of the two parties.

---

## Fourth round: cards played, metropolises, monuments

Measured on 2026-08-27, after making the four inert development cards playable and implementing metropolises and monuments.

### A measurement error, first

The bots **bought** development cards without ever **playing** a single one. The consequence went beyond the cards: the largest army was **never** awarded, and two victory points existed in no balancing measurement. Every previous round was therefore about an amputated game.

The bots now play their cards and build metropolises and monuments. The simulator also returns the **breakdown** of points and no longer just the total: a total alone does not say that a source is dead, and that is exactly what had slipped through.

### Are the sources of points alive?

Over 12 games per player count:

| Source | 8 players | 12 players |
|---|---:|---:|
| Largest army awarded | 10 / 12 games | 12 / 12 |
| Longest network awarded | 12 / 12 | 12 / 12 |
| Secret objectives fulfilled | 22 players | 35 |
| Monuments raised | 22 | 53 |
| Metropolises built | 3 | 9 |

**The monument works as expected**: it is the way out for the blocked player, and it is heavily used. **The metropolis, no** — three are available per game, fewer than one is taken. Its ratio is the worst in the game: one net point for seven resources, two of them gold. To decide: raise it to 4 points, or lighten its cost.

### Victory is now reachable

| Player count | Games concluded | Median cycles |
|---|---:|---:|
| 8 players | 16 / 16 | 175 |
| 10 players | 15 / 16 | 189 |
| 12 players | 15 / 16 | 198 |

Against roughly one game in three before.

---

## Duration: the error was in the target

The previous round concluded "four times too slow". That calculation rested on a confusion that must be corrected.

**Two minutes per cycle is a ceiling, not a duration.** It is the 90 seconds of the active turn plus the 30 of the trade window — expiry delays. A player who rolls, builds and passes the hand finishes their cycle in far less than that. Dividing 120 minutes by this ceiling to get "60 cycles" amounts to assuming every player systematically uses up their timer.

What the measurements give according to the average duration actually observed at the table:

| Cycles | at 40 s | at 60 s | at 90 s | at 120 s (ceiling) |
|---:|---|---|---|---|
| 120 | 1 h 20 | 2 h 00 | 3 h 00 | 4 h 00 |
| 160 | 1 h 47 | 2 h 40 | 4 h 00 | 5 h 20 |
| 190 | 2 h 07 | 3 h 10 | 4 h 45 | 6 h 20 |

### The victory threshold, quantified

Same game, same seed, only the threshold changes:

| Threshold | 8 players | 12 players |
|---:|---:|---:|
| 10 points | 128 cycles | 126 |
| 12 points | 147 | 167 |
| 13 points | 150 | 167 |
| 15 points | 175 | 198 |

The relationship is not linear: going from 15 to 10 points only removes 35 % of the cycles. The start of the game is slow whatever the threshold, because production only starts with the first settlements.

> **Recommendation.** The threshold of 15 stays tenable if a cycle really lasts one minute on average: about 3 h 20 at twelve players, above the target but within the domain of an evening. Dropping to 12 points would bring it to 2 h 47 without distorting the race.
>
> **But these figures are still bot figures.** They do not plan, do not haggle, and never announce a build out of turn — the most differentiating mechanic in the game. A human builds faster. It is a **speed floor**, therefore a **duration ceiling**: the real game will be shorter. I am not touching the threshold before the playtest.

---

## Fifth round: the archipelago

Measured on 2026-08-27, after making the sea lanes buildable and introducing the archipelago board of §4.

### Another amputated game

Same error as for the development cards, and spotted the same way. The first trials on the archipelago gave **zero exploration** and a collapsed conclusion rate: the bots built no sea lane and stayed prisoners of the central island, smaller than the old disc.

They now know how to navigate, and prefer the sea lane to the road as soon as their island offers no more spots. Without this switch, a land road was almost always affordable, therefore always preferred, and no game ever left the starting island.

### The central island's share, measured

Twenty-four games per line, same bots, same seeds.

| Board | 8 players | 12 players | Explorations |
|---|---|---|---|
| Disc | 23/24 concluded, 170 cycles | 23/24, 138 cycles | 0 |
| Archipelago, central island at 55 % | 19/24, 221 cycles | **6/24**, 262 cycles | 14 and 19 |
| Archipelago, central island at 75 % | 22/24, 192 cycles | 21/24, 216 cycles | 11 and 15 |

At 55 %, the secondary islands lock too much terrain behind the sea: at twelve players, six games out of twenty-four manage to conclude. The share is therefore fixed at **75 %**, measured rather than chosen.

### The cost of the archipelago

Even at 75 %, the archipelago lengthens the game: **216 cycles versus 138** at twelve players, i.e. about 3 h 36 versus 2 h 18 at one minute per cycle. It is the price of the crossings, and it is real.

The two boards therefore stay available. The archipelago is the default — it is the structure of §4, and the only one where exploration means something — but `BOARD=disque` launches a shorter evening.

> **The same caveat as in the previous rounds applies, and more strongly.** The bots cross badly: they only embark once blocked, and follow the first edge that comes rather than aiming for an island. A human player prepares their crossing. The measured gap between disc and archipelago is therefore an upper bound, not a prediction.

---

## Limits of these measurements

- The bots are deliberately simple: they build in order of point value and plan nothing. A human would expand better and would probably reach a few more points.
- Trade between players is now simulated, but with a very crude bot policy: two surplus cards for one missing card, without haggling. A human player would negotiate far better.
- The barbarians are not in the engine: the defender tokens stay inert in the scale. Major exploration, meanwhile, is now awarded — one point to the first player to place a settlement on a secondary island.
- The face-down hexes of §13 — rare resources, neutral villages, events, dangerous zones — are not implemented: eight kinds of tiles remaining to be designed.
- Semi-simultaneous building exists in the engine but the bots do not use it: they never announce out of turn. It is today the biggest mechanic absent from the measurements.
- The bots do not choose their secret objective: they keep the one the engine assigns them by default, without checking whether it fits their position.

These measurements therefore say where the **floor** is, not the real ceiling of the finished game.

## Board scales — space shortens the game

`scripts/echelles.ts`, 16 games per line, greedy bots, archipelago, 600-cycle safeguard.

| Count | Scale | Land | Hexes | Islands | Concluded | Cycles (median) | Winner's points |
|---|---|---|---|---|---|---|---|
| 12 | normal | 48 | 168 | 3 | 13/16 | 185 | 14.9 |
| 12 | large | 77 | 254 | 5 | **16/16** | **130** | 15.3 |
| 12 | huge | 115 | 335 | 6 | **16/16** | **124** | 15.1 |
| 8 | normal | 44 | 143 | 2 | 15/16 | 211 | 15.3 |
| 8 | large | 70 | 207 | 3 | 16/16 | 146 | 15.2 |
| 8 | huge | 106 | 310 | 5 | 16/16 | 121 | 15.7 |

We expected the opposite: more land, more travel, therefore longer games. It is the reverse, and markedly so. At twelve players on forty-eight land tiles, the table is **clogged** — legal spots grow scarce, settlements block each other, and three games out of sixteen do not conclude within six hundred cycles. Give some space and everyone builds: builds per player go from 12.1 to 16.6, and the game concludes.

The victory point stays won, not conceded: the winner finishes around 15 points at every scale, never on exhaustion of the safeguard.

The disc follows the same slope, more tamely — it has no islands to link, so less travel to save: 143 cycles at normal, 119 at large, 135 at huge, sixteen games out of sixteen everywhere.

### The road allowance does not follow the board size

We had scaled it up in anticipation, on the idea that a larger board would demand more roads. The measurement said no:

| Scale | 20 roads | 30 roads |
|---|---|---|
| normal | 13/16, 185 cycles | 16/16, 155 cycles |
| large | 16/16, 130 cycles | 16/16, 136 cycles |
| huge | 16/16, 124 cycles | 16/16, 148 cycles |

On a large board, more roads brings nothing closer: it disperses, and the game lengthens. The scaling was therefore removed.

On the other hand the first column reads the other way: **on the normal board, twenty roads still constrains** — thirty would take twelve players from 13/16 to 16/16 and save thirty cycles. It is a tuning of the base balance, left as is for lack of having been asked, but it deserves to be revisited.

---

## Sixth round: the dynamic market

`scripts/marche.ts`, archipelago at normal scale, greedy bots, 600-cycle safeguard. The control is the old game — flat rate at 4:1, step out of reach — which makes the two lines strictly comparable.

Three questions, in the order in which they could kill the mechanic: does the rate **live**? Does it run away? Does it cost the game?

### A first misleading measurement

Over sixteen games, the market seemed costly: 236 cycles versus 191, i.e. **+24 % duration** at twelve players, on the game whose duration is already the known problem. Enough to call the mechanic into question.

Over forty games, the gap disappears:

| Count | Market | Concluded | Cycles (median) | Winner's points | Builds/p |
|---|---|---|---|---|---|
| 12 | frozen 4:1 | 34/40 | 189 | 15.0 | 12.3 |
| 12 | **§10** | **36/40** | **191** | 15.2 | 12.2 |
| 8 | frozen 4:1 | 39/40 | 178 | 15.3 | 14.0 |
| 8 | **§10** | **40/40** | **183** | 15.2 | 14.0 |

Two cycles at twelve, five at eight: below the noise. Concluded games even gain two points out of forty. The +24 % was a sampling artefact — one more measurement that this document must correct before drawing a conclusion, and the same lesson as the previous ones: **sixteen games are not enough to tell two close settings apart.**

### The rate lives, and it saturates

The average amplitude — by how many notches the most mobile rate has moved — comes out at **2.8** on a range of 2 to 6. The market is therefore not a disguised scale: it traverses almost its entire span in one game.

But **3.4 rates out of 6 end up stuck against a bound**. The first attempt was worse, at 4.8, because the balance carrying the rate ran without limit: wood sold four hundred times demanded four hundred purchases to lift off its ceiling, which never happens. Bounding the balance one notch beyond the rate brought saturation back to 3.4 and made the recovery possible in one step.

The remaining 3.4 come down to the bots, and it must be said clearly: they always sell the same structural surplus — wood and wool — and always buy the same structural shortage — ore and wheat. Nothing in their policy reacts to price. A human player who sees wood at 6 stops selling it and goes to negotiate at the table, which is precisely the intended effect.

### The limit of this reading

The rate only charges the resource **given**. Seeing it drop to 2 on ore therefore does not make ore easier to obtain: it only benefits whoever has a surplus of it, i.e. no one. The "a resource that is scarce sees its price rise" half of §10 thus weighs markedly less than the other.

That was the price to pay so that the ports keep their meaning: in the box, a wood port gives 2 wood for anything. Charging the resource received would have inverted the meaning of every port on the board.

### What remains to be measured

- The market has never been measured **with human players**, who are the only ones able to react to a price. All the values above describe a table that does not look at the board.
- The bank trades per game barely move (273 versus 279 at twelve): the bots pay more without trading less. A human should turn away from the bank — it is the central hypothesis of the device, and it remains to be verified.
- The step of 4 and the range 2–6 have only been compared to two variants, over sixteen games each — so over noise. To revisit at forty if the setting is called into question.

---

## Seventh round: the contract ports

`scripts/ports.ts`, 40 games per line. The control removes the two ports from the board **after generation**: same land, same tokens, same other ports, only the coastline changes.

| Count | Board | Concluded | Cycles (med.) | Winner's points | Builds/p | Via port | Via bank |
|---|---|---|---|---|---|---|---|
| 12 | without contracts | 35/40 | 212 | 14.9 | 12.1 | 0 | 317 |
| 12 | **§11** | 35/40 | 209 | 15.0 | 12.2 | 5 | 316 |
| 8 | without contracts | 40/40 | 181 | 15.2 | 13.8 | 0 | 114 |
| 8 | **§11** | 40/40 | 189 | 15.2 | 13.9 | 7 | 116 |

**The commercial port is used, and unbalances nothing.** Five to seven conversions per game, no measurable effect on duration, the number of builds or the winner's score. The fear was that an unconditioned 2:1 would become the best rate in the game handed to whoever places a settlement in the right spot; the constraint of the two different kinds brings it back into place.

### What these figures do not say

- **The mining port is not measured at all.** Zero use: the bots never touch it. Gold only serves the metropolis, and a bot that hoarded it without being able to build would block its hand. It is a known gap, not an oversight — but it means that the market exemption of §11, the most debatable decision of the lot, has only been validated by reasoning.
- **Five uses per game is little**, and it is the floor: the port belongs to only one player, and that player is a bot that only touches it when it can no longer build anything. A human who held that port would go and use it.
- The royal port does not exist: it awaits Influence.

---

## Eighth round: opponents that play

The seven previous rounds measured the game with bots that built in order of point value without ever looking at a token, without a plan, without proposing a single trade. It was deliberate — they were there to run thousands of games, not to play well. But it left a question open: **was what we were measuring the game, or the bots' clumsiness?**

The `sim` package now carries a full pilot (`packages/sim/src/pilote/`), with four levels and six characters. It receives only a player's public view and private view — not the `GameState` — and it is **exactly the same code** that plays over the network on game night and that runs here in simulation.

### The level scale

`scripts/adversaires.ts`, 48 six-player games, seats alternated from one game to the next so that turn order skews nothing.

| Duel | Wins | Average points | Cycles |
|---|---|---|---|
| level 2 vs the old bot | **48 — 0** | 10.5 vs 2.7 | 108 |
| level 2 vs level 1 | **43 — 0** | 10.7 vs 3.7 | 150 |
| level 4 vs level 1 | **43 — 0** | 11.1 vs 3.7 | 152 |
| level 3 vs level 2 | **20 — 16** | 9.9 vs 9.1 | 193 |
| level 4 vs level 3 | **32 — 27** ¹ | 10.0 vs 9.8 | 183 |

¹ combined over two seed families, 80 games: 15 — 17 on one, 17 — 10 on the other. The gap between the two says what the measurement is worth — at around thirty games decided per family, a close duel is not settled.

**The scale is not even, and that is the most useful fact of the round.** Between the first and the second level there is a chasm: forty-three to zero. Between the third and the fourth, barely an edge. What the second level adds — weighing spots, aiming for a precise cost — is worth more than everything that comes after.

It is first the measurement of what **setup** costs. A settlement placed on the first corner in the list, sorted by identifier, falls on average on mediocre tokens, and the game is lost before the first roll. Nothing a player does afterwards recovers it.

### The kingmaker problem, quantified

The fourth level was meant to stand out by targeting the leader: robber placed on them, and no more trades that suit them. Measured, it **lost** against the third — eight wins to fifteen over thirty-two games — where the same level simply targeting the biggest hand won fourteen to nine.

The move is table-optimal and individually costly: the robber placed on the leader brings nothing to whoever places it, it does the other ten a favour. It is the kingmaker problem, and it is not solved by ceasing to slow down whoever is winning — a game where no one slows them down is decided on the fifth cycle. It is solved by slowing them down **only when it is urgent**: when they are four points from the goal, or have taken a three-point lead. With this condition, targeting the leader no longer costs anything — thirteen to thirteen against the greedy aim — and the behaviour stays visible at the table.

### Three mechanics come out of the shadows

Four six-player games at level 4, events counted:

| Mechanic | Before | Now |
|---|---|---|
| Choosing the secret objective | never done | 24 of 24 (all players) |
| Announcements out of turn (§8) | never played | 46 placed, 46 completed, 0 refunded |
| Mining port (§11) | zero use | 1 — against 148 for the commercial port |
| Monopoly | played on what is missing | 19, aimed at what the table holds |
| Metropolises built | rare | 6 |

The mining port therefore stays **a rare port rather than a dead port**: an opponent only uses it when aiming for a metropolis and short of gold. The market exemption of §11 is still not validated by the figures.

### Out-of-turn announcements do not add builds, they bring them forward

Twelve games with and without, everything else equal: **91 builds versus 92**. Same total, earlier. The mechanic of §8 therefore does not make a table build more, it shifts what it would have built anyway — which is exactly what it promised, and what had never been verified for lack of a bot that exercises it.

A methodological warning, learned along the way: two bot variants do not play the same game at equal seed. They consume randomness differently, so they diverge from the first draw. A first measurement gave the announcements eighty cycles of lag; the same measurement, after other unrelated tuning, gave them twenty-five cycles of lead. Only quantities **accumulated over many games** — builds, wins — resist this; the duration of a single game does not.

### Level and the length of an evening

48 games per line, at 6 players, all seats at the same level:

| Level | Cycles | Concluded | Offers (accepted) | Bank | Announcements | Discards |
|---|---|---|---|---|---|---|
| 1 — Apprentice | 229 | 38/48 | 0 | 148 | 0 | 26 |
| 2 — Settler | **192** | 36/48 | 324 (26 %) | 164 | 0 | 48 |
| 3 — Seasoned | 206 | 34/48 | 362 (19 %) | 182 | 13 | 57 |
| 4 — Strategist | 209 | 34/48 | 362 (17 %) | 215 | 14 | 56 |

A strong table plays a little longer than an average table, and concludes a little less often. The cause is not skill: it is that everyone advances, the board fills up, and a player who has placed their five settlements, their four cities and their monument tops out around thirteen points, titles included. The game then stops progressing **for lack of space**, and not for lack of resources — the same wall the round on board scales had already hit.

For the host, the consequence is practical: at a high level, plan for more land or lower the victory threshold. It is said on their screen, under the dials.

### The trade acceptance rate

19 % of offers complete, against 3 % in the first version of the pilot. The fix was not to propose more but to **judge an offer on a continuous value** rather than by a binary threshold. The first version only accepted what exactly filled the targeted cost: the table proposed non-stop and never traded. A card is worth what it is worth — the gap in the plan first, the terrain shortage next, almost nothing when you already have five — and two cards for one then pass almost always.

### What these measurements still do not say

- **The floor, not the ceiling.** A strategist looks one move ahead, never two. It does not bluff, does not form coalitions, and never forgoes a trade to stop another from making one.
- **Simulated games do not know time.** The pilot always decides before timer expiry; on game night, the thirty-second trade window constrains everything differently.
- **Six characters do not make six human styles.** They make six sets of weights, which is enough to tell them apart at the table — the merchant places 1382 offers where the corsair places 395 — but not to imitate someone.
