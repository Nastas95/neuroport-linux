"""Extract a contact avatar from the game UI atlases and save it as a PNG.

Usage: python avatar.py <part> <output.png> [atlas]
  part   atlas part name (UIIcon.AtlasPartName), e.g. judy
  atlas  path to the .inkatlas file or its hash (hex/decimal; ULL suffix accepted); if omitted,
         search the known avatar atlases for the part.

Atlas (inkTextureAtlas): slots[0] = {texture: .xbm, parts: [{partName, clippingRectInUVCoords}]}
Texture (CBitmapTexture + rendRenderTextureBlobPC): BC1/BC3/BC7… or RGBA; the pixel buffer
is the next segment in the archive file. Only the cropped texture blocks are decoded.
"""
import os, struct, sys, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rdar
from rdar import Archive, fnv1a64
from cr2w import CR2W

AVATAR_DIRS = [r'base\gameplay\gui\common\icons\avatars', r'ep1\gameplay\gui\common\icons\avatars']
_archives = None


def archives():
    global _archives
    if _archives is None:
        _archives = []
        for sub in ('content', 'ep1'):
            d = os.path.join(rdar.GAME, 'archive', 'pc', sub)
            for n in sorted(os.listdir(d)):
                if n.endswith('.archive') and ('basegame' in n or n.startswith('ep1')) and 'audio' not in n:
                    _archives.append(Archive(os.path.join(d, n)))
    return _archives


def find(h):
    for a in archives():
        if h in a.files:
            return a
    return None


def parse_hash(x):
    x = str(x).strip().rstrip('ULul')
    if '\\' in x or '/' in x:
        return fnv1a64(x.replace('/', '\\').lower())
    return int(x, 16) if x.lower().startswith('0x') or any(c in 'abcdef' for c in x.lower()) else int(x)


def atlas_parts(h):
    a = find(h)
    if not a:
        return None, []
    c = CR2W(a.read_segment(a.files[h][0]))
    _cls, v = c.export(0)
    slot = v['slots'][0]
    return slot.get('texture'), slot.get('parts') or []


# ---------- Block decoding ----------
def rgb565(c):
    r, g, b = (c >> 11) & 31, (c >> 5) & 63, c & 31
    return (r << 3 | r >> 2, g << 2 | g >> 4, b << 3 | b >> 2)


def color_block(b, o, four):
    c0, c1, idx = struct.unpack_from('<HHI', b, o)
    p0, p1 = rgb565(c0), rgb565(c1)
    if c0 > c1 or four:
        pal = [p0, p1, tuple((2 * x + y) // 3 for x, y in zip(p0, p1)), tuple((x + 2 * y) // 3 for x, y in zip(p0, p1))]
        alpha3 = 255
    else:
        pal = [p0, p1, tuple((x + y) // 2 for x, y in zip(p0, p1)), (0, 0, 0)]
        alpha3 = 0
    return [pal[(idx >> (2 * i)) & 3] + ((alpha3 if (idx >> (2 * i)) & 3 == 3 else 255),) for i in range(16)]


def alpha_block(b, o):
    a0, a1 = b[o], b[o + 1]
    bits = int.from_bytes(b[o + 2:o + 8], 'little')
    if a0 > a1:
        pal = [a0, a1] + [((7 - i) * a0 + i * a1) // 7 for i in range(1, 7)]
    else:
        pal = [a0, a1] + [((5 - i) * a0 + i * a1) // 5 for i in range(1, 5)] + [0, 255]
    return [pal[(bits >> (3 * i)) & 7] for i in range(16)]


def decode_region(data, fmt, width, row_pitch, x0, y0, x1, y1):
    """Return (width, height, RGBA bytes) for rectangle [x0,x1)×[y0,y1)."""
    bx0, by0, bx1, by1 = x0 // 4, y0 // 4, (x1 + 3) // 4, (y1 + 3) // 4
    W, H = (bx1 - bx0) * 4, (by1 - by0) * 4
    out = bytearray(W * H * 4)
    bsize = 8 if fmt == 'BC1' else 16
    for by in range(by0, by1):
        for bx in range(bx0, bx1):
            o = by * row_pitch + bx * bsize
            if fmt == 'BC1':
                px = color_block(data, o, False)
            elif fmt == 'BC3':
                al = alpha_block(data, o)
                px = [c[:3] + (a,) for c, a in zip(color_block(data, o + 8, True), al)]
            elif fmt == 'BC2':
                abits = int.from_bytes(data[o:o + 8], 'little')
                px = [c[:3] + (((abits >> (4 * i)) & 15) * 17,) for i, c in enumerate(color_block(data, o + 8, True))]
            else:
                raise ValueError('unsupported format: ' + fmt)
            for i, p in enumerate(px):
                X, Y = (bx - bx0) * 4 + (i & 3), (by - by0) * 4 + (i >> 2)
                k = (Y * W + X) * 4
                out[k:k + 4] = bytes(p)
    # corta o excesso dos blocos
    ox, oy, w, h = x0 - bx0 * 4, y0 - by0 * 4, x1 - x0, y1 - y0
    crop = bytearray()
    for y in range(h):
        k = ((oy + y) * W + ox) * 4
        crop += out[k:k + w * 4]
    return w, h, bytes(crop)


FORMATS = {'TCM_DXTNoAlpha': 'BC1', 'TCM_DXTAlpha': 'BC3', 'TCM_DXTAlphaLinear': 'BC3',
           'TCM_Normals_DEPRECATED': 'BC1', 'TCM_QualityColor': 'BC7', 'TCM_None': 'RGBA'}


def texture_region(path, uv):
    h = fnv1a64(path.lower())
    a = find(h)
    if not a:
        raise FileNotFoundError(path)
    s0, s1 = a.files[h]
    c = CR2W(a.read_segment(s0))
    _, tex = c.export(0)
    blob = next(c.export(i)[1] for i in range(len(c.exports)) if c.exports[i][0] == 'rendRenderTextureBlobPC')
    fmt = FORMATS.get(tex['setup'].get('compression'), 'BC3')
    width, height = blob['header']['sizeInfo']['width'], blob['header']['sizeInfo']['height']
    if fmt == 'BC7':
        # BC7: decode the full texture with Pillow (already flipped upright), then crop it.
        from atlas_bc7 import texture_image
        img = texture_image(path)
        W, H = img.size
        im = img.crop((int(uv['Left'] * W), int(uv['Top'] * H), int(round(uv['Right'] * W)), int(round(uv['Bottom'] * H))))
        return im.width, im.height, im.convert('RGBA').tobytes()
    pitch = blob['header']['mipMapInfo'][0]['layout']['rowPitch']
    data = a.read_segment(s0 + 1)          # buffer de pixels (mip 0 primeiro)
    # Some headers contain an invalid rowPitch; recalculate it from the format.
    calc = width * 4 if fmt == 'RGBA' else ((width + 3) // 4) * (8 if fmt == 'BC1' else 16)
    if not (0 < pitch <= len(data)) or pitch < calc:
        pitch = calc
    # UI textures are stored upside down, so the V axis is flipped.
    x0, x1 = int(uv['Left'] * width), int(round(uv['Right'] * width))
    y0, y1 = int((1 - uv['Bottom']) * height), int(round((1 - uv['Top']) * height))
    if fmt == 'RGBA':
        rows = [data[(y0 + y) * pitch + x0 * 4:(y0 + y) * pitch + x1 * 4] for y in range(y1 - y0)]
        w, h, px = x1 - x0, y1 - y0, b''.join(rows)
    else:
        w, h, px = decode_region(data, fmt, width, pitch, x0, y0, x1, y1)
    # Flip the image back upright.
    px = b''.join(px[(h - 1 - y) * w * 4:(h - y) * w * 4] for y in range(h))
    return w, h, px


def halve(w, h, rgba):
    """Reduce the image by half using a 2x2 average."""
    nw, nh = w // 2, h // 2
    out = bytearray(nw * nh * 4)
    for y in range(nh):
        r0, r1 = (2 * y) * w * 4, (2 * y + 1) * w * 4
        for x in range(nw):
            a, b = r0 + 8 * x, r1 + 8 * x
            k = (y * nw + x) * 4
            for c in range(4):
                out[k + c] = (rgba[a + c] + rgba[a + 4 + c] + rgba[b + c] + rgba[b + 4 + c]) >> 2
    return nw, nh, bytes(out)


def write_png(path, w, h, rgba):
    raw = b''.join(b'\0' + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) \
        + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    open(path, 'wb').write(png)


def candidate_atlases():
    out = []
    for d in AVATAR_DIRS:
        for n in range(0, 16):
            out.append(f'{d}\\avatars{n}.inkatlas')
        out.append(f'{d}\\avatars.inkatlas')
    return out


INDEX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'atlas_index.json')


def build_index():
    """Scan the game archives for all inkTextureAtlas resources and write a part-to-atlas index."""
    import json, time
    t0 = time.time()
    idx = {}
    for a in archives():
        for h, (s0, s1) in a.files.items():
            _off, _zs, sz = a.segs[s0]
            if sz > 400000:
                continue
            try:
                first = a.read_segment(s0)
            except Exception:
                continue
            if first[:4] != b'CR2W' or b'inkTextureAtlas' not in first:
                continue
            try:
                c = CR2W(first)
                _cls, v = c.export(0)
                for p in (v.get('slots') or [{}])[0].get('parts') or []:
                    if isinstance(p, dict) and p.get('partName'):
                        idx.setdefault(p['partName'], f'{h:016x}')
            except Exception:
                continue
    json.dump(idx, open(INDEX, 'w'))
    print(f'atlas index: {len(idx)} parts in {time.time() - t0:.0f}s')
    return idx


def load_index():
    import json
    try:
        return json.load(open(INDEX))
    except Exception:
        return None


def main():
    if sys.argv[1] == '--build-index':
        build_index()
        return
    part = sys.argv[1]
    dest = sys.argv[2]
    atlas = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
    hashes = [parse_hash(atlas)] if atlas else []
    hashes += [fnv1a64(p.lower()) for p in candidate_atlases()]
    idx = load_index()
    if idx and part in idx:
        hashes.insert(0, int(idx[part], 16))
    for h in hashes:
        tex, parts = atlas_parts(h)
        for p in parts:
            if isinstance(p, dict) and p.get('partName') == part:
                w, hh, rgba = texture_region(tex, p['clippingRectInUVCoords'])
                while w > 640:
                    w, hh, rgba = halve(w, hh, rgba)
                write_png(dest, w, hh, rgba)
                print(f'avatar {part}: {w}x{hh} de {tex} -> {dest}')
                return
    sys.exit(f'parte {part} not found')


if __name__ == '__main__':
    main()
