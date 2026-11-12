"""Extract the Cyberpunk 2077 ringtone (Wwise event 'ui_phone_incoming_call')
from the game installation and save it as Ogg Opus for Neuroport to play on the client.

Path: event (bank HIRC) -> Play action -> container -> Sound -> media ID
         -> sfx_container.opusinfo (package, offset, size)
         -> sfx_container_N.opuspak -> RIFF containing an Ogg Opus stream.

Usage: python tools/ringtone/extract_ringtone.py [output.ogg] [game folder]
"""
import os, struct, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rdar
from rdar import Archive, fnv1a64

EVENT = 'ui_phone_incoming_call'
KNOWN_BANK = 0x94d354ee54e0a03f   # Bank used by the event in game versions 2.5/3.0 (speeds up the search).
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'web', 'ringtone', 'ringtone.ogg')
if len(sys.argv) > 2:
    rdar.GAME = sys.argv[2]
GAME = rdar.GAME


def fnv1_32(name):
    h = 0x811C9DC5
    for b in name.lower().encode('ascii'):
        h = (h * 0x01000193) & 0xFFFFFFFF
        h ^= b
    return h


def chunks(b):
    p = 0
    while p + 8 <= len(b):
        tag, size = b[p:p + 4], struct.unpack_from('<I', b, p + 4)[0]
        yield tag, p + 8, size
        p += 8 + size


def hirc(bank):
    objs = {}
    for tag, off, _size in chunks(bank):
        if tag == b'HIRC':
            n = struct.unpack_from('<I', bank, off)[0]
            p = off + 4
            for _ in range(n):
                t, sz = struct.unpack_from('<BI', bank, p)
                objs[struct.unpack_from('<I', bank, p + 5)[0]] = (t, p + 5, sz)
                p += 5 + sz
    return objs


def media_for_event(bank, objs, eid):
    t, off, sz = objs[eid]
    n = bank[off + 4]
    actions = [struct.unpack_from('<I', bank, off + 5 + 4 * i)[0] for i in range(n)]
    found = []

    def children_of(pid):
        needle = struct.pack('<I', pid)
        return [oid for oid, (tt, o, s) in objs.items()
                if oid != pid and tt in (2, 5, 6, 7, 9) and needle in bank[o + 4:o + min(s, 80)]]

    def walk(oid, depth):
        if oid not in objs or depth > 6:
            return
        tt, o, s = objs[oid]
        if tt == 2:  # Sound: id, plugin(u32), stream(u8), sourceID(u32)
            found.append(struct.unpack_from('<IBI', bank, o + 4)[2])
            return
        for c in children_of(oid):
            walk(c, depth + 1)

    for a in actions:
        _tt, o, _s = objs[a]
        atype, target = struct.unpack_from('<HI', bank, o + 4)
        if atype & 0xFF00 == 0x0400:   # Play
            walk(target, 0)
    return found


def main():
    content = os.path.join(GAME, 'archive', 'pc', 'content')
    arch = Archive(os.path.join(content, 'audio_2_soundbanks.archive'))
    eid = fnv1_32(EVENT)
    needle = struct.pack('<I', eid)

    banks = [KNOWN_BANK] if KNOWN_BANK in arch.files else []
    banks += [h for h in arch.files if h != KNOWN_BANK]
    media = []
    for h in banks:
        s0, _ = arch.files[h]
        if arch.read_segment(s0)[:4] != b'BKHD':
            continue
        bank = arch.read(h)
        if needle not in bank:
            continue
        objs = hirc(bank)
        if eid in objs:
            media = media_for_event(bank, objs, eid)
            if media:
                break
    if not media:
        sys.exit('ringtone event not found in audio banks')
    mid = media[0]
    print('Ringtone media:', mid)

    info = arch.read(fnv1a64(r'base\sound\soundbanks\sfx_container.opusinfo'))
    magic, _ver, _z, n = struct.unpack_from('<4sIII', info, 0)
    assert magic == b'SND ', 'unexpected opusinfo'
    hashes = struct.unpack_from(f'<{n}I', info, 20)
    i = hashes.index(mid)
    p = 20 + n * 4
    pak = struct.unpack_from('<H', info, p + i * 2)[0]; p += n * 2
    off = struct.unpack_from('<I', info, p + i * 4)[0]; p += n * 4
    riff = struct.unpack_from('<H', info, p + i * 2)[0]; p += n * 2
    size = struct.unpack_from('<I', info, p + i * 4)[0]
    print(f'sfx_container_ package{pak}.opuspak, offset {off}, {size} bytes')

    data = arch.read(fnv1a64(f'base\\sound\\soundbanks\\sfx_container_{pak}.opuspak'))[off:off + size]
    ogg = data[riff:]
    if ogg[:4] != b'OggS':
        k = data.find(b'OggS')
        if k < 0:
            sys.exit('Ogg stream not found')
        ogg = data[k:]
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    open(OUT, 'wb').write(ogg)
    print('ringtone saved to', os.path.abspath(OUT), f'({len(ogg)} bytes)')


if __name__ == '__main__':
    main()
