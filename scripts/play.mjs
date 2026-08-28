/**
 * Lance une soirée : le serveur de jeu et le client, d'une seule commande.
 *
 * Les deux doivent tourner ensemble — l'un porte les règles, l'autre sert la
 * page que les invités ouvrent — et personne n'a envie de jongler avec deux
 * terminaux au moment où douze personnes attendent. Ctrl+C arrête les deux.
 *
 *   npm run play                    douze joueurs, plateau en archipel
 *   PLAYERS=8 npm run play          huit joueurs
 *   BOARD=disque npm run play       plateau en disque, soirée plus courte
 *   BOTS=11 npm run play            onze adversaires automatiques
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

/** Un processus enfant qui partage notre sortie et notre environnement. */
function start(name, args) {
  const child = spawn(npx, args, { cwd: root, stdio: 'inherit', env: process.env });
  child.on('exit', (code) => {
    // Si l'un tombe, l'autre n'a plus de raison d'être : mieux vaut un arrêt
    // net qu'un serveur orphelin qui garde le port.
    if (!stopping) {
      console.error(`\n  ${name} s'est arrêté (code ${code}). Arrêt de la soirée.`);
      stop(code ?? 1);
    }
  });
  return child;
}

let stopping = false;
const children = [];

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 200);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

children.push(start('le client', ['vite', '--config', 'packages/client/vite.config.ts', 'packages/client']));
children.push(start('le serveur', ['tsx', 'apps/host/src/main.ts']));

/**
 * Les adversaires automatiques, s'ils sont demandés.
 *
 * Ils attendent que le serveur écoute : lancés trop tôt, ils échoueraient à
 * se connecter et abandonneraient la table au joueur seul.
 */
const bots = Number(process.env.BOTS ?? 0);
if (bots > 0) {
  const wait = setInterval(() => {
    fetch('http://localhost:2567/api/seats')
      .then(() => {
        clearInterval(wait);
        if (!stopping) children.push(start('les bots', ['tsx', 'scripts/bots.ts', String(bots)]));
      })
      .catch(() => { /* le serveur n'écoute pas encore */ });
  }, 700);
  // Sans quoi un serveur qui ne démarre jamais laisserait un minuteur derrière.
  setTimeout(() => clearInterval(wait), 30000);
}
