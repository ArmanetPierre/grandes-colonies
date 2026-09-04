/**
 * Salon d'attente.
 *
 * Le moment le plus fragile d'une soirée n'est pas la partie mais son début :
 * chacun arrive, cherche l'adresse, tape son nom. Cet écran ne sert qu'à
 * rassurer — « je suis bien connecté, voilà qui est là, on attend l'hôte ».
 *
 * Il ne montre pas le plateau : rien n'y serait cliquable, et un plateau
 * inerte laisserait croire à une panne.
 */

import type { PublicGameView } from '@grandes-colonies/protocol';

import { colorOf } from './Board.jsx';

export interface LobbyProps {
  readonly view: PublicGameView;
  readonly me: string;
  readonly myName: string;
}

export function Lobby({ view, me, myName }: LobbyProps) {
  const order = view.players.map((p) => p.id);
  const here = view.players.filter((p) => p.connected);

  return (
    <div className="gc-splash">
      <h1>Grandes Colonies</h1>
      <p className="gc-lobby-status">
        Bienvenue {myName}. On attend que l'hôte lance la partie.
      </p>

      <div className="gc-lobby-count">
        {here.length} joueur{here.length > 1 ? 's' : ''} sur {view.players.length}
      </div>

      <div className="gc-lobby-seats">
        {view.players.map((player) => (
          <div
            key={player.id}
            className={`gc-lobby-seat${player.connected ? '' : ' is-free'}${player.id === me ? ' is-me' : ''}`}
          >
            <span className="gc-chip" style={{ background: colorOf(player.id, order) }} />
            {player.connected ? player.name : 'libre'}
          </div>
        ))}
      </div>
    </div>
  );
}
