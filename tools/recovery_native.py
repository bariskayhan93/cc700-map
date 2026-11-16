"""Host driver for the SAME portable C recovery core; no device/UI emulation."""
import ctypes as C
import math
from pathlib import Path
import subprocess
import tempfile
ROOT=Path(__file__).resolve().parents[1]
class Input(C.Structure):
    _fields_=[(n,C.c_uint32) for n in ('now_ms','fix_ms','epoch','progress_cm')]+[(n,C.c_int32) for n in ('lat_e7','lon_e7')]+[(n,C.c_float) for n in ('speed_kmh','accuracy_m','heading_x','heading_y')]+[(n,C.c_uint32) for n in ('flags','overlay_points')]
class Output(C.Structure):
    _fields_=[(n,C.c_uint32) for n in ('state','reason','suppress_native_cues','overlay','distance_cm','points','portal','guard_checks','reads')]
class Memory(C.Structure):
    _fields_=[('data',C.c_void_p),('size',C.c_uint32)]
_TEMP=None
_LIB=None
def library():
    global _TEMP,_LIB
    if _LIB is None:
        _TEMP=tempfile.TemporaryDirectory(prefix='cc700-recovery-core-')
        file=Path(_TEMP.name)/'recovery.so'
        subprocess.run(['cc','-std=c11','-O2','-shared','-fPIC','-Wall','-Wextra','-Werror','-DRC_HOST_STATS',str(ROOT/'firmware/recovery/recovery.c'),str(ROOT/'tools/recovery_host.c'),'-o',str(file)],check=True,capture_output=True)
        _LIB=C.CDLL(str(file));_LIB.rc_size.restype=C.c_size_t
        _LIB.rc_init.argtypes=[C.c_void_p,C.c_void_p,C.c_uint32,C.c_int]
        _LIB.rc_mount.argtypes=[C.c_void_p,C.c_void_p,C.c_void_p,C.c_uint32];_LIB.rc_mount.restype=C.c_int
        _LIB.rc_tick.argtypes=[C.c_void_p,C.POINTER(Input),C.POINTER(Output)]
        _LIB.rc_unmount.argtypes=[C.c_void_p];_LIB.rc_read_point.argtypes=[C.c_void_p,C.c_uint32,C.c_void_p]
    return _LIB
class Engine:
    def __init__(self,identities,epoch=7,experimental=False):
        self.lib=library();self.buffer=C.create_string_buffer(self.lib.rc_size());self.identities=C.create_string_buffer(identities)
        self.mem=Memory();self.data=None;self.lib.rc_init(self.buffer,self.identities,epoch,int(experimental))
    def mount(self,data):
        self.data=C.create_string_buffer(data);self.mem.data=C.addressof(self.data);self.mem.size=len(data)
        return bool(self.lib.rc_mount(self.buffer,C.cast(self.lib.rc_host_read,C.c_void_p),C.byref(self.mem),len(data)))
    def tick(self,**fields):
        if 'heading_deg' in fields:
            d=fields.pop('heading_deg');r=math.radians(d) if d is not None else 0.0
            fields['heading_x']=math.sin(r);fields['heading_y']=math.cos(r)
        i=Input(**fields);o=Output();self.lib.rc_tick(self.buffer,C.byref(i),C.byref(o));return {n:getattr(o,n) for n,_ in Output._fields_}
    def point(self,index):
        out=(C.c_int32*2)();ok=self.lib.rc_read_point(self.buffer,index,out);return list(out) if ok else None
