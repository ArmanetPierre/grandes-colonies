import { describe, expect, it } from 'vitest';

import { besoinsPour, peutPayer } from '../src/besoins.js';
import { COSTS, counts } from '../src/resources.js';

/** Les taux de base : quatre contre une, aucun port. */
const BASE = { wood: 4, brick: 4, wool: 4, grain: 4, ore: 4, gold: 4, fish: 4 } as const;

describe('ce qui manque', () => {
  it('ne réclame rien quand la main suffit', () => {
    const [route] = besoinsPour(COSTS['road'], BASE, ['road']);
    expect(route?.manquant).toEqual({});
    expect(route?.comble).toBe(true);
    expect(route?.banque).toEqual([]);
  });

  it('nomme précisément ce qui manque', () => {
    // Une colonie coûte bois, brique, laine, blé. Il ne manque que la brique.
    const main = counts({ wood: 1, wool: 1, grain: 1 });
    const [colonie] = besoinsPour(main, BASE, ['settlement']);
    expect(colonie?.manquant).toEqual({ brick: 1 });
  });

  it('ne compte comme surplus que ce qui reste une fois le coût mis de côté', () => {
    const main = counts({ wood: 5, brick: 1 });
    const [route] = besoinsPour(main, BASE, ['road']);
    // La route prend un bois et une brique : il reste quatre bois.
    expect(route?.surplus).toEqual({ wood: 4 });
    expect(route?.manquant).toEqual({});
  });
});

describe('le chemin par la banque', () => {
  it('propose l échange qui comble, et le dit comblé', () => {
    // Quatre bois en trop, une brique manquante, quatre contre une.
    const main = counts({ wood: 5, wool: 1, grain: 1 });
    const [colonie] = besoinsPour(main, BASE, ['settlement']);

    expect(colonie?.manquant).toEqual({ brick: 1 });
    expect(colonie?.banque).toEqual([{ donne: 'wood', nombre: 4, recoit: 'brick' }]);
    expect(colonie?.comble).toBe(true);
  });

  it('sert d abord la ressource la moins chère à donner', () => {
    // Un port de bois : deux bois valent une carte, contre quatre ailleurs.
    // Le conseil doit passer par le bois même si la laine est plus abondante.
    const taux = { ...BASE, wood: 2 };
    const main = counts({ wood: 4, wool: 8, grain: 1 });
    const [colonie] = besoinsPour(main, taux, ['settlement']);

    expect(colonie?.banque).toEqual([{ donne: 'wood', nombre: 2, recoit: 'brick' }]);
  });

  it('enchaîne les échanges sans dépenser deux fois la même carte', () => {
    // Une ville coûte trois minerais et deux blés. Main : douze bois, rien
    // d'autre. Chaque échange coûte quatre bois, donc trois seulement sont
    // payables — et le manque n'est pas comblé.
    const main = counts({ wood: 12 });
    const [ville] = besoinsPour(main, BASE, ['city']);

    expect(ville?.manquant).toEqual({ grain: 2, ore: 3 });
    expect(ville?.banque).toHaveLength(3);
    expect(ville?.banque.every((e) => e.donne === 'wood' && e.nombre === 4)).toBe(true);
    expect(ville?.comble).toBe(false);
  });

  it('ne propose jamais de donner une ressource qui figure au coût', () => {
    // Trois minerais en main, il manque deux blés. Donner du minerai
    // reviendrait à défaire ce qu'on a déjà.
    const main = counts({ ore: 3, wool: 9 });
    const [ville] = besoinsPour(main, BASE, ['city']);

    expect(ville?.manquant).toEqual({ grain: 2 });
    expect(ville?.banque.every((e) => e.donne !== 'ore')).toBe(true);
    expect(ville?.banque.every((e) => e.donne === 'wool')).toBe(true);
    expect(ville?.comble).toBe(true);
  });

  it('renonce plutôt que de conseiller un échange impossible', () => {
    const main = counts({ wood: 2 });
    const [colonie] = besoinsPour(main, BASE, ['settlement']);

    expect(colonie?.comble).toBe(false);
    expect(colonie?.banque).toEqual([]);
  });

  it('donne le même conseil pour deux mains identiques', () => {
    // Un conseil qui change tout seul d'une image à l'autre n'inspire rien.
    const main = counts({ wood: 4, brick: 4, wool: 1, grain: 1 });
    const a = besoinsPour(main, BASE, ['city']);
    const b = besoinsPour(main, BASE, ['city']);
    expect(a).toEqual(b);
  });
});

describe('plusieurs constructions d un coup', () => {
  it('rend un besoin par construction, dans l ordre demandé', () => {
    const main = counts({ wood: 1, brick: 1 });
    const besoins = besoinsPour(main, BASE, ['road', 'settlement', 'city']);

    expect(besoins.map((b) => b.buildable)).toEqual(['road', 'settlement', 'city']);
    expect(besoins[0]?.manquant).toEqual({});
    expect(besoins[1]?.manquant).toEqual({ wool: 1, grain: 1 });
    expect(besoins[2]?.manquant).toEqual({ grain: 2, ore: 3 });
  });
});

describe('peutPayer', () => {
  it('dit oui au coût exact et non à une carte près', () => {
    expect(peutPayer(COSTS['city'], 'city')).toBe(true);
    expect(peutPayer(counts({ ore: 2, grain: 2 }), 'city')).toBe(false);
    expect(peutPayer(counts({ ore: 9, grain: 9 }), 'city')).toBe(true);
  });
});
