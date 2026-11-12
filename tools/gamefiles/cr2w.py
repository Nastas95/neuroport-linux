"""Minimal reader for CR2W resources (REDengine 4): name/import/export tables,
RTTI-serialized properties and buffers (additional archive segments)."""
import struct

PRIM = {
    'Bool': ('<B', 1), 'Uint8': ('<B', 1), 'Int8': ('<b', 1), 'Uint16': ('<H', 2), 'Int16': ('<h', 2),
    'Uint32': ('<I', 4), 'Int32': ('<i', 4), 'Uint64': ('<Q', 8), 'Int64': ('<q', 8), 'Float': ('<f', 4),
    'Double': ('<d', 8),
}


class CR2W:
    def __init__(self, data):
        self.d = d = data
        assert d[:4] == b'CR2W', 'not a CR2W file'
        tables = [struct.unpack_from('<III', d, 40 + i * 12) for i in range(10)]
        s_off, s_size, _ = tables[0]
        self.strings = d[s_off:s_off + s_size]
        n_off, n_cnt, _ = tables[1]
        self.names = [self._str(struct.unpack_from('<II', d, n_off + i * 8)[0]) for i in range(n_cnt)]
        i_off, i_cnt, _ = tables[2]
        self.imports = []
        for i in range(i_cnt):
            so, cls, flags = struct.unpack_from('<IHH', d, i_off + i * 8)
            self.imports.append(self._str(so))
        e_off, e_cnt, _ = tables[4]
        self.exports = []
        for i in range(e_cnt):
            cls, oflags, parent, size, off, _tpl, _crc = struct.unpack_from('<HHIIIII', d, e_off + i * 24)
            self.exports.append((self.names[cls], off, size))
        b_off, b_cnt, _ = tables[5]
        self.buffers = [struct.unpack_from('<IIIIII', d, b_off + i * 24) for i in range(b_cnt)]

    def _str(self, off):
        end = self.strings.index(b'\0', off)
        return self.strings[off:end].decode('utf-8', 'replace')

    # ---------- propriedades ----------
    def props(self, p, end):
        out = {}
        while p + 2 <= end:
            nidx = struct.unpack_from('<H', self.d, p)[0]
            if nidx == 0:
                p += 2
                break
            tidx, size = struct.unpack_from('<HI', self.d, p + 2)
            name, typ = self.names[nidx], self.names[tidx]
            vstart, vend = p + 8, p + 4 + size
            try:
                out[name] = self.value(typ, vstart, vend)
            except Exception as e:   # tipo desconhecido: guarda os bytes
                out[name] = ('?', typ, self.d[vstart:vend])
            p = vend
        return out, p

    def value(self, typ, p, end):
        d = self.d
        if typ in PRIM:
            return struct.unpack_from(PRIM[typ][0], d, p)[0]
        if typ == 'CName':
            return self.names[struct.unpack_from('<H', d, p)[0]]
        if typ.startswith(('raRef:', 'rRef:')):
            i = struct.unpack_from('<H', d, p)[0]
            return self.imports[i - 1] if 0 < i <= len(self.imports) else None
        if typ.startswith(('handle:', 'whandle:')):
            return ('handle', struct.unpack_from('<i', d, p)[0])
        if typ.startswith(('array:', 'static:', '[')):
            if typ.startswith('['):
                inner = typ.split(']', 1)[1]
            else:
                inner = typ.split(':', 1)[1]
                if typ.startswith('static:'):
                    inner = inner.split(',', 1)[1]
            n = struct.unpack_from('<I', d, p)[0]
            p += 4
            items = []
            for _ in range(n):
                v, p = self.element(inner, p, end)
                items.append(v)
            return items
        if typ == 'serializationDeferredDataBuffer' or typ == 'DataBuffer':
            return ('buffer', struct.unpack_from('<H', d, p)[0])
        # enum (nome) ou struct (lista de propriedades)
        if end - p == 2:
            return self.names[struct.unpack_from('<H', d, p)[0]]
        v, _ = self.props(p + 1 if d[p] == 0 and struct.unpack_from('<H', d, p + 1)[0] < len(self.names) else p, end)
        return v

    def element(self, typ, p, end):
        d = self.d
        if typ in PRIM:
            fmt, sz = PRIM[typ]
            return struct.unpack_from(fmt, d, p)[0], p + sz
        if typ == 'CName':
            return self.names[struct.unpack_from('<H', d, p)[0]], p + 2
        if typ.startswith(('raRef:', 'rRef:')):
            i = struct.unpack_from('<H', d, p)[0]
            return (self.imports[i - 1] if 0 < i <= len(self.imports) else None), p + 2
        if typ.startswith(('handle:', 'whandle:')):
            return ('handle', struct.unpack_from('<i', d, p)[0]), p + 4
        # struct dentro de array: lista de propriedades terminada em 0
        v, p2 = self.props(p + 1 if d[p] == 0 else p, end)
        return v, p2

    def export(self, i):
        cls, off, size = self.exports[i]
        v, _ = self.props(off + 1, off + size)
        return cls, v
