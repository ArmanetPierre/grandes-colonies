#!/usr/bin/env python3
"""
Planche contact des tuiles : découpe hexagonale et plateau assemblé, en PNG.

Reproduit hors navigateur ce que fait assets/preview/index.html. Utile parce
que les panneaux d'aperçu mettent les images en cache de façon agressive, et
qu'une régénération réécrit le même nom de fichier — on croit alors regarder
la nouvelle tuile alors qu'on voit l'ancienne.

    python3 scripts/contact-sheet.py [dossier_de_sortie]

Sorties : planche_120px.png (test décisif) et planche_plateau.png (tessellation).
"""

import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
GENERATED = os.path.join(ROOT, 'assets/generated')

ORDER = ['tile_forest', 'tile_pasture', 'tile_field', 'tile_hills', 'tile_mountain',
         'tile_desert', 'tile_sea', 'tile_gold', 'tile_fish', 'tile_unexplored']

BG = (20, 22, 26)
DIM = (150, 157, 170)


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
    img = Image.open(os.path.join(GENERATED, index[asset_id])).convert('RGB')
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


def contact_sheet(index, out_path, width=120, cols=5):
    """Les tuiles à leur taille réelle en vue d'ensemble : le test qui décide."""
    height = int(width * 1.1547)
    pad, label_h, header = 18, 22, 30
    rows = (len(ORDER) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (width + pad) + pad,
                              rows * (height + pad + label_h) + pad + header), BG)
    draw = ImageDraw.Draw(sheet)
    draw.text((pad, 8), f'{width} px — taille reelle en vue d ensemble', fill=(200, 200, 200), font=font())

    for i, asset_id in enumerate(ORDER):
        if asset_id not in index:
            continue
        row, col = divmod(i, cols)
        x = pad + col * (width + pad)
        y = header + pad + row * (height + pad + label_h)
        tile = hex_tile(index, asset_id, width)
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


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out_dir, exist_ok=True)
    index = load_index()
    print('planche 120px  ', contact_sheet(index, os.path.join(out_dir, 'planche_120px.png')))
    print('plateau assemble', board(index, os.path.join(out_dir, 'planche_plateau.png')))


if __name__ == '__main__':
    main()
