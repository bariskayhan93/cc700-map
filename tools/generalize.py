"""Map generalization before drawing (Google-Maps-like at zoom 15):
1. dual carriageways (oneway ways with same name+class, opposite direction, < 45 m apart) -> one centreline
2. *_link roads removed
3. paths/cycleways/footways that run along a street (< 22 m, parallel) removed (the street represents them)
4. Chaikin smoothing of curves
input/output: list of ways as from mapstyle.load (dict with nodes [(ref,lat,lon)], tags, kind, len)"""
import math,collections
from roadclass import hav
STREETS={'main','tertiary','street'}
PATH_NET=150
def _xy(k):
    return lambda la,lo:(lo*111320*k,la*111320)
class SegGrid:
    def __init__(s,M,cell=50):
        s.M=M; s.c=cell; s.g=collections.defaultdict(list)
    def add(s,wid,pts):
        for (ax,ay),(bx,by) in zip(pts,pts[1:]):
            for cx in range(int(min(ax,bx)//s.c)-1,int(max(ax,bx)//s.c)+2):
                for cy in range(int(min(ay,by)//s.c)-1,int(max(ay,by)//s.c)+2):
                    s.g[(cx,cy)].append((wid,ax,ay,bx,by))
    def nearest(s,x,y,skip=None,filt=None):
        best=None
        for wid,ax,ay,bx,by in s.g.get((int(x//s.c),int(y//s.c)),()):
            if wid==skip or (filt and not filt(wid)): continue
            dx,dy=bx-ax,by-ay; L2=dx*dx+dy*dy or 1e-9; t=max(0,min(1,((x-ax)*dx+(y-ay)*dy)/L2))
            px,py=ax+t*dx,ay+t*dy; d=math.hypot(x-px,y-py)
            if best is None or d<best[0]: best=(d,px,py,math.atan2(dy,dx),wid)
        return best
def chaikin(pts,it=2):
    for _ in range(it):
        if len(pts)<3: return pts
        out=[pts[0]]
        for a,b in zip(pts,pts[1:]):
            out+= [(0.75*a[0]+0.25*b[0],0.75*a[1]+0.25*b[1]),(0.25*a[0]+0.75*b[0],0.25*a[1]+0.75*b[1])]
        out.append(pts[-1]); pts=out
    return pts
def generalize(ways):
    k=math.cos(math.radians(ways[0]['nodes'][0][1])); M=_xy(k)
    inv=lambda x,y:(y/111320,x/(111320*k))
    # connectors: footway/pedestrian pieces that join two drawn roads become paths (otherwise the network breaks)
    refs=collections.Counter()
    for w in ways:
        if w['kind']:
            for r,_,_ in w['nodes']: refs[r]+=1
    for w in ways:
        t=w['tags']; h=t.get('highway')
        if w['kind'] or h not in ('footway','pedestrian'): continue
        if t.get('footway') in ('sidewalk','crossing') or t.get('access') in ('no','private') or t.get('bicycle')=='no': continue
        if h=='pedestrian' or (refs[w['nodes'][0][0]] and refs[w['nodes'][-1][0]] and w['len']<80): w['kind']='path'
    W=[w for w in ways if w['kind'] and (not w['tags'].get('highway','').endswith('_link') or w['tags'].get('name') or w['len']>=60)]
    # zoom-13 rule for paths: keep only named paths, or connected path networks >= PATH_NET m
    par={id(w):id(w) for w in W}
    def f(a):
        while par[a]!=a: par[a]=par[par[a]]; a=par[a]
        return a
    ends=collections.defaultdict(list)
    for w in W:
        if w['kind'] in ('path','track'):
            for r,_,_ in w['nodes']: ends[r].append(id(w))
    for ids in ends.values():
        for x in ids[1:]: par[f(x)]=f(ids[0])
    comp=collections.Counter()
    for w in W:
        if w['kind'] in ('path','track'): comp[f(id(w))]+=w['len']
    W=[w for w in W if w['kind'] not in ('path','track') or w['tags'].get('name') or comp[f(id(w))]>=PATH_NET]
    P={id(w):[M(la,lo) for _,la,lo in w['nodes']] for w in W}
    G=SegGrid(M)
    for w in W: G.add(id(w),P[id(w)])
    byid={id(w):w for w in W}
    def heading(pts): return math.atan2(pts[-1][1]-pts[0][1],pts[-1][0]-pts[0][0])
    out=[]; dropped=collections.Counter()
    for w in W:
        t=w['tags']; pts=P[id(w)]
        # 3. sidewalk-like paths along streets
        if w['kind'] in ('path','track') or t.get('footway')=='sidewalk' or t.get('cycleway')=='sidepath':
            near=0
            for (x,y),(x2,y2) in zip(pts,pts[1:]+pts[-1:]):
                h=math.atan2(y2-y,x2-x) if (x2,y2)!=(x,y) else None
                r=G.nearest(x,y,skip=id(w),filt=lambda i:byid[i]['kind'] in STREETS)
                if r and r[0]<22 and (h is None or abs((math.degrees(h-r[3])+90)%180-90)<25): near+=1
            if near>=0.6*len(pts): dropped['sidewalk']+=1; continue
        # 1. dual carriageway -> centreline. Both carriageways move to the middle; one is dropped only if fully paired
        if t.get('oneway') in ('yes','-1','1') and w['kind'] in STREETS and len(pts)>=2:
            same=lambda i:i!=id(w) and byid[i]['kind']==w['kind'] and byid[i]['tags'].get('oneway') in ('yes','-1','1') and byid[i]['tags'].get('name')==t.get('name')
            newp=[]; paired=0
            for n,(x,y) in enumerate(pts):
                a=pts[max(0,n-1)]; b=pts[min(len(pts)-1,n+1)]; hw=math.atan2(b[1]-a[1],b[0]-a[0])
                r=G.nearest(x,y,filt=same)
                if r and 3<r[0]<45 and abs((math.degrees(hw-r[3])+180)%360-180)>135:
                    newp.append(((x+r[1])/2,(y+r[2])/2)); paired+=1
                else: newp.append((x,y))
            if paired:
                if paired==len(pts) and not(-90<=math.degrees(heading(pts))<90): dropped['carriageway']+=1; continue
                pts=newp
        sm=chaikin(pts,2) if len(pts)>=3 else pts
        nw=dict(w); nw['nodes']=[(None,)+inv(x,y) for x,y in sm]; out.append(nw)
    return out,dropped
