/*
 * Assemble les pages de docs/ : barre de tête, sommaire du site, fil de
 * lecture, pied de page. Chaque page est écrite avec ses seuls contenus et
 * quatre marqueurs ; ce script les remplace par du HTML statique, de sorte
 * que le dossier livré ne dépende d'aucun outil pour s'ouvrir.
 *
 * Sources : docs/_pages/*.html — Sortie : docs/*.html
 * Usage   : node docs/tisser.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DOCS = new URL('.', import.meta.url).pathname;
const SRC = join(DOCS, '_pages');

const PAGES = [
  { f: 'index.html',        nom: 'Accueil',                groupe: null },
  { f: 'monde.html',        nom: 'Le récit',               groupe: 'Le monde' },
  { f: 'archipel.html',     nom: 'L’archipel',             groupe: 'Le monde' },
  { f: 'terres.html',       nom: 'Les terres',             groupe: 'Le monde' },
  { f: 'premiers-pas.html', nom: 'Premiers pas',           groupe: 'Jouer' },
  { f: 'cycle.html',        nom: 'Le cycle',               groupe: 'Jouer' },
  { f: 'construction.html', nom: 'Bâtir',                  groupe: 'Jouer' },
  { f: 'commerce.html',     nom: 'Commercer',              groupe: 'Jouer' },
  { f: 'cartes.html',       nom: 'Les cartes',             groupe: 'Jouer' },
  { f: 'voleur.html',       nom: 'Le sept et l’Errant',    groupe: 'Jouer' },
  { f: 'victoire.html',     nom: 'Gagner',                 groupe: 'Jouer' },
  { f: 'variantes.html',    nom: 'Variantes',              groupe: 'Jouer' },
  { f: 'mecanismes.html',   nom: 'Sous le capot',          groupe: 'Coulisses' },
  { f: 'horizon.html',      nom: 'L’horizon',              groupe: 'Coulisses' },
  { f: 'glossaire.html',    nom: 'Glossaire',              groupe: 'Coulisses' },
];

const BARRE = `<header class="barre">
  <div class="barre-inner">
    <a class="marque" href="index.html">Grand <span>Colonies</span></a>
    <button class="bascule ouvre-sommaire" type="button" aria-expanded="false">Sommaire</button>
    <div class="barre-espace"></div>
    <a class="barre-lien" href="regles.html">Manuel en une page</a>
    <button class="bascule bascule-registre" type="button">Registre</button>
  </div>
</header>`;

const PIED = `<footer class="pied">
  <div class="pied-inner">
    <p><strong>Grand Colonies</strong> — variante de Catan pour 8 à 12 joueurs, jouable en réseau
    local. Projet personnel, sans affiliation avec les éditeurs de Catan, Seafarers,
    Cities&nbsp;&amp;&nbsp;Knights, Traders&nbsp;&amp;&nbsp;Barbarians ou Explorers&nbsp;&amp;&nbsp;Pirates,
    dont il s’inspire.</p>
    <p>Le récit de l’Archipel est une fiction : il n’a aucun effet sur les règles.
    Les règles font foi telles qu’elles sont écrites ici, et le
    <a href="../RULES_CONTRACT.md">contrat de règles</a> fait foi sur le code.</p>
  </div>
</footer>`;

/** Titres des sections d'une page, pour déplier ses ancres dans le sommaire. */
function ancres(html) {
  const out = [];
  const re = /<section id="([^"]+)"[^>]*>\s*(?:<[^>]+>\s*)*?<h2[^>]*>([\s\S]*?)<\/h2>/g;
  let m;
  while ((m = re.exec(html))) {
    // Les étiquettes d'état (« À venir ») appartiennent au titre affiché,
    // pas à son entrée de sommaire, où elles feraient du bruit.
    const titre = m[2]
      .replace(/<span class="badge[\s\S]*?<\/span>/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    out.push({ id: m[1], titre });
  }
  return out;
}

function sommaire(courante, mesAncres) {
  const bloc = (p) => {
    const ici = p.f === courante;
    const lien = `<li><a href="${p.f}"${ici ? ' aria-current="page"' : ''}>${p.nom}</a>`;
    if (!ici || mesAncres.length === 0) return lien + '</li>';
    const items = mesAncres.map((a) => `<li><a href="#${a.id}">${a.titre}</a></li>`).join('\n            ');
    return `${lien}
          <ul class="ancres">
            ${items}
          </ul></li>`;
  };

  const groupes = [];
  // Sentinelle distincte de `null`, qui est un groupe légitime : la première
  // page n'en a pas, et comparer à `null` ouvrirait zéro groupe.
  let courant = Symbol('aucun');
  for (const p of PAGES) {
    if (p.groupe !== courant) { groupes.push({ titre: p.groupe, pages: [] }); courant = p.groupe; }
    groupes.at(-1).pages.push(p);
  }

  const corps = groupes.map((g) => `    <div class="sommaire-groupe">
${g.titre ? `      <div class="sommaire-titre">${g.titre}</div>\n` : ''}      <ul>
        ${g.pages.map(bloc).join('\n        ')}
      </ul>
    </div>`).join('\n');

  return `<nav class="sommaire" aria-label="Sommaire de la documentation">
${corps}
    <div class="sommaire-groupe">
      <div class="sommaire-titre">À emporter</div>
      <ul>
        <li><a href="regles.html">Manuel en une page</a></li>
      </ul>
    </div>
  </nav>`;
}

function fil(i) {
  const av = PAGES[i - 1];
  const ap = PAGES[i + 1];
  const lien = (p, sens, cls) => `    <a href="${p.f}"${cls ? ` class="${cls}"` : ''}>
      <span class="fil-sens">${sens}</span>
      <span class="fil-nom">${p.nom}</span>
    </a>`;
  const parts = [];
  if (av) parts.push(lien(av, 'Page précédente', ''));
  if (ap) parts.push(lien(ap, 'Page suivante', 'suivant'));
  return `<nav class="fil" aria-label="Pages voisines">\n${parts.join('\n')}\n  </nav>`;
}

let n = 0;
for (const [i, p] of PAGES.entries()) {
  const source = join(SRC, p.f);
  let html;
  try { html = await readFile(source, 'utf8'); } catch { console.log(`— absente : ${p.f}`); continue; }
  const sortie = html
    .replace('<!--BARRE-->', BARRE)
    .replace('<!--NAV-->', sommaire(p.f, ancres(html)))
    .replace('<!--FIL-->', fil(i))
    .replace('<!--PIED-->', PIED);
  await writeFile(join(DOCS, p.f), sortie);
  n++;
}
console.log(`${n} pages tissées`);
