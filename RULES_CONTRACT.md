# Rules Contract v1 — Grandes Colonies

> The exact rules for the concurrent mechanics, settled as of 2026-08-27.
>
> This document exists because game design describes **intentions**, not edge cases. Coding a simultaneous mechanic without having written its rule amounts to inventing it by accident — and to having to unpick it once you realize it did not match the intention.
>
> It is authoritative over the code. In case of disagreement between this document and the engine, the engine is wrong.
>
> Game design: [Catan_Grandes_Colonies_8-12_joueurs.md](Catan_Grandes_Colonies_8-12_joueurs.md) · Plan: [PLAN_DE_DEVELOPPEMENT.md](PLAN_DE_DEVELOPPEMENT.md)

---

## 1. Cycle structure

A cycle unfolds in three stages, not five: phases B and C of §7 of the game design are **merged**.

```text
A · PRODUCTION      the active player rolls the dice, everyone produces
                    ↓
B · TURN            90 s — active player AND associated player play SIMULTANEOUSLY
                    the other players may announce builds
                    ↓
C · TRADE           30 s — everyone can trade with everyone
                    ↓
                    resolving announcements, victory check, next cycle
```

**Cycle duration: 2 minutes.** At 12 players, a full round of the table takes 24 minutes, which gives 5 to 6 active turns per player over a two-hour game.

### Why simultaneous

It is the only choice compatible with the target duration. Sequentially, the cycle would go to 3.5 minutes, i.e. 42 minutes per round of the table and fewer than 3 active turns per player — reaching 15 victory points would become out of reach.

The cost is that the server receives two streams of actions in parallel. It already serializes them into an ordered queue, so the engine never sees real concurrency.

### Rights by role

| Role | Trade with the bank | Trade between players | Build | Buy a card | Announce a build |
|---|:--:|:--:|:--:|:--:|:--:|
| Active | yes | yes | yes | yes | — |
| Associated | yes | **no** | yes | yes | — |
| Others | no | during phase C | no | no | **yes** |

The associated player is the one **three seats to the left** of the active one.

---

## 2. The timer

**At zero, whatever is selected is validated automatically.** The action in progress is never cancelled.

The reason is that no player should be able to block the game, and at 5 or 6 active turns per person, losing a turn would cost 20 % of their game. This is already what the wireframes show for the discard: "at 0 s, the proposal is validated automatically".

An action **begun** before zero therefore finishes after zero. The engine does not know time: it is the server that, on expiry, emits the validation command matching the state selected by the client.

---

## 3. Building out of turn

**Any player can announce a build at any time**, including out of their turn and outside the trade phase.

It is the most ambitious mechanic in the game and the one that best serves its goal — that nobody is ever passive. It is also the most complex to code and to make legible.

### Lifecycle of an announcement

```text
resources available
        ↓  announcement
resources RESERVED  ─────────────────┐
        ↓                            │ cancellation
   BuildIntent pending               │ (free, at any time)
        ↓  end of phase C            │
     resolution                      │
    ↙         ↘                      ↓
 built       lost → resources returned
```

### Reservation

**Resources are reserved as soon as the build is announced.** They can no longer be traded, nor used for another build. They are returned if the build fails.

Without this, a player could promise the same wood to three builds, then sell it in the meantime: the announcement would no longer mean anything.

### Resolving conflicts

When several announcements target the same spot:

1. **the active player wins**;
2. otherwise, **whoever has the most Influence** (§17);
3. otherwise, **the oldest announcement wins** — the order of arrival at the server is authoritative;
4. the losers get their reserved resources back.

This rule **always designates a winner**.

The Influence consulted is that of the moment the tie is broken, not that of the moment of the announcement: an announcement is timestamped on arrival, but Influence may have moved between the two.

> **Spot freezing remains unreachable, and that is now a choice.** §8 of the game design planned it for a tie in Influence. We keep seniority as a last resort instead: two players at zero Influence are the **ordinary** case early in the game, and freezing every time would have made the exception the rule — a contested spot would be forbidden to everyone more often than awarded. The freeze mechanic remains implemented and tested for the day a genuine deadlock becomes possible.

### Freeze

When it happens, a frozen spot stays that way **until the end of the cycle**. It becomes free again on the next cycle, for everyone equally.

---

## 4. Trade

A **dedicated 30-second window** per cycle, during which all players can trade with each other.

Accepting an offer is **atomic on the server side**: A's inventory, B's inventory, the phase, the offer's validity, then the two transfers. If one player's inventory has changed in the meantime, the offer lapses.

### Who can respond during the active turn

§1 grants the active player the right to negotiate with the others during their turn, but did not specify **who could respond to them**. Restricting the response to the active player alone made the rule empty: an offer with no possible counterparty is useless.

**During the turn, a trade is admissible as long as the active player is one of the two parties to it.** Any player can therefore accept an offer from the active player, or respond to them if solicited — but two non-active players cannot trade with each other before phase C.

Offers **do not cross the cycle**: inventories have changed too much for an offer from a previous cycle to still make sense. They expire at resolution.

Resources reserved by a build announcement **cannot be traded**.

Trading with the **bank** falls under §10: its price moves, that of an offer between players never does.

> **To watch during playtest.** At 12 players, 30 seconds to negotiate *and* confirm is very short. If the window proves insufficient, the levers are: lengthen it, or switch to permanent trading throughout the cycle.

---

## 5. Victory

**Victory is checked at the end of the cycle, never mid-phase.**

Nobody is cut off mid-action: all engaged actions finish, including those of other players during the simultaneous phase.

If **several players** reach the threshold in the same cycle:

1. the highest total wins;
2. in a perfect tie, turn order decides, **starting from the active player** then to their left.

---

## 6. Absences and disconnections

A single rule governs these cases: **the game never stops**, and whatever is decided in place of a player is decided **minimally**. We unblock the game, we do not play for them.

### Active player absent

**Their turn is played by default**: the dice are rolled, a 7 (if any) is handled, the hand passes.

Nothing else. No build, no purchase, no trade — those decisions belong to the player, and making them for them would skew their game far more than making them miss them.

It is the same mechanism used for timer expiry (§2): the two situations pose the same problem and receive the same answer.

### Associated player absent

**Their turn is simply skipped.** No handling is needed: the associated turn is optional by nature, and its absence blocks no one.

### Discard

**The game's suggestion is validated automatically**, exactly as on timer expiry.

The suggestion always draws down the largest pile in the hand. Losing your only brick costs far more than losing one wood out of five: preserving diversity is the closest thing to what the player would have chosen.

### Robber

The robber is placed on a hex **touching no building**. Deciding for an absent player whom they should block would be arbitrary, and could change the outcome of the game.

### Abandoned seat

A seat is kept for **two rounds of the table** before the host is offered the option of replacing it with a bot.

> All these decisions are deterministic: at equal seed and commands, a turn played by default always produces the same result. Otherwise a game with a disconnection would stop being replayable.

---

## 7. Development cards

The deck has five kinds (`GRAND_COLONIES_DECK`, 60 cards). Two rules apply to all of them, and matter more at twelve than at four: **a card is not played the turn it is bought**, and **only one card per turn**. Without the first, you would convert resources into a knight at the precise moment you need one; without the second, a player who has hoarded would empty their hand in one go, beyond any reaction.

Only the **active player** plays cards. The associated player builds and trades, but does not play cards: that is already the knight's rule, and extending it avoids having to arbitrate two monopolies in the same turn.

| Card | Effect | Window |
|---|---|---|
| Knight | Moves the robber, counts toward military strength | Production **or** active turn |
| Road building | One or two free roads | Active turn |
| Year of plenty | Two resources of your choice, taken from the bank | Active turn |
| Monopoly | All other players hand over the named resource | Active turn |
| Master builder | **One** free build, of your choice | Active turn |

The knight keeps its wider window because you must be able to push the robber away *before* rolling the dice.

### Details

**Road building** accepts a single road. A player who is boxed in, or short of pieces, must be able to play their card rather than keep it dead in hand. The two spots are validated in the given order, because the second road often leans on the first; if the second is illegal, neither is placed.

**Year of plenty** respects the bank's stock, which is finite.

**Master builder** grants the *resource combination* of a build — road, settlement or city — not an extra build: placement rules, available pieces and frozen spots apply normally. This costing puts it on par with Road building (two roads, i.e. four resources) while leaving the choice to the player.

> **To confirm.** The Master builder's effect was defined nowhere; the name alone ("free build combination") allowed several readings. The one adopted is the most frugal and best balanced, but it remains to be validated in play.

---

## 8. Metropolises and monuments

The victory scale had costed these two builds from the start — 3 points and 2 points — but nothing awarded them: the table was dead. Yet these are the mechanics that separate Grandes Colonies from base Catan, and they answer the problem measured in simulation: games drag on because players end up **short of spots**, not short of resources. Metropolis and monument grow the score **in height** rather than in area.

### The metropolis

Upgrades one of your cities. Cost: **3 ore, 2 wheat, 2 gold**. It is worth 3 points **instead of** the city's 2 — one net point — and produces as much as it, no more.

**There are only three for the whole game.** It is a race prize, like the longest road: at twelve players, an upgrade available to everyone would inflate every score without settling anything.

> **Why gold.** Gold was a dead resource: produced by its hexes, counted by the bank, but demanded by no cost — the only objective that used it is disabled for lack of a system. It piled up in hand until the discard. The metropolis finally gives it a reason to exist, and gives gold tiles a placement value.

### The monument

Built on one of your cities or metropolises. Cost: **one of each resource** — wood, brick, wool, wheat, ore. **One per player only.** Worth 2 points.

Five resources for two points is a city's price, but **with no spot to find**. This is deliberate: the monument is the way out for a blocked player, one who has resources and no free corner left. "One of each" forces them through trade, which keeps the table alive instead of draining it.

### The barbarians (§16)

The threat track advances one square every **5 cycles**, over **8 squares**. At the end, the barbarians attack, then the track restarts from zero.

**Strength comes from the table, defense from each player.** It counts 1 per city and 2 per metropolis, all colours combined: it is cities that summon the invasion, not points — a player can lead through their roads, their titles or their objective without having built anything that can be pillaged. Defense counts 1 per knight played, individually.

**Consequences.** The best defender receives a "Defender of Catan" token — 1 victory point and 1 Influence point — whether the attack is repelled or not: §16 rewards the effort, not the result. Nobody is crowned if no one played a knight; rewarding a shared zero would make no sense.

If the total defense is not enough, the weakest defender **who has a city** sees it drop back to a settlement. Looking for the weak link among all players could have designated someone with no city, and the attack would then have cost no one anything. The city returns to its reserve and a settlement comes out: the player loses the point, not the piece. Nothing is ever destroyed — §20 rules out any elimination.

Ties are broken by player order and not by a draw: chance would make the game unreplayable from its log.

> Measured over twelve simulated games: about five invasions per game, seven out of ten repelled, and one city lost every three or four invasions.

### What stays inert

`majorExploration` (1 point) remains in the scale without being awarded: it awaits the archipelago. It is kept rather than removed, on the model of unavailable objectives — the day its system arrives, there will be nothing to re-cost.

`defenderToken` (1 point) **is now awarded**: it rewards the player who provided the greatest defense during a barbarian invasion (§16), and is also worth one Influence point.

---

## 9. Archipelago and exploration

§4 of the game design describes a contested central island and two to three major islands, linked only by the sea. Yet the boards were solid discs: the sea lanes had nowhere to lead, and `majorExploration` stayed inert in the scale.

### The board

A **central island** carries a little over half the land, and **two or three secondary islands** share the rest — three from eleven players on, as §4 provides. Each island is separated from the others by at least one sea hex: it is this separation that makes the sea lane mandatory rather than optional.

The initial setup is done on the central island. Starting on a secondary island would give a free exploration point, and deprive the game of the race that makes it interesting.

### Major exploration

**The first player to build a settlement on a secondary island earns 1 point.** Once per island, never during setup.

This is the most frugal reading of §13, and the only measurable one today. The game design there also plans face-down hexes revealing rare resources, neutral villages, events or dangerous zones — eight kinds of tiles, each demanding its own rules. That system remains to be designed; the exploration point, meanwhile, already rewards what matters: having crossed first.

---

## 10. The dynamic market

§10 of the game design asks for "a demand indicator" per resource, which falls when a lot of it is sold and rises when it is scarce — and insists that the market stay **simple**, on pain of turning game night into an economic simulation. It gives six values and nothing else: no unit, no step, no bounds.

### The indicator is the bank rate

The reading adopted is the most frugal possible: this indicator **is** the exchange rate with the bank, the one that already existed. The game had a frozen 4:1; it now has a rate that moves. Nothing new for a player to learn — it is the same action, at a changing price.

The six values of §10 then read directly, and they describe the table's economy well: wood 5, brick 4, wool 4, wheat 3, ore 3, gold 2. Wood is everywhere and worth little; gold is rare and buys a lot.

### The port discounts, it does not impose

The rate sets the price, **the port subtracts a discount from it**: one card for a generic port, two for a specialized or trading port. This is exactly the old scale — 4 bare, 3 generic, 2 specialized — but expressed so that the two systems coexist.

The opposite would have killed the market: a port that *imposes* its rate would make it invisible to any settled player, i.e. to everyone after a few cycles.

The final rate never drops below **2**, the floor of the rate itself. Otherwise a port specialized in an already scarce resource would end up giving 1:1. Gold, which opens at the floor, therefore draws no benefit from a port — it is already at the best price in the game.

### What moves the rate

**One bank transaction, one balance step**: the resource given floods in and depreciates, the one going out grows scarce and dearer. **Four net transactions** in the same direction move the rate by one step.

We count transactions, not cards. A trade always gives `rate` cards for a single one: counting cards would make the sold side rise four to six times faster than the bought side falls, and every rate would drift toward the ceiling in a few dozen trades.

The rate is bounded to **2–6**, and the balance that carries it is too, one step further. This second bound is not cosmetic: without it, the measurement showed a resource sold four hundred times in a row and a rate that would have taken four hundred purchases to lift off. A saturated resource stays that way as long as you dump it, and recovers as soon as you stop.

### What does not touch it

The rate moves **only** through the bank. Production, theft, monopoly, discard, and above all **trades between players** change nothing.

This is deliberate, and it is the heart of what makes the device interesting at twelve players: the dearer the bank becomes on a resource, the more profitable it becomes to turn to the table. The market does not replace negotiation, it pushes it.

### The rate is public

Everyone sees the six prices and the direction of the next move. A market you discovered at the moment of clicking would not be a market: it is by watching it rise that you decide to sell now rather than next cycle. The rate shown to each player is theirs, including their ports' discount.

### The fish

`fish` carries an opening value so that the scale is complete, but no current board has terrain that produces it. It is unused.

---

## 11. The contract ports

§11 introduces four ports on top of the classic ones. Three are implemented; the fourth awaits its system.

### The trading port

Already in place: a two-card discount on any resource. It is the only one of the four whose effect you understand without having read the rule, and that is why it is the first sown when the coastline is short.

### The mining port — 2 ore → 1 gold

The §11 exchange, taken literally. But one thing had to be settled that the game design could not foresee, since it ignores the market: **is this price subject to the rate?**

**No.** The mining port is a fixed-price contract, and the market never touches it.

Without this exemption the port would be stillborn. An ore-specialized port already gives a two-card discount on *everything*, including gold, so a mining port subject to the same floor of 2 would have added nothing the ordinary port did not already give. Exempted, it becomes exactly what a contract must be: of no interest when ore is cheap, and very valuable when the market has pushed it to six.

### The commercial port — 2 different resources → 1 of your choice

**Two cards of different kinds**, never two of the same, and never the resource asked for in payment. Fixed price too.

It is the kind constraint that sets it apart from everything else: you do not offload a surplus here, you convert a scattered hand. The simulation had shown that the blockage at twelve players is not scarcity but dispersion — ten cards spread over five types never make a city. This port answers that problem, and it alone.

### Contracts do not move the market

A trade at one of these ports does not emit a `MarketMoved` and does not touch the §10 balance.

This is not only consistent with their fixed price, it is necessary: the commercial port consumes two cards to give one back. Counting them would have pushed two rates up for one down on every use, and made the whole market drift toward its ceiling — precisely the imbalance that §10 avoids by counting transactions rather than cards.

### One of each only

The trading, mining and commercial ports are sown **once per board**, as the metropolises are three for the game. These are race positions: two mining ports on the same coastline would teach the table nothing more, and a huge board would have sown two or three since the types repeat there.

They are capped at a third of the board's ports: on a coastline of six, putting three would make a board where ordinary trade is the exception.

### The ports on the table screen

They were missing there. The shared screen showed the tiles, the roads and the pieces, but not the ports — even though these are race positions, and it is around that screen that you negotiate out loud. A panel now sits on the water bordering each port corner, and the three contract ports carry the accent colour there: their rate does not distinguish them from an ordinary 2:1, only their second line does.

### Gold is tradable, and the panel finally says so

The rate strip displayed a price for gold, the trade menus did not offer it: the interface announced a price it then refused to honour. The engine, for its part, had always accepted both directions.

The gap was worst where gold matters. It is the **only outlet of the mining port** and a third of a metropolis's cost: a player who had just converted their ore into gold had no way left to spend it, and a player with no gold tile and no mining port had no way to obtain any.

Along the way, the fear that the bank makes the mining port useless does not hold: you pay at the rate of the card **given**, not of the one received. The mining port takes 2 ore where the bank takes 3 — or 5 wood, or 4 wool.

### The royal port is still to do

§11 gives it "an Influence bonus to the players who control its region". Neither Influence nor the notion of region exists. It is neither sown nor declared: unlike the defender tokens of §8, there is nothing to keep warm — an unused port type does not merely sit inert, it occupies a coastal corner.

### The "great trader" of §21 awaits the trading posts

§21 proposes a secret objective, "own **5 ports or trading posts**". The ports now exist; the trading posts of §12 do not — and that is half the count missing, not a detail.

Measured rather than assumed, over games played by bots aimed at the port corners: **a player alone in coveting them wins two**, almost always. Three happens in 1 % of cases at twelve players, and five never, at any count. The coastline carries only about a dozen, spacing reserves their neighbours, and twelve players contest them.

| Count | 1 player alone aims for them | A third of the table aims for them |
|---|---|---|
| 12 players | 1.95 ports · ≥2 in 95 % | 1.07 · ≥2 in 15 %, ≥3 in 1 % |
| 8 players | 2.00 ports · ≥2 in 100 % | 1.43 · ≥2 in 47 % |
| 4 players | 2.25 ports · ≥3 in 15 % | 2.10 · ≥3 in 10 % |

The objective is therefore **declared but disabled**, like the explorer and the diplomat. It already counts the ports and adds a `tradingPosts` still at zero: the day the trading posts arrive, there will be just a boolean to flip. Lowering the threshold to two would have been inventing a rule rather than finishing one.

### The bots do not aim for the ports — so §11 is not measured

A gap in measurement, not in rules, but it is worth writing down. The bots place their settlement on the first legal corner that comes, without looking at the number tokens or the ports. Result: at twelve players, **85 % of players finish the game with no port at all**, and never does any hold two — on a coastline that carries ten.

Everything `scripts/ports.ts` compares — with and without the contract ports — therefore plays out over about fifteen trades per game and settles nothing. §11 is complete in the engine and in both interfaces; it stays invisible to balancing as long as the bots do not covet the port corners.

---

## 12. Decision log

| Date | Question | Decision |
|---|---|---|
| 2026-08-27 | Active and associated turn | **Simultaneous** — the only choice compatible with the target duration |
| 2026-08-27 | Trade | **Dedicated 30 s window** |
| 2026-08-27 | Building out of turn | **Anyone, at any time** |
| 2026-08-27 | Timer at zero | **Automatic validation** |
| 2026-08-27 | Resources of an announcement | **Reserved as soon as announced** |
| 2026-08-27 | Build conflict | **Active player, then seniority** |
| 2026-08-27 | Freeze duration | **Until the end of the cycle** |
| 2026-08-27 | Victory during the simultaneous phase | **Checked at end of cycle** |
| 2026-08-27 | Active player absent | **Turn played by default**, at the strict minimum |
| 2026-08-27 | Associated player absent | **Turn skipped** |
| 2026-08-27 | Discard by an absent player | **Suggestion validated automatically** |
| 2026-08-27 | Abandoned seat | **Two rounds of the table** before offering a bot |
| 2026-08-27 | Responding to an offer during the turn | **Admissible if the active player is one of the two parties** |
| 2026-08-27 | Lifetime of an offer | **The current cycle** |
| 2026-08-27 | Who plays development cards | **The active player alone** — like the knight |
| 2026-08-27 | Window for cards other than the knight | **Active turn only** |
| 2026-08-27 | Road building with a single placement | **Allowed** — otherwise the card stays dead in hand |
| 2026-08-27 | Master builder's effect | **One free build of your choice** — *to confirm in play* |
| 2026-08-27 | Metropolis's effect | **Upgrade of a city, 3 VP instead of 2**, three for the game |
| 2026-08-27 | Metropolis's cost | **3 ore, 2 wheat, 2 gold** — finally gives gold a use |
| 2026-08-27 | Monument's effect | **2 VP, one per player**, built on a city |
| 2026-08-27 | Monument's cost | **One of each resource** — forces trade |
| 2026-08-27 | Defender tokens and major exploration | **Kept in the scale, inert** pending their system |
| 2026-08-27 | Board structure | **Central island + 2 or 3 secondary islands**, separated by the sea |
| 2026-08-27 | Setup | **On the central island only** |
| 2026-08-27 | Major exploration | **1 point to the first to reach each secondary island**, outside setup |
| 2026-08-27 | Face-down hexes of §13 | **Deferred** — eight kinds of tiles to design |
| 2026-08-28 | Nature of the §10 indicator | **It is the bank rate itself**, not a separate value |
| 2026-08-28 | Opening rate | **The six values of §10**: wood 5, brick 4, wool 4, wheat 3, ore 3, gold 2 |
| 2026-08-28 | Ports and market | **The rate sets, the port discounts** — 1 card generic, 2 specialized |
| 2026-08-28 | Rate floor | **2 to 1**, port included — gold therefore gains nothing from one |
| 2026-08-28 | Unit of movement | **The transaction, not the card** — otherwise every rate drifts to the ceiling |
| 2026-08-28 | Step | **4 net transactions** for one notch; rate bounded to 2–6 |
| 2026-08-28 | Balance carrying the rate | **Bounded too**, one notch further — otherwise a saturated rate never comes back down |
| 2026-08-28 | What moves the rate | **The bank alone** — trades between players do not touch it |
| 2026-08-28 | Rate visibility | **Public**, with the direction of the next notch |
| 2026-08-28 | Mining port and market | **Exempt from the rate** — otherwise an ore-specialized port made it useless |
| 2026-08-28 | Commercial port | **Two cards of different kinds** for one of your choice, fixed price |
| 2026-08-28 | Payment at the commercial port | **Never with the resource asked for** |
| 2026-08-28 | Contracts and rate | **No effect on the market** — two inputs for one output would have made it drift |
| 2026-08-28 | Sowing the special ports | **One of each per board**, capped at a third of the ports |
| 2026-08-29 | Royal port | **Sown** — it gives 2 Influence to whoever occupies it (§17). Last of the four unique ports: it does not trade, and on a small coastline a spot that trades nothing is a spot wasted |
| 2026-08-29 | Ports on the table screen | **Drawn**, on the corner's water — the contracts in accent colour |
| 2026-08-29 | Gold in the trade panel | **Offered** — the strip priced it, the menus hid it |
| 2026-08-29 | "Great trader" objective | **Declared, disabled** — five ports are out of reach without the trading posts (measured: two at best) |
