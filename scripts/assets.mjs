/**
 * Met les images générées à la portée du client.
 *
 * Le client les demande à `/assets/…`, donc depuis son dossier `public`. Or
 * elles sont produites dans `assets/generated/` par `generate-assets.mjs`, et
 * `public/assets` est ignoré par git — il n'a donc rien dans un dépôt fraîchement
 * cloné. Sans cette copie, chaque tuile pointe vers une image absente : le
 * plateau se dessine, mais vide, et rien dans la console ne dit qu'il manque
 * une étape plutôt qu'un fichier.
 *
 *   node scripts/assets.mjs          copie ce qui manque
 *   node scripts/assets.mjs --force  recopie tout
 */

import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(RACINE, 'assets/generated');
// Les tuiles étalonnées par scripts/etalonner.py portent le même nom que leur
// source et priment sur elle : c'est la version qui tient l'échelle de valeurs,
// et la seule chose que le modèle n'a jamais su tenir. Voir assets/README.md.
const ETALONNEES = join(RACINE, 'assets/processed');
const CIBLE = join(RACINE, 'packages/client/public/assets');

/** Les familles d'images que le client sait afficher. */
const FAMILLES = ['tiles', 'backgrounds', 'cards'];

const force = process.argv.includes('--force');

async function existe(chemin) {
  try { await stat(chemin); return true; } catch { return false; }
}

let copiees = 0;
let ignorees = 0;
let absentes = 0;
let etalonnees = 0;

await mkdir(CIBLE, { recursive: true });

for (const famille of FAMILLES) {
  const depuis = join(SOURCE, famille);
  if (!await existe(depuis)) {
    absentes++;
    continue;
  }

  const vers = join(CIBLE, famille);
  await mkdir(vers, { recursive: true });

  for (const nom of await readdir(depuis)) {
    const cible = join(vers, nom);
    // On ne recopie pas ce qui est déjà là : trente-huit images font dix-sept
    // méga-octets, et `npm run play` passe par ici à chaque soirée.
    if (!force && await existe(cible)) { ignorees++; continue; }

    const etalonnee = join(ETALONNEES, famille, nom);
    const source = await existe(etalonnee) ? etalonnee : join(depuis, nom);
    if (source === etalonnee) etalonnees++;
    await cp(source, cible);
    copiees++;
  }
}

if (absentes === FAMILLES.length) {
  console.error(
    "  Aucune image trouvée dans assets/generated.\n"
    + "  Le plateau s'affichera sans ses terrains — voir assets/README.md.",
  );
} else if (copiees > 0) {
  const detail = [
    etalonnees ? `dont ${etalonnees} étalonnée(s)` : null,
    ignorees ? `${ignorees} déjà à jour` : null,
  ].filter(Boolean).join(', ');
  console.log(`  ${copiees} image(s) mise(s) en place${detail ? ` — ${detail}` : ''}.`);
}
