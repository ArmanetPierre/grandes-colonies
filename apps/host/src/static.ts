/**
 * Le service des fichiers du client compilé.
 *
 * En développement, Vite sert le client sur son propre port et ce fichier ne
 * sert à rien. En production il n'y a qu'un serveur, qu'un port et qu'un nom :
 * celui-ci rend la page aux joueurs et tient le WebSocket sur la même origine.
 * C'est ce qui permet au client de déduire l'adresse du jeu de celle de la
 * page, au lieu de coder un port en dur qu'un reverse proxy n'exposerait pas.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Les fichiers au nom haché par Vite ne changent jamais de contenu : les
 * garder un an épargne un rechargement complet du plateau 3D à chaque partie.
 * `index.html`, lui, ne doit jamais être gardé, sinon un déploiement ne se
 * voit pas.
 */
function cacheControl(chemin: string): string {
  return chemin.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
}

export function serveStatic(racine: string) {
  const base = resolve(racine);

  return (req: IncomingMessage, res: ServerResponse): boolean => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;

    const chemin = normalize(decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/'));
    let fichier = join(base, chemin);

    // Quoi que demande l'URL, on ne sort pas du dossier compilé.
    if (fichier !== base && !fichier.startsWith(base + '/')) return false;

    // Une application à une seule page : tout ce qui n'est pas un fichier
    // réel retombe sur `index.html`, qui décidera quoi afficher.
    if (!existsSync(fichier) || !statSync(fichier).isFile()) {
      fichier = join(base, 'index.html');
      if (!existsSync(fichier)) return false;
    }

    res.writeHead(200, {
      'content-type': TYPES[extname(fichier).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': cacheControl(chemin),
    });
    if (req.method === 'HEAD') { res.end(); return true; }
    createReadStream(fichier).pipe(res);
    return true;
  };
}
