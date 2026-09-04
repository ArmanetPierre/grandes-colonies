import { describe, expect, it } from 'vitest';

import { PORT_KINDS } from '@grandes-colonies/engine';

import { lanAddress, readableCode, startHost } from '../src/main.js';
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

describe('écran de l hôte, vu d Internet', () => {
  /**
   * Le panneau de maître de jeu n'a aucune authentification, et n'en a jamais
   * eu besoin : sa protection était de vivre sur un port que seuls les invités
   * du salon connaissaient. Depuis que le jeu est publié derrière un tunnel,
   * c'est cette garde qui tient — et une garde sans test se fait supprimer un
   * jour par mégarde.
   */
  it('refuse /hote et /api/* aux requêtes venues du tunnel', async () => {
    process.env['PARTIES'] = ''; // pas de journal de partie pour un test
    const hote = await startHost(4, 28567);
    const base = 'http://127.0.0.1:28567';
    const duTunnel = { 'cf-connecting-ip': '203.0.113.7' };

    try {
      // Sans l'en-tête de Cloudflare, c'est le réseau local : tout est ouvert.
      expect((await fetch(`${base}/hote`)).status).toBe(200);
      expect((await fetch(`${base}/api/seats`)).status).toBe(200);

      // Avec, la requête a traversé le tunnel. 404 plutôt que 403 : inutile
      // d'annoncer l'existence de ce qu'on refuse.
      expect((await fetch(`${base}/hote`, { headers: duTunnel })).status).toBe(404);
      expect((await fetch(`${base}/api/seats`, { headers: duTunnel })).status).toBe(404);
      expect((await fetch(`${base}/api/settings`, { headers: duTunnel })).status).toBe(404);
      expect((await fetch(`${base}/api/gm`, {
        method: 'POST', headers: { ...duTunnel, 'content-type': 'application/json' }, body: '{}',
      })).status).toBe(404);

      // Les joueurs, eux, arrivent par le tunnel : rien de ce qui les concerne
      // ne doit tomber avec la garde.
      expect((await fetch(`${base}/healthz`, { headers: duTunnel })).status).toBe(200);
    } finally {
      await hote.close();
    }
  });
});
