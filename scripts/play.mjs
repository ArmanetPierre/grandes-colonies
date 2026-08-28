/**
 * Lance une soirée : le serveur de jeu et le client, d'une seule commande.
 *
 * Les deux doivent tourner ensemble — l'un porte les règles, l'autre sert la
 * page que les invités ouvrent — et personne n'a envie de jongler avec deux
 * terminaux au moment où douze personnes attendent. Ctrl+C arrête les deux.
 *
 * Tout se règle ensuite depuis l'écran de l'hôte — nombre de joueurs, forme
 * du plateau, durées, adversaires automatiques. Les variables ci-dessous ne
 * font que fixer le point de départ, pour ouvrir une soirée sans un clic.
 *
 *   npm run play                    huit joueurs, plateau en archipel
 *   PLAYERS=12 npm run play         douze sièges au départ
 *   BOARD=disque npm run play       plateau en disque, soirée plus courte
 *   BOTS=10 npm run play            dix adversaires automatiques au départ
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

/*
 * Les images d'abord.
 *
 * Elles vivent dans `assets/generated`, le client les sert depuis son dossier
 * `public`, et ce dossier n'est pas versionné : sur un dépôt fraîchement
 * cloné il est vide. Le plateau s'affichait alors sans ses terrains, sans
 * qu'aucun message ne signale l'étape manquante. On la fait ici, où personne
 * ne peut l'oublier.
 */
await import('./assets.mjs');

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

/*
 * Les adversaires automatiques ne sont plus lancés ici.
 *
 * C'est l'écran de l'hôte qui les tient désormais, parce que leur nombre se
 * décide en regardant la pièce se remplir et non trente secondes avant, dans
 * une variable d'environnement. `BOTS=10` reste lu — par le serveur, au
 * démarrage — et la molette de l'écran prend le relais ensuite. Les lancer
 * des deux côtés aurait simplement doublé la table.
 */
