import { createReadStream, cpSync, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const ICI = dirname(fileURLToPath(import.meta.url));

/** Les illustrations produites par `scripts/generate-assets.mjs`. */
const ILLUSTRATIONS = resolve(ICI, '../../assets/generated');

const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/**
 * Sert `assets/generated` sous l'URL `/assets`.
 *
 * Les images sont versionnées à la racine du dépôt, là où le générateur les
 * écrit. Un lien symbolique dans `public/` fonctionnait sur la machine qui
 * l'avait créé et nulle part ailleurs : après un clone, chaque tuile et chaque
 * carte tombait en 404. Le chemin est donc résolu ici, par Vite, plutôt que
 * par le système de fichiers d'un seul poste.
 */
function illustrations(): Plugin {
  let sortie = 'dist';

  return {
    name: 'grand-colonies:illustrations',

    configResolved(config) {
      sortie = config.build.outDir;
    },

    configureServer(serveur) {
      serveur.middlewares.use('/assets', (req, res, suivant) => {
        const demande = normalize(decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/'));
        const fichier = join(ILLUSTRATIONS, demande);

        // Quoi que demande l'URL, on ne sort pas du dossier des illustrations.
        if (!fichier.startsWith(ILLUSTRATIONS + '/')) return suivant();
        if (!existsSync(fichier) || !statSync(fichier).isFile()) return suivant();

        res.setHeader('content-type', TYPES[extname(fichier).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('cache-control', 'max-age=3600');
        createReadStream(fichier).pipe(res);
      });
    },

    // Le build recopie les illustrations telles quelles : `/assets` doit
    // exister dans la version compilée comme il existe en développement.
    closeBundle() {
      if (!existsSync(ILLUSTRATIONS)) return;
      cpSync(ILLUSTRATIONS, resolve(ICI, sortie, 'assets'), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), illustrations()],
  // Les illustrations ne sont pas dans `public/` : le plugin ci-dessus les
  // sert depuis leur emplacement canonique, à la racine du dépôt.
  publicDir: false,
  server: {
    // Écoute sur toutes les interfaces : les invités se connectent depuis
    // leur téléphone, pas depuis le PC hôte.
    host: true,
    port: 5173,
  },
});
