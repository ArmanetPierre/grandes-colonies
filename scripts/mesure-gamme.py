#!/usr/bin/env python3
"""
Contrôle chiffré de la gamme des tuiles.

Le test à l'œil ne suffit pas. La première série paraissait acceptable image
par image, et la mesure a montré ce que l'œil laissait passer : des saturations
allant de 8 % à 57 %, et cinq tuiles sur dix à la même luminosité — donc
indiscernables en vue d'ensemble, où c'est la valeur qu'on lit avant la teinte.

Ce script vérifie les trois propriétés qui font une série harmonieuse, et qui
sont exactement celles qu'un prompt ne garantit pas :

  · la LUMINOSITÉ de chaque tuile suit l'échelle déclarée dans prompts.json
    (champ `color`), et deux tuiles ne se retrouvent jamais au même échelon ;
  · la SATURATION reste dans une gamme commune — c'est elle qui fait l'unité ;
  · le CONTRASTE INTERNE reste modéré : trop bas, la tuile est une surface
    morte ; trop haut, les routes et les colonies posées dessus ne se lisent
    plus.

    python3 scripts/mesure-gamme.py              les tuiles telles qu'elles partiront
    python3 scripts/mesure-gamme.py --brut       la sortie brute du modèle
    python3 scripts/mesure-gamme.py --planche    la planche de série, avant elles

Sort en code 1 si une tuile est hors tolérance : le contrôle est bloquant.
"""

import colorsys
import json
import os
import sys

from PIL import Image, ImageStat

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
GENERATED = os.path.join(ROOT, 'assets/generated')
PROCESSED = os.path.join(ROOT, 'assets/processed')

# Tolérances. L'échelle de valeurs avance par échelons d'environ 16 points :
# au-delà de 12 points de dérive, une tuile commence à empiéter sur sa voisine.
ECART_L_MAX = 12
ECART_SAT_MAX = 12
CONTRASTE = (16, 34)   # écart-type de luminance admis à l'intérieur d'une tuile
# Relevé haut délibérément : une tuile sous 16 est un aplat, et c'est le défaut qui a
# fait rejeter la première planche — juste, harmonieuse, et sans vie. Le plafond reste
# bas parce que routes et colonies se dessinent par-dessus.
ECART_VOISINES_MIN = 9  # deux tuiles plus proches que ça se confondent à 120 px


def chemin(index, asset_id, brut=False):
    """Le fichier qui fait foi pour cet asset.

    Même règle que scripts/assets.mjs : la version étalonnée prime sur la
    version brute, parce que c'est elle qui part chez le client. `brut=True`
    force la sortie du modèle — c'est elle qu'on regarde pour décider s'il faut
    régénérer, l'étalonnage ne rattrapant que la couleur, jamais la géométrie.
    """
    if not brut:
        etalonnee = os.path.join(PROCESSED, index[asset_id])
        if os.path.exists(etalonnee):
            return etalonnee
    return os.path.join(GENERATED, index[asset_id])


def luminance(rgb):
    r, g, b = rgb
    return 0.299 * r + 0.587 * g + 0.114 * b


def cible(hexa):
    """Luminosité et saturation visées, lues sur la couleur de référence."""
    r, g, b = (int(hexa[i:i + 2], 16) for i in (1, 3, 5))
    _, s, _ = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return luminance((r, g, b)), s * 100


def mesure(path):
    """Luminosité moyenne, saturation moyenne et contraste interne d'une image."""
    img = Image.open(path).convert('RGB').resize((256, 256), Image.LANCZOS)
    gris = ImageStat.Stat(img.convert('L'))
    hsv = ImageStat.Stat(img.convert('HSV'))
    return gris.mean[0], hsv.mean[1] / 255 * 100, gris.stddev[0]


# Ordre des panneaux de la planche, du plus clair au plus sombre.
PANNEAUX = ['tile_desert', 'tile_mountain', 'tile_field', 'tile_pasture', 'tile_fish',
            'tile_hills', 'tile_unexplored', 'tile_sea', 'tile_forest', 'tile_gold']


def mesure_planche(manifest, index):
    """Mesure les dix panneaux de la planche de série avant d'en tirer les tuiles.

    La planche est ce qui contraint toute la série : une echelle inversee ou un
    panneau en aplat s'y corrige pour le prix d'une image, et pour celui de dix
    si on ne le voit qu'apres. L'iteration 1 avait justement inverse marbre et
    garrigue, et rendu huit panneaux sur dix en aplats de matiere.

    Chaque cellule est echantillonnee en son centre — 60 % de sa largeur et de
    sa hauteur — ce qui tombe a l'interieur du panneau quels que soient la marge
    et les gouttieres, et laisse dehors les legendes que le modele ecrit parfois.
    Si la planche cesse d'etre une grille 5x2, la mesure n'a plus de sens : le
    coup d'oeil reste la ou il sert.
    """
    if 'sheet_terrains' not in index:
        print('\nPlanche absente. La generer :')
        print('  node scripts/generate-assets.mjs --id sheet_terrains --best\n')
        sys.exit(1)

    img = Image.open(os.path.join(GENERATED, index['sheet_terrains'])).convert('RGB')  # jamais etalonnee
    cw, ch = img.width / 5, img.height / 2
    cibles = {a['id']: cible(a['color']) for a in manifest['assets'] if a.get('color')}

    print(f"\n{'#':>2} {'panneau':14}{'L visee':>9}{'L planche':>11}{'ecart':>8}"
          f"{'sat visee':>11}{'sat planche':>13}{'contraste':>11}")
    defauts, mesurees = [], []
    for i, asset_id in enumerate(PANNEAUX):
        ligne, colonne = divmod(i, 5)
        x, y = colonne * cw, ligne * ch
        cellule = img.crop((int(x + cw * .2), int(y + ch * .2),
                            int(x + cw * .8), int(y + ch * .8)))
        gris = ImageStat.Stat(cellule.convert('L'))
        l, contraste = gris.mean[0], gris.stddev[0]
        s = ImageStat.Stat(cellule.convert('HSV')).mean[1] / 255 * 100
        l_cible, s_cible = cibles[asset_id]
        nom = asset_id.replace('tile_', '')
        mesurees.append((nom, l))

        alertes = []
        if abs(l - l_cible) > ECART_L_MAX:
            alertes.append(f'luminosite {l:.0f} au lieu de {l_cible:.0f}')
        if abs(s - s_cible) > ECART_SAT_MAX:
            alertes.append(f'saturation {s:.0f} % au lieu de {s_cible:.0f} %')
        if contraste < CONTRASTE[0]:
            alertes.append(f'contraste interne {contraste:.0f} — aplat, le relief a disparu')
        elif contraste > CONTRASTE[1]:
            alertes.append(f'contraste interne {contraste:.0f} — trop bruyant')
        defauts += [f'panneau {i + 1} ({nom}) : {a}' for a in alertes]

        print(f'{i + 1:>2} {nom:14}{l_cible:9.0f}{l:11.0f}{l - l_cible:+8.0f}'
              f'{s_cible:10.0f} %{s:12.0f} %{contraste:11.0f}' + ('  ✗' if alertes else '  ok'))

    # L'echelle doit rester monotone : un barreau inverse se propagera aux dix tuiles.
    for rang, ((a_nom, a_l), (b_nom, b_l)) in enumerate(zip(mesurees, mesurees[1:]), 1):
        if a_l - b_l < ECART_VOISINES_MIN:
            quoi = 'inverses' if a_l < b_l else 'trop proches'
            defauts.append(f'barreaux {rang} et {rang + 1} — {a_nom} et {b_nom} {quoi} '
                           f'({a_l - b_l:+.0f} points)')

    if defauts:
        print(f'\n{len(defauts)} defaut(s) :')
        for d in defauts:
            print(f'  · {d}')
        print('\nCorriger le prompt de sheet_terrains, puis :')
        print('  node scripts/generate-assets.mjs --id sheet_terrains --best --force\n')
        sys.exit(1)

    print('\nPlanche conforme — les tuiles peuvent en etre tirees.\n')


def main():
    manifest = json.load(open(os.path.join(ROOT, 'assets/prompts.json')))
    index = json.load(open(os.path.join(GENERATED, 'index.json')))['files']

    if '--planche' in sys.argv:
        mesure_planche(manifest, index)
        return

    tuiles = [a for a in manifest['assets'] if a['category'] == 'tiles' and a.get('color')]
    tuiles.sort(key=lambda a: -cible(a['color'])[0])

    lignes, defauts, mesurees = [], [], []
    for a in tuiles:
        nom = a['id'].replace('tile_', '')
        if a['id'] not in index:
            defauts.append(f'{nom} : image absente')
            continue

        l_cible, s_cible = cible(a['color'])
        l, s, contraste = mesure(chemin(index, a['id'], brut='--brut' in sys.argv))
        mesurees.append((nom, l))

        alertes = []
        if abs(l - l_cible) > ECART_L_MAX:
            alertes.append(f'luminosite {l:.0f} au lieu de {l_cible:.0f}')
        if abs(s - s_cible) > ECART_SAT_MAX:
            alertes.append(f'saturation {s:.0f} % au lieu de {s_cible:.0f} %')
        if not CONTRASTE[0] <= contraste <= CONTRASTE[1]:
            quoi = 'surface morte' if contraste < CONTRASTE[0] else 'trop bruyante'
            alertes.append(f'contraste interne {contraste:.0f} — {quoi}')

        lignes.append((nom, l_cible, l, s_cible, s, contraste, alertes))
        defauts += [f'{nom} : {x}' for x in alertes]

    print(f"\n{'tuile':14}{'L visee':>9}{'L mesuree':>11}{'sat visee':>11}"
          f"{'sat mesuree':>13}{'contraste':>11}   ")
    for nom, lc, l, sc, s, c, alertes in lignes:
        marque = '  ✗' if alertes else '  ok'
        print(f'{nom:14}{lc:9.0f}{l:11.0f}{sc:10.0f} %{s:12.0f} %{c:11.0f}{marque}')

    # Deux tuiles au même échelon sont indiscernables une fois le plateau dezoome,
    # quelle que soit leur teinte : c'est la valeur que l'oeil lit en premier.
    mesurees.sort(key=lambda t: -t[1])
    for (a_nom, a_l), (b_nom, b_l) in zip(mesurees, mesurees[1:]):
        if a_l - b_l < ECART_VOISINES_MIN:
            defauts.append(f'{a_nom} et {b_nom} : {a_l - b_l:.0f} points de luminosite d ecart, '
                           f'trop proches pour se distinguer en vue d ensemble')

    if defauts:
        print(f'\n{len(defauts)} defaut(s) :')
        for d in defauts:
            print(f'  · {d}')
        print('\nRegenerer les tuiles concernees, planche de serie jointe :')
        print('  node scripts/generate-assets.mjs --id tile_xxx --force\n')
        sys.exit(1)

    print(f'\nGamme conforme — {len(lignes)} tuiles dans les tolerances.\n')


if __name__ == '__main__':
    main()
