"""Read the game UI atlas in BC7 (TCM_QualityColor) using Pillow BCn decoding.

Usage: python -I atlas_bc7.py <output.png>   creates a contact sheet of all parts in the 2.x mappin atlas.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from avatar import atlas_parts, find, CR2W, fnv1a64  # noqa: E402

NEW = 0x9c3e8929b072b557   # base\gameplay\gui\common\icons\mappin_icons.inkatlas (2.x)
_cache = {}


def texture_image(path):
    """Full RGBA image (already vertically flipped) from a BC7 texture."""
    from PIL import Image
    if path in _cache:
        return _cache[path]
    h = fnv1a64(path.lower())
    a = find(h)
    s0, _s1 = a.files[h]
    c = CR2W(a.read_segment(s0))
    blob = next(c.export(i)[1] for i in range(len(c.exports)) if c.exports[i][0] == 'rendRenderTextureBlobPC')
    w, hh = blob['header']['sizeInfo']['width'], blob['header']['sizeInfo']['height']
    data = a.read_segment(s0 + 1)
    img = Image.frombuffer('RGBA', (w, hh), data, 'bcn', 7, '').transpose(Image.FLIP_TOP_BOTTOM)
    _cache[path] = img
    return img


def parts(h=NEW):
    tex, ps = atlas_parts(h)
    return tex, {p['partName'].strip(): p['clippingRectInUVCoords'] for p in ps if isinstance(p, dict) and p.get('partName')}


def part_image(name, h=NEW):
    """Crop one region (PIL.Image RGBA)."""
    tex, ps = parts(h)
    uv = ps[name]
    img = texture_image(tex)
    W, H = img.size
    return img.crop((int(uv['Left'] * W), int(uv['Top'] * H), int(round(uv['Right'] * W)), int(round(uv['Bottom'] * H))))


def contact_sheet(dest):
    from PIL import Image, ImageDraw
    _tex, ps = parts()
    names = sorted(ps)
    cell, cols = 72, 12
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * cell, rows * cell), (20, 24, 30, 255))
    d = ImageDraw.Draw(sheet)
    for i, n in enumerate(names):
        im = part_image(n)
        im.thumbnail((48, 48))
        x, y = (i % cols) * cell, (i // cols) * cell
        sheet.alpha_composite(im, (x + (cell - im.width) // 2, y + 2))
        d.text((x + 2, y + 54), n[:12], fill=(200, 200, 200, 255))
    sheet.save(dest)


if __name__ == '__main__':
    contact_sheet(sys.argv[1])
