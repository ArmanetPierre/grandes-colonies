import { describe, expect, it } from 'vitest';

import { PORT_KINDS } from '@grandes-colonies/engine';

import { lanAddress, readableCode } from '../src/main.js';
import { CONTRACT_PORT_KINDS, PORT_LABELS, tableViewScript } from '../src/tableView.js';

describe('adresse LAN', () => {
  /**
   * Elle doit mener quelque part depuis le téléphone d'un invité : la
   * boucle locale fonctionne sur le PC hôte et nulle part ailleurs.
   */
  it('ne renvoie jamais la boucle locale', () => {
    const address = lanAddress();
    if (address === undefined) return; // machine sans réseau : rien à vérifier
    expect(address).not.toBe('127.0.0.1');
    expect(address.startsWith('127.')).toBe(false);
  });

  it('renvoie une adresse IPv4 bien formée', () => {
    const address = lanAddress();
    if (address === undefined) return;
    expect(address).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
  });
});

describe('code de partie', () => {
  it('reste stable pour une même graine', () => {
    expect(readableCode('partie-42')).toBe(readableCode('partie-42'));
  });

  it('se lit à voix haute', () => {
    // Un mot, un tiret, deux chiffres : dictable sans épeler.
    expect(readableCode('partie-42')).toMatch(/^[A-Z]+-\d{2}$/);
  });

  it('varie d une partie à l autre', () => {
    const codes = new Set(Array.from({ length: 40 }, (_, i) => readableCode(`partie-${i}`)));
    expect(codes.size).toBeGreaterThan(5);
  });
});

/**
 * Les ports sur l'écran de table.
 *
 * Ils y manquaient : l'écran commun montrait les tuiles, les routes et les
 * pièces, mais pas les ports — alors que ce sont des positions de course, et
 * que c'est autour de cet écran qu'on négocie à voix haute.
 */
describe('ports de l écran de table', () => {
  it('donne un panneau à chaque type de port du moteur', () => {
    // Le moteur seul fait foi : un type ajouté là sans libellé ici
    // s'afficherait sur la table sous son nom anglais.
    for (const kind of PORT_KINDS) {
      expect(PORT_LABELS[kind], `port « ${kind} » sans panneau`).toBeDefined();
    }
  });

  it('marque les ports à contrat, qui n ont qu un exemplaire chacun', () => {
    for (const kind of CONTRACT_PORT_KINDS) expect(PORT_LABELS[kind]).toBeDefined();
    // Leur taux ne les distingue pas d'un 2:1 ordinaire : c'est la seconde
    // ligne qui porte l'échange, donc elle ne peut pas être vide.
    for (const kind of CONTRACT_PORT_KINDS) {
      expect(PORT_LABELS[kind]?.goods.length ?? 0).toBeGreaterThan(3);
    }
  });

  it('dessine les ports du plateau, poussés vers l eau', () => {
    const script = tableViewScript();
    expect(script).toContain('view.ports');
    expect(script).toContain('portAnchor');
    // Avant les pièces : une colonie posée sur un port doit rester lisible.
    expect(script.indexOf('view.ports')).toBeLessThan(script.indexOf('for (const road of view.roads)'));
  });
});
