/**
 * Point d'entrée de l'hôte — le programme lancé sur le PC qui héberge.
 *
 * Il démarre le serveur de jeu et sert l'écran de l'hôte sur le même port.
 * Un seul port, une seule adresse à retenir : le premier obstacle d'une
 * soirée n'est pas le jeu mais la connexion, et personne ne devrait avoir à
 * chercher une adresse IP dans les réglages système.
 */

import { networkInterfaces } from 'node:os';

import QRCode from 'qrcode';

import { GameServer } from '@grand-colonies/server';

import { renderHostPage } from './hostPage.js';

const PORT = Number(process.env['PORT'] ?? 2567);

/**
 * L'adresse IPv4 de la machine sur le réseau local.
 *
 * On écarte la boucle locale et les interfaces internes : elles fonctionnent
 * sur le PC hôte mais ne mènent nulle part depuis le téléphone d'un invité.
 */
export function lanAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      return address.address;
    }
  }
  return undefined;
}

/** Un code de partie lisible à voix haute, plutôt qu'un identifiant opaque. */
export function readableCode(seed: string): string {
  const words = ['AGORA', 'OLIVIER', 'MARBRE', 'EGEE', 'AMPHORE', 'CYPRES', 'PORPHYRE', 'LAURIER'];
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const word = words[hash % words.length] ?? 'AGORA';
  return `${word}-${(hash % 90) + 10}`;
}

export interface HostHandle {
  readonly port: number;
  readonly code: string;
  readonly url: string;
  close(): Promise<void>;
}

export async function startHost(playerCount = 8, port = PORT): Promise<HostHandle> {
  const seed = `partie-${Date.now()}`;
  const code = readableCode(seed);
  const host = lanAddress() ?? 'localhost';

  // En développement le client a son propre serveur ; en production il sera
  // servi par celui-ci. C'est l'adresse que les invités doivent ouvrir.
  const clientPort = Number(process.env['CLIENT_PORT'] ?? 5173);
  const url = `http://${host}:${clientPort}`;
  const qrDataUrl = await QRCode.toDataURL(url, { width: 420, margin: 1 });
  const page = renderHostPage({ url, code, qrDataUrl, playerCount });

  const server: GameServer = new GameServer({
    seed,
    playerNames: Array.from({ length: playerCount }, (_, i) => `Joueur ${i + 1}`),
    onRequest: (req, res) => {
      if (req.url === '/' || req.url === '/hote') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(page);
        return true;
      }
      if (req.url === '/api/start' && req.method === 'POST') {
        const launched = server.startGame();
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ started: true, launched }));
        return true;
      }
      if (req.url === '/api/seats') {
        const seats = server.session.allSeats().map((seat) => ({
          name: seat.name,
          connected: seat.connected,
        }));
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(seats));
        return true;
      }
      return false;
    },
  });

  await server.listen(port);

  console.log('');
  console.log('  GRAND COLONIES');
  console.log('');
  console.log(`  Écran hôte   http://${host}:${port}`);
  console.log(`  Joueurs      ${url}`);
  console.log(`  Code         ${code}`);
  console.log('');

  return { port, code, url, close: () => server.close() };
}

// Lancement direct : `npm run host`.
if (process.argv[1]?.includes('main.')) {
  void startHost(Number(process.env['PLAYERS'] ?? 8));
}
