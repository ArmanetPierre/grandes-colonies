/**
 * Aller-retour JSON sur chaque sorte d'événement.
 *
 * Le test qui compte est celui des deux événements porteurs d'une `Map` :
 * ils traversaient le réseau vides, `JSON.stringify` transformant un `Map` en
 * `{}` sans rien signaler.
 */

import { describe, expect, it } from 'vitest';

import type { DomainEvent } from '@grandes-colonies/engine';

import { fromWire, redactAllFor, redactFor, toWire, toWireAll } from '../src/events.js';

/** Ce qui arriverait réellement au client. */
const roundTrip = (event: DomainEvent) =>
  JSON.parse(JSON.stringify(toWire(event))) as ReturnType<typeof toWire>;

describe('événements porteurs d une Map', () => {
  it('préserve la production, que JSON vidait', () => {
    const event: DomainEvent = {
      type: 'ResourcesProduced',
      gains: new Map([['p1', { wood: 2 }], ['p2', { ore: 1, grain: 3 }]]),
    };

    // Le comportement d'avant : la preuve du piège.
    expect(JSON.stringify(event)).toContain('"gains":{}');

    const wire = roundTrip(event);
    if (wire.type !== 'ResourcesProduced') throw new Error('mauvais type');
    expect(wire.gains).toHaveLength(2);
    expect(wire.gains.find((g) => g.player === 'p2')?.value).toEqual({ ore: 1, grain: 3 });

    // Et le retour reconstruit bien une Map utilisable par le moteur.
    const back = fromWire(wire);
    if (back.type !== 'ResourcesProduced') throw new Error('mauvais type');
    expect(back.gains.get('p1')).toEqual({ wood: 2 });
  });

  it('préserve la défausse due', () => {
    const event: DomainEvent = {
      type: 'DiscardRequired',
      players: new Map([['p3', 5], ['p7', 2]]),
    };
    expect(JSON.stringify(event)).toContain('"players":{}');

    const wire = roundTrip(event);
    if (wire.type !== 'DiscardRequired') throw new Error('mauvais type');
    expect(wire.players).toEqual([{ player: 'p3', value: 5 }, { player: 'p7', value: 2 }]);
    const back = fromWire(wire);
    if (back.type !== 'DiscardRequired') throw new Error('mauvais type');
    expect(back.players.get('p3')).toBe(5);
  });
});

describe('les autres événements traversent intacts', () => {
  const samples: DomainEvent[] = [
    { type: 'GameStarted', players: ['p1', 'p2'], seed: 'x' },
    { type: 'SetupCompleted' },
    { type: 'SettlementPlaced', player: 'p1', vertex: 'a|b|c' },
    { type: 'RoadPlaced', player: 'p1', edge: 'a|b' },
    { type: 'CityBuilt', player: 'p1', vertex: 'a|b|c' },
    { type: 'MetropolisBuilt', player: 'p1', vertex: 'a|b|c', remaining: 2 },
    { type: 'MonumentRaised', player: 'p1', vertex: 'a|b|c' },
    { type: 'DiceRolled', player: 'p1', a: 3, b: 4, total: 7 },
    { type: 'ResourcesDiscarded', player: 'p1', resources: { wood: 2 } },
    { type: 'RobberMoved', player: 'p1', from: undefined, to: '0,0' },
    { type: 'ResourceStolen', thief: 'p1', victim: 'p2', resource: 'ore' },
    { type: 'DevCardBought', player: 'p1', card: 'knight' },
    { type: 'DevCardPlayed', player: 'p1', card: 'monopoly' },
    { type: 'MonopolyResolved', player: 'p1', resource: 'wool', taken: [{ from: 'p2', count: 3 }] },
    { type: 'ResourcesGranted', player: 'p1', resources: { ore: 2 } },
    { type: 'BankTraded', player: 'p1', give: { wood: 4 }, receive: { ore: 1 } },
    { type: 'TitleChanged', title: 'largestArmy', from: undefined, to: 'p1' },
    { type: 'GameWon', player: 'p1', points: 15 },
  ];

  it('ne perd rien au passage par JSON', () => {
    for (const event of samples) {
      const wire = roundTrip(event);
      // `undefined` disparaît en JSON : on compare donc au même traitement.
      expect(wire).toEqual(JSON.parse(JSON.stringify(event)));
    }
  });

  it('convertit une liste entière', () => {
    expect(toWireAll(samples)).toHaveLength(samples.length);
  });
});

describe('étanchéité du flux d événements', () => {
  /**
   * Le flux contournait entièrement les vues : il diffusait à toute la table
   * la nature exacte de la carte que chacun venait d'acheter. Toute
   * l'étanchéité de `publicView` tombait par cette porte.
   */
  it('ne révèle la carte achetée qu à son acheteur', () => {
    const event = toWire({ type: 'DevCardBought', player: 'p1', card: 'knight' });

    const owner = redactFor(event, 'p1');
    if (owner.type !== 'DevCardBought') throw new Error('mauvais type');
    expect(owner.card).toBe('knight');

    const other = redactFor(event, 'p2');
    if (other.type !== 'DevCardBought') throw new Error('mauvais type');
    expect(other.card).toBeUndefined();
    // Et rien ne subsiste dans le JSON réellement transmis.
    expect(JSON.stringify(other)).not.toContain('knight');
  });

  /**
   * La carte volée est annoncée à toute la table.
   *
   * Elle l'était déjà de fait : les mains étant publiques, il suffisait de
   * comparer deux vues successives pour lire ce qui avait changé de camp. Le
   * masque n'empêchait plus que le client d'en faire l'annonce.
   */
  it('révèle la carte volée à toute la table', () => {
    const event = toWire({ type: 'ResourceStolen', thief: 'p1', victim: 'p2', resource: 'ore' });

    for (const viewer of ['p1', 'p2', 'p3']) {
      const seen = redactFor(event, viewer);
      if (seen.type !== 'ResourceStolen') throw new Error('mauvais type');
      expect(seen.resource).toBe('ore');
      expect(seen.thief).toBe('p1');
      expect(seen.victim).toBe('p2');
    }
  });

  it('laisse les autres événements intacts', () => {
    const event = toWire({ type: 'DevCardPlayed', player: 'p1', card: 'monopoly' });
    expect(redactAllFor([event], 'p9')).toEqual([event]);
  });
});
