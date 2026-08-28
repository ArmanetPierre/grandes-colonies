#!/usr/bin/env python3
"""
Étalonnage des tuiles : de `generated/` vers `processed/`.

Trois itérations de prompt ont montré la limite du texte. Le modèle tient le
sens et lâche les nombres : à la troisième, hauts-fonds et pâturage sortaient
inversés de soixante points de luminosité, parce que de l'eau peu profonde vue
de dessus *est* claire et qu'aucune formulation ne gagne durablement contre cet
a priori.

Or l'échelle de valeurs est une propriété numérique. La demander à un modèle
d'image, c'est demander une multiplication à un poète. On la lui laisse donner
la matière, les volumes et la lumière — ce qu'il fait bien — et on impose la
mesure ici, où elle est exacte, gratuite à répéter et réversible.

Trois corrections, dans cet ordre :

  1. le CONTRASTE interne est comprimé s'il dépasse le plafond, parce que des
     routes et des colonies se dessinent par-dessus ;
  2. la SATURATION moyenne est amenée dans la bande commune, ce qui fait
     l'unité de la série ;
  3. la LUMINOSITÉ moyenne est amenée sur son barreau par une courbe gamma —
     et non par un décalage, qui écrêterait les hautes lumières.

L'ordre n'est pas indifférent. Corriger la saturation déplace la luminosité,
alors que la correction de luminosité multiplie chaque pixel par un scalaire et
laisse sa saturation intacte — (max-min)/max ne change pas sous un gain. La
luminosité passe donc en dernier, et les deux cibles sont atteintes ensemble.

`generated/` n'est jamais modifié : on peut tout refaire depuis prompts.json.

    python3 scripts/etalonner.py
    python3 scripts/etalonner.py --dry-run
"""

import colorsys
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
GENERATED = os.path.join(ROOT, 'assets/generated')
PROCESSED = os.path.join(ROOT, 'assets/processed')

CONTRASTE_MAX = 34   # au-delà, les pièces posées sur la tuile ne se lisent plus


def cible(hexa):
    r, g, b = (int(hexa[i:i + 2], 16) for i in (1, 3, 5))
    _, s, _ = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return 0.299 * r + 0.587 * g + 0.114 * b, s * 100


def luminance(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def etalonner(img, l_cible, s_cible):
    """Ramène une image sur son barreau, en préservant la teinte."""
    a = np.asarray(img).astype(np.float64)

    # 1. Compression du contraste, autour de la moyenne pour ne pas déplacer
    #    la tuile dans l'échelle avant même de l'y placer.
    y = luminance(a)
    ecart = y.std()
    if ecart > CONTRASTE_MAX:
        moy = y.mean()
        a = np.clip(moy + (a - moy) * (CONTRASTE_MAX / ecart), 0, 255)
        y = luminance(a)

    # 2. Saturation dans la bande commune, sans toucher à la teinte.
    hsv = np.asarray(Image.fromarray(a.astype(np.uint8)).convert('HSV')).astype(np.float64)
    s_moy = hsv[..., 1].mean() / 255 * 100
    if s_moy > 1:
        hsv[..., 1] = np.clip(hsv[..., 1] * (s_cible / s_moy), 0, 255)
    a = np.asarray(Image.fromarray(hsv.astype(np.uint8), 'HSV').convert('RGB')).astype(np.float64)

    # 3. Luminosité moyenne sur la cible, en dernier. Une courbe gamma laisse le
    #    noir noir et le blanc blanc ; un gain linéaire écrêterait les hautes
    #    lumières. Le gain par pixel est un scalaire : la saturation est intacte.
    y = luminance(a)
    moy = y.mean()
    if moy > 1:
        gamma = np.log(np.clip(l_cible, 1, 254) / 255) / np.log(np.clip(moy, 1, 254) / 255)
        y_visee = 255 * np.power(np.clip(y, 1e-6, 255) / 255, gamma)
        a = np.clip(a * (y_visee / np.maximum(y, 1e-6))[..., None], 0, 255)

    sortie = Image.fromarray(a.astype(np.uint8))
    b = np.asarray(sortie).astype(np.float64)
    yb = luminance(b)
    return sortie, yb.mean(), np.asarray(sortie.convert('HSV'))[..., 1].mean() / 255 * 100, yb.std()


def main():
    dry = '--dry-run' in sys.argv
    manifest = json.load(open(os.path.join(ROOT, 'assets/prompts.json')))
    index = json.load(open(os.path.join(GENERATED, 'index.json')))['files']
    os.makedirs(os.path.join(PROCESSED, 'tiles'), exist_ok=True)

    tuiles = [a for a in manifest['assets'] if a['category'] == 'tiles' and a.get('color')]
    tuiles.sort(key=lambda a: -cible(a['color'])[0])

    print(f"\n{'tuile':14}{'L brute':>9}{'L visee':>9}{'L obtenue':>11}"
          f"{'sat brute':>11}{'sat obtenue':>13}{'contraste':>11}")
    ecrites = 0
    for a in tuiles:
        nom = a['id'].replace('tile_', '')
        if a['id'] not in index:
            print(f'{nom:14}  image absente')
            continue

        source = Image.open(os.path.join(GENERATED, index[a['id']])).convert('RGB')
        brut = np.asarray(source).astype(np.float64)
        l_brut = luminance(brut).mean()
        s_brut = np.asarray(source.convert('HSV'))[..., 1].mean() / 255 * 100

        l_cible, s_cible = cible(a['color'])
        sortie, l, s, contraste = etalonner(source, l_cible, s_cible)

        if not dry:
            # Même nom de fichier que la source, extension comprise : la tuile
            # étalonnée est un remplacement pur, et `index.json` reste valide.
            nom_fichier = os.path.basename(index[a['id']])
            chemin = os.path.join(PROCESSED, 'tiles', nom_fichier)
            if nom_fichier.lower().endswith(('.jpg', '.jpeg')):
                sortie.save(chemin, quality=95, subsampling=0)
            else:
                sortie.save(chemin)
            ecrites += 1

        print(f'{nom:14}{l_brut:9.0f}{l_cible:9.0f}{l:11.0f}'
              f'{s_brut:10.0f} %{s:12.0f} %{contraste:11.0f}')

    if dry:
        print('\n--dry-run : rien ecrit.\n')
    else:
        print(f'\n{ecrites} tuile(s) etalonnee(s) dans assets/processed/tiles/.')
        print('Elles priment sur generated/ a la copie : npm run assets\n')


if __name__ == '__main__':
    main()
