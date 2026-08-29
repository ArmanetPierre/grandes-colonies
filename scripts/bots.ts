/**
 * Adversaires automatiques, branchés comme de vrais clients.
 *
 * Ils ne voient que ce qu'un joueur voit — sa vue publique et sa vue privée —
 * et passent par le même WebSocket que tout le monde. Ils ne peuvent donc pas
 * tricher, et ce qu'ils font est exactement ce qu'un humain pourrait faire.
 *
 * Leur cervelle n'est pas ici : elle est dans `packages/sim/src/pilote/`, où
 * elle est mesurable en dix mille parties. Ce fichier ne fait que la
 * raccorder au réseau — ouvrir la connexion, tenir la dernière vue reçue,
 * temporiser, et renvoyer la commande décidée. Le partage n'est pas une
 * commodité : c'est ce qui garantit que les adversaires de la soirée sont
 * exactement ceux que la simulation a éprouvés.
 *
 *   BOTS=11 npm run play                       onze adversaires, une place pour toi
 *   npx tsx scripts/bots.ts 5                  cinq adversaires sur une partie déjà lancée
 *   npx tsx scripts/bots.ts 5 --niveau=1       cinq apprentis, pour jouer en famille
 *   npx tsx scripts/bots.ts 5 --caractere=corsaire   cinq corsaires, si le cœur t'en dit
 */

import { WebSocket } from 'ws';

import type { PrivatePlayerView, PublicGameView } from '@grand-colonies/protocol';
import { type CaractereId, type Place, composerLaTable, estCaractere } from '@grand-colonies/sim';

const URL = process.env['BOT_URL'] ?? 'ws://localhost:2567';

/** Un drapeau `--clé=valeur` de la ligne de commande. */
function drapeau(nom: string): string | undefined {
  const prefixe = `--${nom}=`;
  return process.argv.find((a) => a.startsWith(prefixe))?.slice(prefixe.length);
}

const COUNT = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? process.env['BOTS'] ?? 3);
const NIVEAU = drapeau('niveau') ?? process.env['BOT_NIVEAU'] ?? 3;
const CARACTERE_DEMANDE = drapeau('caractere') ?? process.env['BOT_CARACTERE'];
const CARACTERES: CaractereId | 'varie' = estCaractere(CARACTERE_DEMANDE) ? CARACTERE_DEMANDE : 'varie';

const table = composerLaTable(COUNT, {
  niveau: NIVEAU,
  caracteres: CARACTERES,
  // La graine change à chaque lancement : deux soirées de suite ne doivent
  // pas voir les mêmes adversaires jouer exactement les mêmes coups.
  graine: `bots-${Date.now().toString(36)}`,
  conclut: true,
});

let actionCounter = 0;
const nextId = (): string => `bot-${Date.now().toString(36)}-${actionCounter++}`;

/** Un bot, du raccordement à sa dernière décision. */
function connecter(place: Place): void {
  const socket = new WebSocket(URL);
  let priv: PrivatePlayerView | undefined;
  let pub: PublicGameView | undefined;
  let derniere = '';
  let enAttente = false;

  // `bot: true` ne donne aucun droit — mêmes vues, mêmes refus. Il sert à ce
  // que le serveur sache à qui retirer un siège quand l'hôte réduit
  // l'effectif : à un bot, jamais à quelqu'un qui vient de s'installer.
  socket.on('open', () => socket.send(JSON.stringify({ type: 'join', name: place.nom, bot: true })));
  socket.on('error', (error) => console.error(`  ${place.nom} : ${error.message}`));

  socket.on('message', (raw) => {
    const frame = JSON.parse(String(raw)) as { type: string; payload: unknown };
    if (frame.type === 'seat') console.log(`  ${place.nom} rejoint`);
    if (frame.type === 'full') console.log(`  ${place.nom} : partie complète`);
    if (frame.type === 'public') pub = frame.payload as PublicGameView;
    if (frame.type === 'private') priv = frame.payload as PrivatePlayerView;
    if (!priv || !pub || enAttente) return;

    const coup = place.pilote.decider(pub, priv);
    if (!coup) { derniere = ''; return; }

    /*
     * Un garde-fou : si le serveur refuse toujours la même chose, on cesse de
     * la répéter plutôt que d'inonder la partie. Le pilote est stable — deux
     * appels dans le même état rendent le même coup — donc cette signature
     * suffit à repérer une boucle.
     */
    const signature = JSON.stringify(coup);
    if (signature === derniere) return;
    derniere = signature;

    /*
     * Le temps de réflexion vient du niveau.
     *
     * Sans lui, douze bots jouent un cycle entier avant que l'écran n'ait
     * fini de se redessiner, et personne ne voit rien de ce qui se passe. Un
     * apprenti hésite plus longtemps qu'un stratège : c'est faux du point de
     * vue du calcul, mais c'est ce qu'on attend en regardant la table.
     */
    enAttente = true;
    setTimeout(() => {
      enAttente = false;
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: 'command', command: { actionId: nextId(), ...coup } }));
      }
    }, place.pilote.reflexion());
  });
}

const premier = table[0];
if (premier) {
  console.log(`  ${COUNT} adversaires se connectent à ${URL}`
    + ` — niveau ${premier.niveau.id} (${premier.niveau.nom})`
    + (CARACTERES === 'varie' ? ', caractères variés' : `, tous ${premier.caractere.nom.toLowerCase()}s`));
}
for (const place of table) connecter(place);
