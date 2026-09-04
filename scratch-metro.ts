/** La métropole est-elle prise, selon ce qu'elle rapporte ? */
import { GreedyBot, RandomBot, playGame } from '@grandes-colonies/sim';
import { defaultConfig, type SeededRandom } from '@grandes-colonies/engine';

const GAMES = 20;
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const bots = (i: number, rng: SeededRandom) => (i % 3 === 0 ? new RandomBot(rng) : new GreedyBot());

for (const points of [3, 4, 5]) {
  for (const n of [8, 12]) {
    const rows = [];
    for (let i = 0; i < GAMES; i++) {
      const base = defaultConfig(n);
      const config = { ...base, victory: { ...base.victory, metropolis: points } };
      rows.push(playGame({ playerCount: n, seed: `m-${n}-${i}`, config, maxCycles: 400, makeBot: bots }));
    }
    const built = rows.reduce((s, r) => s + r.breakdowns.reduce((t, b) => t + (b.metropolises > 0 ? 1 : 0), 0), 0);
    const won = rows.filter((r) => r.winner !== undefined);
    console.log(
      `${points} PV, ${n}j : ${String(built).padStart(2)} métropoles bâties sur ${GAMES * 3} possibles`,
      `| ${won.length}/${GAMES} conclues | cycles ${won.length ? med(won.map((r) => r.cycles)) : '—'}`,
    );
  }
}
