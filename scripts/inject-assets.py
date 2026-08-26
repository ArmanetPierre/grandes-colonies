#!/usr/bin/env python3
"""
Injecte les tuiles générées dans les wireframes exportés.

Le fichier d'origine n'est jamais modifié : le script écrit une copie enrichie.
On peut donc ré-exporter les wireframes depuis l'outil de design et relancer
l'injection sans rien perdre.

    python3 scripts/inject-assets.py

Ce qui est injecté :
  - une image de terrain sur chaque hexagone du plateau (.hexL / .hexM / .hexS),
    répartie pour former une île : mer sur le pourtour, terres à l'intérieur ;
  - un vrai jeton rond derrière chaque numéro, sans quoi les chiffres
    deviendraient illisibles sur les images.

Le choix du terrain est déterministe : deux exécutions donnent le même plateau.
"""

import json
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SOURCE = os.path.join(ROOT, 'Wireframes Grand Colonies.html')
TARGET = os.path.join(ROOT, 'Wireframes Grand Colonies — avec assets.html')

STYLE_CSS = """
  /* Spécificité renforcée : le bundle injecte sa feuille au runtime, donc
     après ce bloc. À !important égal, la règle la plus spécifique l'emporte. */
  .hrow .hexL, .hrow .hexM, .hrow .hexS {
    background-size: cover !important;
    background-position: center !important;
    background-repeat: no-repeat !important;
  }
  /* Sans jeton opaque, les numéros disparaissent sur les images.
     C'est exactement la contrainte « centre calme » de la spec. */
  .hrow .hexL .hnL, .hrow .hexM .hnM, .hrow .hexS .hnS {
    background: #fdfaf3 !important;
    border-radius: 50% !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    color: #1c1a17 !important;
    font-weight: 700 !important;
    line-height: 1 !important;
    border: 1px solid rgba(0, 0, 0, .25) !important;
    box-shadow: 0 1px 4px rgba(0, 0, 0, .45) !important;
  }
  .hrow .hexL .hnL { width: 24px !important; height: 24px !important; font-size: 13px !important; }
  .hrow .hexM .hnM { width: 18px !important; height: 18px !important; font-size: 10px !important; }
  .hrow .hexS .hnS { width: 14px !important; height: 14px !important; font-size: 8px !important; }
  /* 6 et 8 sont les nombres les plus productifs : ils se signalent en rouge,
     comme sur un plateau physique. */
  .hrow .gc-hot { color: #a3301a !important; }
  /* Masquer par classe et non en style inline : la règle ci-dessus impose
     display:flex !important, qu'un style inline ne peut pas surcharger.
     Le sélecteur doit être plus spécifique qu'elle, d'où la classe ajoutée
     au même élément plutôt qu'un sélecteur court. */
  .hrow .hexL .hnL.gc-notoken,
  .hrow .hexM .hnM.gc-notoken,
  .hrow .hexS .hnS.gc-notoken { display: none !important; }
"""

SCRIPT = """
<script>
(function () {
  var INDEX = window.ASSET_INDEX;
  if (!INDEX) { console.warn('[gc] assets/generated/index.js absent'); return; }

  var LAND = ['forest', 'pasture', 'field', 'hills', 'mountain', 'desert', 'gold'];
  var EDGE = ['sea', 'sea', 'sea', 'fish', 'sea', 'sea', 'sea', 'unexplored'];

  function url(name) {
    var path = INDEX['tile_' + name];
    return path ? 'assets/generated/' + path : null;
  }

  var styled = false;
  function applyStyle() {
    if (styled) return;
    var el = document.createElement('style');
    el.id = 'gc-assets';
    el.textContent = GC_CSS;
    document.head.appendChild(el);
    styled = true;
  }

  function paint() {
  // Les hexagones sont groupés en rangées (.hrow) ; chaque plateau est
  // l'ensemble des rangées partageant le même parent.
  var boards = new Map();
  document.querySelectorAll('.hrow').forEach(function (row) {
    var parent = row.parentElement;
    if (!boards.has(parent)) boards.set(parent, []);
    boards.get(parent).push(row);
  });

  var painted = 0;
  boards.forEach(function (rows) {
    // Pendant un re-rendu, le bundle passe par des états où les rangées sont
    // momentanément isolées. Calculer une bordure sur un plateau d'une seule
    // rangée classerait tout le plateau en mer : on ignore ces états.
    if (rows.length < 2) return;

    var n = 0;
    rows.forEach(function (row, r) {
      var hexes = [].slice.call(row.querySelectorAll('.hexL, .hexM, .hexS'));
      hexes.forEach(function (hex, c) {
        // Le terrain est figé au premier calcul : un hexagone ne change jamais
        // de nature, même si le bundle le re-rend.
        var name = hex.dataset.gcTerrain;
        if (!name) {
          var onEdge = r === 0 || r === rows.length - 1 || c === 0 || c === hexes.length - 1;
          name = onEdge ? EDGE[(r + c) % EDGE.length] : LAND[n % LAND.length];
        }
        if (LAND.indexOf(name) >= 0) n++;

        var src = url(name);
        if (!src) return;
        hex.style.backgroundImage = 'url("' + src + '")';
        hex.dataset.gcTerrain = name;
        painted++;

        // Une tuile de mer ne produit rien : elle ne porte pas de jeton.
        var token = hex.querySelector('.hnL, .hnM, .hnS');
        if (!token) return;
        if (name === 'sea' || name === 'unexplored') {
          token.classList.add('gc-notoken');
        } else {
          var value = (token.textContent || '').trim();
          if (value === '6' || value === '8') token.classList.add('gc-hot');
        }
      });
    });
  });

  if (painted) applyStyle();
  console.log('[gc] ' + painted + ' hexagones habillés sur ' + boards.size + ' plateaux');
    return painted;
  }

  // Le bundle construit son DOM en JavaScript, et le re-rend après coup : les
  // styles inline posés sur les hexagones survivent, mais les classes et les
  // masquages appliqués aux jetons sont effacés. Un observateur rattrape donc
  // chaque re-rendu — paint() est idempotent, et le débounce évite de boucler
  // sur nos propres écritures.
  var pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = null; paint(); }, 80);
  }

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  paint();
})();
</script>
"""


def main():
    if not os.path.exists(SOURCE):
        sys.exit('Wireframes introuvables : ' + SOURCE)

    with open(SOURCE, encoding='utf-8') as fh:
        html = fh.read()

    if 'id="gc-assets"' in html:
        sys.exit('Le fichier source contient déjà une injection — vérifier SOURCE.')

    css = '<script>window.GC_CSS = ' + json.dumps(STYLE_CSS) + ';</script>'
    block = css + '<script src="assets/generated/index.js"></script>' + SCRIPT

    if '</body>' not in html:
        sys.exit('Pas de </body> dans le fichier source.')

    out = html.replace('</body>', block + '\n</body>', 1)

    with open(TARGET, 'w', encoding='utf-8') as fh:
        fh.write(out)

    print('écrit :', os.path.basename(TARGET))
    print('source inchangée :', os.path.basename(SOURCE))


if __name__ == '__main__':
    main()
