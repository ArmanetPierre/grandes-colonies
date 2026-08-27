/**
 * Point d'entrée de l'hôte — le programme que tu lances sur ton PC.
 *
 * Il démarre le serveur de jeu et affiche l'adresse à laquelle les autres se
 * connectent. Cette adresse est le premier obstacle d'une soirée : personne
 * ne doit avoir à chercher une adresse IP dans les réglages système.
 */

import { networkInterfaces } from 'node:os';

import { GameServer } from '@grand-colonies/server';

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

export function startHost(playerCount = 8): { port: number; code: string; url: string } {
  const seed = `partie-${Date.now()}`;
  const code = readableCode(seed);

  const server = new GameServer({
    seed,
    playerNames: Array.from({ length: playerCount }, (_, i) => `Joueur ${i + 1}`),
  });
  void server.listen(PORT);

  const host = lanAddress() ?? 'localhost';
  const url = `http://${host}:${PORT}`;

  console.log('');
  console.log('  GRAND COLONIES');
  console.log('');
  console.log(`  Adresse    ${url}`);
  console.log(`  Code       ${code}`);
  console.log(`  Joueurs    ${playerCount}`);
  console.log('');
  console.log('  Les autres joueurs ouvrent cette adresse dans leur navigateur.');
  console.log('');

  return { port: PORT, code, url };
}

// Lancement direct : `node apps/host/src/main.ts`.
if (process.argv[1]?.endsWith('main.ts') || process.argv[1]?.endsWith('main.js')) {
  startHost(Number(process.env['PLAYERS'] ?? 8));
}
