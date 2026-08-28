#!/usr/bin/env python3
"""
Planche contact des tuiles : découpe hexagonale et plateau assemblé, en PNG.

Reproduit hors navigateur ce que fait assets/preview/index.html. Utile parce
que les panneaux d'aperçu mettent les images en cache de façon agressive, et
qu'une régénération réécrit le même nom de fichier — on croit alors regarder
la nouvelle tuile alors qu'on voit l'ancienne.

    python3 scripts/contact-sheet.py [dossier_de_sortie]

Sorties : planche_120px.png (test décisif), planche_gris.png (le même sans la
teinte, où seule la valeur distingue les tuiles) et planche_plateau.png
(tessellation).
"""

import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
GENERATED = os.path.join(ROOT, 'assets/generated')
PROCESSED = os.path.join(ROOT, 'assets/processed')

ORDER = ['tile_forest', 'tile_pasture', 'tile_field', 'tile_hills', 'tile_mountain',
         'tile_desert', 'tile_sea', 'tile_gold', 'tile_fish', 'tile_unexplored']

BG = (20, 22, 26)
DIM = (150, 157, 170)


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


def load_index():
    with open(os.path.join(GENERATED, 'index.json')) as fh:
        return json.load(fh)['files']


def hex_mask(width):
    """Masque hexagone pointy-top : hauteur = largeur x 1.1547."""
    height = int(width * 1.1547)
    mask = Image.new('L', (width, height), 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon([(width / 2, 0), (width, height * .25), (width, height * .75),
                  (width / 2, height), (0, height * .75), (0, height * .25)], fill=255)
    return mask, height


def hex_tile(index, asset_id, width):
    """Charge une tuile, la recadre en 'cover' puis la masque en hexagone."""
    img = Image.open(chemin(index, asset_id)).convert('RGB')
    mask, height = hex_mask(width)
    scale = max(width / img.width, height / img.height)
    img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)
    left, top = (img.width - width) // 2, (img.height - height) // 2
    img = img.crop((left, top, left + width, top + height))
    out = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def font(size=13):
    try:
        return ImageFont.truetype('/System/Library/Fonts/Supplemental/Menlo.ttc', size)
    except OSError:
        return ImageFont.load_default()


def contact_sheet(index, out_path, width=120, cols=5, gris=False):
    """Les tuiles à leur taille réelle en vue d'ensemble : le test qui décide.

    En niveaux de gris, c'est le test le plus sévère de la série : il retire la
    teinte et ne laisse que la valeur, qui est ce que l'œil lit en premier sur
    un plateau dézoomé. Deux tuiles qui se confondent ici se confondront en jeu.
    """
    height = int(width * 1.1547)
    pad, label_h, header = 18, 22, 30
    rows = (len(ORDER) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (width + pad) + pad,
                              rows * (height + pad + label_h) + pad + header), BG)
    draw = ImageDraw.Draw(sheet)
    titre = f'{width} px — taille reelle en vue d ensemble'
    draw.text((pad, 8), titre + (' — niveaux de gris' if gris else ''), fill=(200, 200, 200), font=font())

    for i, asset_id in enumerate(ORDER):
        if asset_id not in index:
            continue
        row, col = divmod(i, cols)
        x = pad + col * (width + pad)
        y = header + pad + row * (height + pad + label_h)
        tile = hex_tile(index, asset_id, width)
        if gris:
            tile = Image.merge('RGBA', (*[tile.convert('L')] * 3, tile.getchannel('A')))
        sheet.paste(tile, (x, y), tile)
        draw.text((x, y + height + 4), asset_id.replace('tile_', ''), fill=DIM, font=font())

    sheet.save(out_path)
    return sheet.size


def board(index, out_path, width=150):
    """Plateau 3-4-5-4-3 : révèle coutures et motifs qui accrochent entre voisines."""
    height = int(width * 1.1547)
    rows = [3, 4, 5, 4, 3]
    land = ['forest', 'pasture', 'field', 'hills', 'mountain', 'desert', 'gold']
    max_cols = max(rows)
    canvas = Image.new('RGB', (int(max_cols * width + width),
                               int(len(rows) * height * .75 + height * .25 + 20)), (15, 18, 22))
    n = 0
    for r, count in enumerate(rows):
        offset = (max_cols - count) * width / 2
        for c in range(count):
            edge = r in (0, len(rows) - 1) or c in (0, count - 1)
            name = 'sea' if (edge and (r + c) % 2 == 0) else land[n % len(land)]
            if not edge or (r + c) % 2:
                n += 1
            if 'tile_' + name not in index:
                continue
            tile = hex_tile(index, 'tile_' + name, width)
            canvas.paste(tile, (int(offset + c * width + width / 2), int(r * height * .75 + 10)), tile)

    canvas.save(out_path)
    return canvas.size


CARDS = ['card_dev_knight', 'card_dev_road', 'card_dev_invention', 'card_dev_monopoly',
         'card_dev_freebuild', 'card_dev_politics', 'card_obj_trader', 'card_obj_explorer',
         'card_obj_warlord', 'card_obj_magnate', 'card_obj_architect', 'card_obj_diplomat',
         'card_back_dev', 'card_back_objective', 'card_back_contract']

BACKGROUNDS = ['bg_lobby', 'bg_host', 'bg_endgame']


def grid_sheet(index, ids, out_path, title, cell_w, ratio, cols):
    """Planche rectangulaire générique : cartes (2:3) ou fonds (16:9)."""
    cell_h = int(cell_w * ratio)
    pad, label_h, header = 14, 20, 30
    rows = (len(ids) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (cell_w + pad) + pad,
                              rows * (cell_h + pad + label_h) + pad + header), BG)
    draw = ImageDraw.Draw(sheet)
    draw.text((pad, 8), title, fill=(200, 200, 200), font=font())

    for i, asset_id in enumerate(ids):
        if asset_id not in index:
            continue
        row, col = divmod(i, cols)
        x = pad + col * (cell_w + pad)
        y = header + pad + row * (cell_h + pad + label_h)
        img = Image.open(chemin(index, asset_id)).convert('RGB')
        scale = max(cell_w / img.width, cell_h / img.height)
        img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)
        left, top = (img.width - cell_w) // 2, (img.height - cell_h) // 2
        sheet.paste(img.crop((left, top, left + cell_w, top + cell_h)), (x, y))
        draw.text((x, y + cell_h + 4), asset_id, fill=DIM, font=font(11))

    sheet.save(out_path)
    return sheet.size


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out_dir, exist_ok=True)
    index = load_index()
    print('planche 120px  ', contact_sheet(index, os.path.join(out_dir, 'planche_120px.png')))
    print('planche en gris', contact_sheet(index, os.path.join(out_dir, 'planche_gris.png'), gris=True))
    print('plateau assemble', board(index, os.path.join(out_dir, 'planche_plateau.png')))
    print('cartes         ', grid_sheet(index, CARDS, os.path.join(out_dir, 'planche_cartes.png'),
                                        'Cartes — 2:3', 150, 1.5, 5))
    print('fonds          ', grid_sheet(index, BACKGROUNDS, os.path.join(out_dir, 'planche_fonds.png'),
                                        'Fonds d ecran — 16:9', 300, 9 / 16, 3))


if __name__ == '__main__':
    main()
