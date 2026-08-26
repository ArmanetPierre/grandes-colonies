/**
 * Jeu par défaut, pour les joueurs absents ou hors délai.
 *
 * Deux situations l'appellent, et elles obéissent à la même logique :
 * l'expiration d'un chronomètre et la déconnexion d'un joueur. Dans les deux
 * cas la règle est la même (contrat §2 et §6) : le jeu ne s'arrête jamais, et
 * ce qui peut être décidé à la place du joueur l'est de façon **minimale** —
 * on débloque la partie, on ne joue pas à sa place.
 *
 * Un tour joué par défaut se contente donc de lancer les dés, de gérer un
 * éventuel 7, et de passer la main. Il ne construit rien, n'achète rien et
 * n'échange rien : ces décisions appartiennent au joueur, et les prendre pour
 * lui fausserait sa partie bien plus que de les lui faire manquer.
 */

import type { HexId } from '../board/graph.js';
import {
  type Resource,
  type ResourceCounts,
  RESOURCES,
  amount,
  counts,
  total,
} from '../resources.js';
import type { Command } from './commands.js';
import { type GameState, activePlayer, playerOf } from './state.js';

/**
 * Quelles cartes défausser, faute de choix du joueur.
 *
 * On retire toujours une carte de la pile la plus fournie, ce qui préserve la
 * diversité de la main : perdre sa seule brique coûte bien plus cher que
 * perdre le cinquième de ses bois. À égalité, l'ordre des ressources tranche,
 * pour que la suggestion reste déterministe et donc rejouable.
 */
export function suggestDiscard(hand: ResourceCounts, count: number): ResourceCounts {
  if (count <= 0) return counts({});

  const remaining: Partial<Record<Resource, number>> = {};
  for (const r of RESOURCES) remaining[r] = amount(hand, r);

  const picked: Partial<Record<Resource, number>> = {};
  const toDiscard = Math.min(count, total(hand));

  for (let i = 0; i < toDiscard; i++) {
    let best: Resource | undefined;
    for (const r of RESOURCES) {
      if ((remaining[r] ?? 0) <= 0) continue;
      if (best === undefined || (remaining[r] ?? 0) > (remaining[best] ?? 0)) best = r;
    }
    if (best === undefined) break;
    remaining[best] = (remaining[best] ?? 0) - 1;
    picked[best] = (picked[best] ?? 0) + 1;
  }

  return counts(picked);
}

/**
 * Où poser le voleur par défaut.
 *
 * On choisit un hexagone qui ne touche aucune construction, afin de ne léser
 * personne : décider à la place d'un joueur absent qui il doit bloquer serait
 * arbitraire et pourrait changer l'issue de la partie. À défaut, le premier
 * hexagone libre dans l'ordre des clés — déterministe, donc rejouable.
 */
export function defaultRobberTarget(state: GameState): HexId | undefined {
  const candidates = [...state.board.allHexData().keys()]
    .filter((id) => !state.board.isBlocked(id))
    .sort();

  const harmless = candidates.find(
    (id) => state.board.buildingsAroundHex(parseKey(id)).length === 0,
  );
  return harmless ?? candidates[0];
}

function parseKey(id: HexId): { q: number; r: number } {
  const [q, r] = id.split(',');
  return { q: Number(q), r: Number(r) };
}

/**
 * La prochaine commande à jouer d'office pour ce joueur, s'il y en a une.
 *
 * Le serveur l'appelle en boucle jusqu'à ce qu'elle renvoie `undefined` : la
 * partie est alors débloquée. Renvoyer une commande à la fois plutôt qu'un
 * lot garde chaque décision visible dans le journal, et donc rejouable.
 */
export function nextDefaultCommand(
  state: GameState,
  playerId: string,
  actionId: string,
): Command | undefined {
  const player = playerOf(state, playerId);
  if (!player || state.phase === 'ended' || state.phase === 'setup') return undefined;

  // Une défausse due bloque tout le monde, y compris les joueurs présents.
  if (player.mustDiscard > 0) {
    return {
      actionId, playerId, type: 'DISCARD',
      resources: suggestDiscard(player.hand, player.mustDiscard),
    };
  }

  // Le reste ne concerne que le joueur actif : l'associé absent est
  // simplement sauté, son tour étant facultatif par nature.
  if (activePlayer(state).id !== playerId) return undefined;

  if (state.phase === 'production') {
    return { actionId, playerId, type: 'ROLL_DICE' };
  }

  if (state.pendingRobber) {
    const to = defaultRobberTarget(state);
    if (to === undefined) return undefined;
    return { actionId, playerId, type: 'MOVE_ROBBER', to };
  }

  if (state.phase === 'activeTurn') return { actionId, playerId, type: 'END_TURN' };
  if (state.phase === 'freeTrade') return { actionId, playerId, type: 'END_CYCLE' };

  return undefined;
}
