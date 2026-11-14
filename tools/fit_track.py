#!/usr/bin/env python3
"""Minimal robust FIT reader: record messages (global 20) with position+time.

Rejects undefined local message types and handles compressed timestamp headers
(UTC base 1989-12-31 00:00:00), and big/little endian. Prints nothing; returns
a list of (unix_ts, lat, lon) tuples.

Usage: from fit_track import read_track; read_track(path)
"""
import struct
from pathlib import Path

FIT_EPOCH = 631065600  # 1989-12-31 00:00:00 UTC


def _read(path):
    """Read a FIT file; unwrap the CC700 on-device container when present.

    The device stores rides as b'.ZIP' + the 14-byte FIT header + chunks of
    [u16 compressed length][zlib stream] holding the FIT data section.
    """
    d = Path(path).read_bytes()
    if d[:4] != b".ZIP":
        return d
    import zlib
    if len(d) < 18 or d[4] != 14 or d[12:16] != b".FIT":
        raise ValueError("Invalid CC700 container header")
    hdr = d[4:18]
    expected_size = struct.unpack_from("<I", hdr, 4)[0]
    body = b""
    off = 18
    while len(body) < expected_size and off + 2 <= len(d):
        n = struct.unpack_from("<H", d, off)[0]
        chunk = d[off + 2:off + 2 + n]
        if len(chunk) < n:
            raise ValueError("Truncated CC700 compressed chunk")
        try:
            body += zlib.decompress(chunk)
        except zlib.error as exc:
            raise ValueError("Invalid CC700 compressed chunk") from exc
        off += 2 + n
    if len(body) != expected_size or len(d) - off not in (0, 2):
        raise ValueError("CC700 decoded size or trailer does not match header")
    return hdr + body


def read_track(path, tz_offset=0):
    """Decode global-20 positions. Structural errors raise ValueError.

    CRC validation is outside this reader; the observed CC700 container's
    two-byte trailer is accepted but not verified. tz_offset adjusts seconds.
    """
    d = _read(path)
    if len(d) < 12 or d[0] < 12 or d[0] > len(d) or d[8:12] != b".FIT":
        raise ValueError("Invalid FIT header")
    hs = d[0]
    body_end = hs + struct.unpack_from("<I", d, 4)[0]
    if body_end > len(d):
        raise ValueError("Truncated FIT data section")
    i = hs
    defs = {}
    out = []
    last_cts = None

    def take(size):
        nonlocal i
        if i + size > body_end:
            raise ValueError("Truncated FIT message")
        raw = d[i:i + size]
        i += size
        return raw

    while i < body_end:
        h = take(1)[0]
        if h & 0x80:  # compressed timestamp header
            lt = (h >> 5) & 3
            off = h & 0x1F
            if last_cts is None:
                raise ValueError("Compressed timestamp without a prior timestamp")
            if off < (last_cts & 0x1F):
                last_cts += 0x20
            last_cts = (last_cts & ~0x1F) | off
            local_ts = last_cts
        else:
            lt = h & 15
            local_ts = None
        if h & 0x40 and not h & 0x80:  # definition message
            definition = take(5)
            arch = definition[1]
            if arch not in (0, 1):
                raise ValueError("Invalid FIT architecture")
            e = ">" if arch else "<"
            global_type = struct.unpack_from(e + "H", definition, 2)[0]
            n = definition[4]
            fields = []
            for _ in range(n):
                num, size, bt = take(3)
                fields.append((num, size, bt))
            developer_size = 0
            if h & 0x20:  # developer fields
                nd = take(1)[0]
                for _ in range(nd):
                    developer_size += take(3)[1]
            defs[lt] = (e, global_type, fields, developer_size)
            continue
        if lt not in defs:
            raise ValueError(f"Undefined FIT local message {lt}")
        e, global_type, fields, developer_size = defs[lt]
        if local_ts is not None and (not fields or fields[0] != (253, 4, 0x86)):
            raise ValueError("Compressed message requires timestamp as first field")
        m = {}
        for num, size, bt in fields:
            if num == 253 and local_ts is not None:
                m[253] = local_ts
                continue
            raw = take(size)
            if num == 253 and size == 4:
                m[253] = struct.unpack(e + "I", raw)[0]
            elif num == 0 and size == 4:
                m[0] = struct.unpack(e + "i", raw)[0]
            elif num == 1 and size == 4:
                m[1] = struct.unpack(e + "i", raw)[0]
        take(developer_size)
        if m.get(253) is not None and m[253] != 0xffffffff:
            last_cts = m[253]
        if global_type == 20 and 0 in m and 1 in m and m[0] != 0x7FFFFFFF and m[1] != 0x7FFFFFFF:
            sc = 180.0 / 2 ** 31
            out.append((m[253] + FIT_EPOCH + tz_offset if m.get(253) not in (None, 0xffffffff) else None,
                        m[0] * sc, m[1] * sc))
    return out


if __name__ == "__main__":
    import sys
    rec = read_track(sys.argv[1])
    print(len(rec), "records")
    for r in rec[:3] + rec[-3:]:
        print(r)
