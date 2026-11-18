"""Second code area of the cc26 image (D4, E8). The code is appended to DROM segment 0, after its constants, so it loads
at 0x3c37b134 and runs at the IROM alias 0x4237b134 (the same flash page offset). The area ends at 0x42380000: 20,172 B.
The DRAM segment 1 moves to the file end, and one 16 B padding segment (load address 0) is added before IROM. The
IROM file offset stays at 0x20 mod 64 KB: the code (+20,172) replaces the DRAM segment (-20,196 with its header) and the
padding adds 24. Host only: no device."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ESP = ROOT.parent / 'cc700-backup/tools/espimg.py'
DROM = 0x3c1e0020            # DROM segment 0 load address
CODE_LOAD = 0x3c37b134       # code load address (its IROM alias is 0x4237b134)
AREA_END = 0x42380000        # end of the area (exclusive)
AREA_LIMIT = AREA_END - 0x4237B134   # 20,172 B
DRAM1 = 0x3fc98200           # the DRAM segment that moves to the end of the file
PAD = bytes(16)


def esp_module():
    spec = importlib.util.spec_from_file_location('espimg', ESP)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def add_area2(base, code):
    """base: the stock C4 image bytes. code: at most 20,172 B. Returns the new image bytes (6 segments)."""
    if len(code) > AREA_LIMIT:
        raise ValueError(f'code area: {len(code)} B is over {AREA_LIMIT} B')
    m = esp_module()
    header, segs, _ = m.read(base)
    if len(segs) != 5 or segs[0][0] != DROM or segs[1][0] != DRAM1 or segs[2][0] != 0x42000020:
        raise ValueError('base layout differs from the C4 image (DROM, DRAM, IROM, DRAM, IRAM)')
    drom = bytearray(segs[0][1])
    if DROM + len(drom) != CODE_LOAD:
        raise ValueError('the DROM constants do not end at 0x3c37b134 (the constants of the base differ)')
    dram1 = segs[1]
    rest = segs[2:]
    # The code is filled with zeros to the area size: then the padding is exactly 16 B, as E8 says.
    new = [[DROM, drom + bytearray(code) + bytearray(AREA_LIMIT - len(code))], [0, bytearray(PAD)]] + rest + [dram1]
    return m.build(header, new)
