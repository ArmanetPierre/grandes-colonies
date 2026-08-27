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

import { hexKey } from '../board/axial.js';
import type { HexId, VertexId } from '../board/graph.js';
import { settlementSpots } from '../placement.js';
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
/**
 * Poids d'un jeton : le nombre de façons de le sortir avec deux dés.
 *
 * Six et huit valent cinq fois deux ou douze. Un placement de mise en place
 * engage toute la partie ; s'en remettre au premier emplacement de la liste
 * condamnerait le joueur qui reprend le siège.
 */
function tokenWeight(token: number | undefined): number {
  if (token === undefined) return 0;
  return 6 - Math.abs(7 - token);
}

/** Valeur de production d'un sommet, tous hexagones adjacents confondus. */
function vertexValue(state: GameState, vertex: VertexId): number {
  let value = 0;
  for (const hex of state.board.graph.boardHexesOfVertex(vertex)) {
    value += tokenWeight(state.board.hexData(hexKey(hex))?.token);
  }
  return value;
}

/**
 * Mise en place jouée par défaut.
 *
 * Contrairement au reste du module, on ne peut pas se contenter de passer :
 * la mise en place est obligatoire et toute la partie en dépend. On place
 * donc au mieux de ce que le plateau offre, ce qui laisse une position
 * jouable à qui reprendra le siège.
 */
function defaultSetupCommand(
  state: GameState,
  playerId: string,
  actionId: string,
): Command | undefined {
  if (state.setupQueue[0] !== playerId) return undefined;

  const pending = state.setupPendingVertex;
  if (pending === undefined) {
    const best = settlementSpots(state.board, playerId, { setupPhase: true })
      .reduce<{ vertex: VertexId; value: number } | undefined>((champion, vertex) => {
        const value = vertexValue(state, vertex);
        return champion && champion.value >= value ? champion : { vertex, value };
      }, undefined);
    if (!best) return undefined;
    return { actionId, playerId, type: 'PLACE_SETUP_SETTLEMENT', vertex: best.vertex };
  }

  const edge = state.board.graph
    .edgesOfVertexOnBoard(pending)
    .find((candidate) => state.board.roadAt(candidate) === undefined);
  if (edge === undefined) return undefined;
  return { actionId, playerId, type: 'PLACE_SETUP_ROAD', edge };
}

export function nextDefaultCommand(
  state: GameState,
  playerId: string,
  actionId: string,
): Command | undefined {
  const player = playerOf(state, playerId);
  if (!player || state.phase === 'ended') return undefined;
  if (state.phase === 'setup') return defaultSetupCommand(state, playerId, actionId);

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
