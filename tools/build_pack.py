"""Build the road pack for the web page from an OSM .pbf (e.g. Geofabrik nordrhein-westfalen-latest.osm.pbf).
Route-independent work is done here: road class, dual-carriageway centrelines, sidewalk removal,
path-network selection, connectors, smoothing. The page only clips to the route corridor.
usage: python build_pack.py region.osm.pbf out_dir
Pack format (little endian):
  'CC7M' u16 ver=1 | f64 lat0 lon0 dlat dlon | u16 rows cols | rows*cols * (u32 off, u32 len) | tiles
  out dir: index.json (grid, tile -> [chunk, offset, length]) + c<N>.bin chunks
  tile = varint nnames | nnames * (varint len, utf8) | lines
  line = u8 kind (1 main,2 tertiary,3 street,4 service,5 path,6 track,7 foot,8 motorway; bit7 roundabout) | varint name+1 (0 none) | varint n
         | n * (zigzag dlat, zigzag dlon) in 1e-5 deg; first point relative to the tile origin, then to the previous point."""
import sys,struct,math,collections,array,time
import osmium
from roadclass import kind,hav,KIND_CODE
from generalize import generalize
TL,TO=0.05,0.08          # tile size deg (~5.5 km)
MARGIN=0.004             # ~400 m context for generalization
KEEP_TAGS=('junction','highway','name','oneway','footway','cycleway','access','bicycle','vehicle','service','surface','tracktype','tunnel','motorroad')
def zz(v): return (v<<1)^(v>>63)
def uv(v):
    o=bytearray()
    while True:
        x=v&0x7f; v>>=7
        if v: o.append(x|0x80)
        else: o.append(x); return bytes(o)
def main(pbf,out):
    t0=time.time(); W=[]
    fp=osmium.FileProcessor(pbf).with_locations().with_filter(osmium.filter.KeyFilter('highway'))
    for o in fp:
        if not o.is_way(): continue
        t={k:o.tags[k] for k in KEEP_TAGS if k in o.tags}
        if not kind(t) and t.get('highway') not in ('footway','pedestrian'): continue
        try: pts=[(n.ref,n.lat,n.lon) for n in o.nodes]
        except osmium.InvalidLocationError: continue
        if len(pts)<2: continue
        W.append((o.id,t,array.array('q',[p[0] for p in pts]),array.array('i',[round(p[1]*1e7) for p in pts]),array.array('i',[round(p[2]*1e7) for p in pts])))
        if len(W)%200000==0: print(len(W),'ways',round(time.time()-t0),'s',flush=True)
    print('ways kept',len(W))
    la=[min(w[3])/1e7 for w in W]; lo=[min(w[4])/1e7 for w in W]
    lat0=math.floor(min(la)/TL)*TL; lon0=math.floor(min(lo)/TO)*TO
    rows=int((max(max(w[3]) for w in W)/1e7-lat0)/TL)+1; cols=int((max(max(w[4]) for w in W)/1e7-lon0)/TO)+1
    print('grid',rows,'x',cols)
    # ways per tile (with margin) and home tile (first node)
    near=collections.defaultdict(list); home={}
    for i,w in enumerate(W):
        a0,a1=min(w[3])/1e7-MARGIN,max(w[3])/1e7+MARGIN; o0,o1=min(w[4])/1e7-MARGIN,max(w[4])/1e7+MARGIN
        for r in range(max(0,int((a0-lat0)/TL)),min(rows-1,int((a1-lat0)/TL))+1):
            for c in range(max(0,int((o0-lon0)/TO)),min(cols-1,int((o1-lon0)/TO))+1): near[(r,c)].append(i)
        home[i]=(int((w[3][0]/1e7-lat0)/TL),int((w[4][0]/1e7-lon0)/TO))
    blobs={}; nlines=0
    for n,(rc,idx) in enumerate(sorted(near.items())):
        ways=[]
        for i in idx:
            w=W[i]; nodes=[(w[2][j],w[3][j]/1e7,w[4][j]/1e7) for j in range(len(w[2]))]
            d=dict(id=w[0],tags=w[1],nodes=nodes,kind=kind(w[1]),home=(home[i]==rc))
            d['len']=sum(hav(a[1:],b[1:]) for a,b in zip(nodes,nodes[1:])); ways.append(d)
        gen,_=generalize(ways)
        r0,c0=rc; ola=round((lat0+r0*TL)*1e5); olo=round((lon0+c0*TO)*1e5); buf=bytearray(); names={}
        for g in gen:
            if not g.get('home') or g['kind'] not in KIND_CODE: continue
            L=sum(hav(a[1:],b[1:]) for a,b in zip(g['nodes'],g['nodes'][1:]))
            if g['kind']=='service' and L<50: continue
            pts=[]
            for _,a,b in g['nodes']:
                q=(round(a*1e5),round(b*1e5))
                if not pts or q!=pts[-1]: pts.append(q)
            if len(pts)<2: continue
            nm=g['tags'].get('name','')
            ni=names.setdefault(nm,len(names)) if nm else -1
            buf.append(KIND_CODE[g['kind']]|(0x80 if g['tags'].get('junction') in ('roundabout','circular') else 0))
            buf+=uv(ni+1)+uv(len(pts)); pa,po=ola,olo
            for ia,io in pts: buf+=uv(zz(ia-pa))+uv(zz(io-po)); pa,po=ia,io
            nlines+=1
        if buf:
            st=b''.join(uv(len(x.encode()))+x.encode() for x in names)
            blobs[rc]=uv(len(names))+st+bytes(buf)
        if n%200==0: print('tile',n,'/',len(near),'lines',nlines,round(time.time()-t0),'s',flush=True)
    # output: index.json + chunk files (each < 20 MB)
    import json,os
    os.makedirs(out,exist_ok=True); tiles={}; chunk=bytearray(); ci=0
    def flush():
        nonlocal chunk,ci
        if chunk: open(os.path.join(out,f'c{ci}.bin'),'wb').write(chunk); ci+=1; chunk=bytearray()
    for (r,c),b in sorted(blobs.items()):
        if len(chunk)+len(b)>20_000_000: flush()
        tiles[f'{r},{c}']=[ci,len(chunk),len(b)]; chunk+=b
    flush()
    json.dump(dict(version=2,lat0=lat0,lon0=lon0,dlat=TL,dlon=TO,rows=rows,cols=cols,scale=1e5,chunks=ci,tiles=tiles,
                   attribution='© OpenStreetMap contributors, ODbL',source=os.path.basename(pbf)),open(os.path.join(out,'index.json'),'w'))
    print('lines',nlines,'chunks',ci,'MB',round(sum(len(b) for b in blobs.values())/1e6,1),'time',round(time.time()-t0),'s')
if __name__=='__main__': main(*sys.argv[1:3])
