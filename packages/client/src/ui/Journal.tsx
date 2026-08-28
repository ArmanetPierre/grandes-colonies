/**
 * Journal de partie.
 *
 * À douze joueurs, on n'agit qu'un cycle sur douze. Entre deux tours, onze
 * choses se produisent et l'écran n'en montrait que le résultat : des points
 * qui bougent, des routes qui apparaissent, sans qu'on sache qui a fait quoi.
 *
 * Le journal comble ce trou. Il ne raconte que le public — jamais une main,
 * jamais un objectif, jamais la nature d'une carte volée : le secret doit
 * tenir ici comme ailleurs.
 */

import type { PublicGameView, WireEvent } from '@grand-colonies/protocol';

import { colorOf } from './Board.jsx';
import { CARD_LABELS } from './DevCards.jsx';

const RESOURCE_LABELS: Record<string, string> = {
  wood: 'bois', brick: 'brique', wool: 'laine',
  grain: 'blé', ore: 'minerai', gold: 'or', fish: 'poisson',
};

/** Une entrée du journal : qui, et quoi. */
export interface Entry {
  readonly player: string | undefined;
  readonly text: string;
}

const resourceName = (r: string): string => RESOURCE_LABELS[r] ?? r;

/**
 * Traduit un événement en une ligne lisible, ou rien.
 *
 * Beaucoup d'événements sont de la mécanique interne — changements de phase,
 * annonces réglées — et n'apprennent rien à personne. Les taire vaut mieux
 * que noyer les trois lignes qui comptent.
 */
export function describe(event: WireEvent): Entry | undefined {
  switch (event.type) {
    case 'DiceRolled':
      return { player: event.player, text: `lance ${event.a} + ${event.b} = ${event.total}` };
    case 'SettlementPlaced':
      return { player: event.player, text: 'fonde une colonie' };
    case 'CityBuilt':
      return { player: event.player, text: 'élève une cité' };
    case 'MetropolisBuilt':
      return {
        player: event.player,
        text: event.remaining > 0
          ? `bâtit une métropole — il en reste ${event.remaining}`
          : 'bâtit la dernière métropole',
      };
    case 'MonumentRaised':
      return { player: event.player, text: 'élève son monument' };
    case 'RoadPlaced':
      return { player: event.player, text: 'trace une route' };
    case 'MaritimeRoutePlaced':
      return { player: event.player, text: 'ouvre une voie maritime' };
    case 'IslandReached':
      return { player: event.player, text: 'atteint une île nouvelle' };
    case 'RobberMoved':
      return { player: event.player, text: 'déplace le voleur' };
    case 'ResourceStolen':
      // La ressource volée est privée : seuls le voleur et sa victime la
      // connaissent. Le journal dit le vol, pas la carte.
      return { player: event.thief, text: 'dérobe une carte' };
    case 'DevCardBought':
      return { player: event.player, text: 'achète une carte développement' };
    case 'DevCardPlayed':
      return { player: event.player, text: `joue ${CARD_LABELS[event.card] ?? event.card}` };
    case 'MonopolyResolved': {
      const total = event.taken.reduce((sum, t) => sum + t.count, 0);
      return {
        player: event.player,
        text: total > 0
          ? `rafle ${total} ${resourceName(event.resource)}`
          : `réclame ${resourceName(event.resource)} — personne n'en avait`,
      };
    }
    case 'TradeAccepted':
      return { player: event.to, text: 'accepte un échange' };
    case 'TitleChanged':
      if (event.to === undefined) return undefined;
      return {
        player: event.to,
        text: event.title === 'longestRoute'
          ? 'prend le plus long réseau'
          : 'prend la plus grande puissance militaire',
      };
    case 'CycleEnded':
      return { player: undefined, text: `— fin du cycle ${event.cycle} —` };
    case 'GameWon':
      return { player: event.player, text: `l'emporte avec ${event.points} points` };
    default:
      return undefined;
  }
}

export interface JournalProps {
  readonly view: PublicGameView;
  readonly entries: readonly Entry[];
}

export function Journal({ view, entries }: JournalProps) {
  const order = view.players.map((p) => p.id);
  const nameOf = (id: string): string => view.players.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="gc-journal">
      <div className="gc-journal-head">Journal</div>
      {/* Le vide se dit : disparaître décalerait tout ce qui suit. */}
      {entries.length === 0 && (
        <p className="gc-journal-idle">Rien ne s'est encore produit.</p>
      )}
      <ol className="gc-journal-list">
        {/* Le plus récent en tête : c'est ce qu'on vient de manquer. */}
        {entries.map((entry, index) => (
          <li key={`${entries.length - index}`} className="gc-journal-entry">
            {entry.player !== undefined && (
              <span className="gc-chip" style={{ background: colorOf(entry.player, order) }} />
            )}
            {entry.player !== undefined && <strong>{nameOf(entry.player)}</strong>} {entry.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
