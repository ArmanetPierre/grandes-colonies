/**
 * L'adresse du serveur de partie, vue depuis le navigateur.
 *
 * Trois situations, et elles ne se ressemblent pas :
 *
 *   — **en développement**, le client a son propre serveur Vite sur 5173 et le
 *     jeu écoute à côté, sur 2567. Il faut donc nommer le port explicitement ;
 *
 *   — **en production**, un seul serveur sert la page et tient le WebSocket,
 *     derrière un seul nom et un seul port. L'origine suffit, et la nommer
 *     autrement casserait tout : `ws://` depuis une page `https://` est du
 *     contenu mixte, que tous les navigateurs refusent en silence ;
 *
 *   — **`?serveur=`**, pour viser une autre table sans toucher à celle qui
 *     tourne.
 */

/** `wss:` derrière HTTPS, `ws:` sinon — sans quoi le navigateur bloque. */
function scheme(): string {
  return location.protocol === 'https:' ? 'wss:' : 'ws:';
}

export function serverUrl(): string {
  const asked = new URLSearchParams(location.search).get('serveur');
  if (asked) return asked.startsWith('ws') ? asked : `${scheme()}//${asked}`;
  if (import.meta.env.PROD) return `${scheme()}//${location.host}`;
  return `ws://${location.hostname}:2567`;
}
