/** Lancement du serveur pour le développement : `npm run dev:server`. */
import { GameServer } from './gameServer.js';

const server = new GameServer({
  seed: 'dev',
  playerNames: Array.from({ length: 8 }, (_, i) => `Joueur ${i + 1}`),
  autoStart: true,
});
await server.listen(2567);
console.log('serveur de jeu sur ws://localhost:2567');
