"""Minimal reader for Cyberpunk 2077 .archive (RDAR) files.

Format (documented by the community / WolvenKit):
  header: 'RDAR', u32 version, u64 indexPos, u32 indexSize, u64 debugPos, u32 debugSize, u64 size
  index: u32 fileTableOffset, u32 fileTableSize, u64 crc, u32 nFiles, u32 nSegments, u32 nDeps
          files (56 bytes): u64 hash, u64 timestamp, u32 inlineSegs, u32 segStart, u32 segEnd,
                               u32 depStart, u32 depEnd, sha1[20]
          segments (16 bytes): u64 offset, u32 compressedSize, u32 size
  compressed segment: 'KARK' + u32 size + Oodle (Kraken) data, decompressed with native Oodle (Rust) on Linux or the game DLL on Windows.
"""
import ctypes, mmap, struct, os

import os as _os
# Game directory: the server passes NEUROPORT_GAME (detected Steam/GOG/Epic installation)
GAME = _os.environ.get('NEUROPORT_GAME') or r'C:\Program Files (x86)\Steam\steamapps\common\Cyberpunk 2077'
_oodle = None


def oodle():
    """Carica Oodle ufficiale su Windows o il decoder Rust nativo su Linux."""
    global _oodle
    if _oodle is None:
        if os.name == 'nt':
            _oodle = ctypes.WinDLL(os.path.join(GAME, 'bin', 'x64', 'oo2ext_7_win64.dll'))
            f = _oodle.OodleLZ_Decompress
            f.restype = ctypes.c_int64
            f.argtypes = [ctypes.c_void_p, ctypes.c_int64, ctypes.c_void_p, ctypes.c_int64,
                          ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_int64,
                          ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int64, ctypes.c_int]
        else:
            lib_path = os.environ.get('NEUROPORT_OODLE_LIBRARY') or os.path.join(
                os.path.dirname(os.path.abspath(__file__)), 'libneuroport_oodle.so')
            _oodle = ctypes.CDLL(lib_path)
            version = _oodle.neuroport_oodle_abi_version
            version.restype = ctypes.c_uint32
            abi = version()
            if abi != 1:
                raise RuntimeError(f'Incompatible Oodle decoder ABI: {abi}')
            f = _oodle.neuroport_oodle_decompress
            f.restype = ctypes.c_int64
            f.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t]
    return _oodle


def fnv1a64(s):
    h = 0xCBF29CE484222325
    for b in s.encode('utf-8'):
        h ^= b
        h = (h * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return h


class Archive:
    def __init__(self, path):
        self.path = path
        self.f = open(path, 'rb')
        self.m = mmap.mmap(self.f.fileno(), 0, access=mmap.ACCESS_READ)
        m = self.m
        assert m[:4] == b'RDAR', 'not an archive'
        idx_pos, = struct.unpack_from('<Q', m, 8)
        _tbl_off, _tbl_size, _crc, n_files, n_segs, _n_deps = struct.unpack_from('<IIQIII', m, idx_pos)
        p = idx_pos + 28
        self.files = {}
        for _ in range(n_files):
            h, _ts, _inl, s0, s1 = struct.unpack_from('<QQIII', m, p)
            self.files[h] = (s0, s1)
            p += 56
        self.segs = [struct.unpack_from('<QII', m, p + i * 16) for i in range(n_segs)]

    def read_segment(self, i):
        off, zsize, size = self.segs[i]
        raw = self.m[off:off + zsize]
        if zsize == size:
            return bytes(raw)
        if raw[:4] == b'KARK':
            size = struct.unpack_from('<I', raw, 4)[0]
            raw = raw[8:]
        out = ctypes.create_string_buffer(size)
        src = ctypes.create_string_buffer(bytes(raw), len(raw))
        if os.name == 'nt':
            n = oodle().OodleLZ_Decompress(src, len(raw), out, size, 1, 0, 0, None, 0, None, None, None, 0, 3)
        else:
            n = oodle().neuroport_oodle_decompress(src, len(raw), out, size)
        if n != size:
            raise IOError(f'decompression failed for segment {i}: decoder={n}, expected={size}')
        return out.raw[:size]

    def read(self, h):
        s0, s1 = self.files[h]
        return b''.join(self.read_segment(i) for i in range(s0, s1))
