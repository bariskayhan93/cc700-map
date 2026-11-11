"""Built-up land areas for the grey ground layer (option B): landuse residential/commercial/retail/industrial/
garages/railway/construction. Rings are simplified (Douglas-Peucker 8 m), outer rings counter-clockwise, inner
rings (holes) clockwise, so the page can fill with the non-zero winding rule.
usage: python areas.py region.osm.pbf out.json [lat0 lon0 lat1 lon1]"""
import sys,json,math,time
import osmium
BUILT={'residential','commercial','retail','industrial','garages','railway','construction'}
SIMPLIFY=8.0; MIN_AREA=1500.0      # m, m²: smaller areas are not visible at 2.5 m/px and cost entries
def area_m2(r,k):
    return sum((r[i][1]*k*111320)*(r[i+1][0]*111320)-(r[i+1][1]*k*111320)*(r[i][0]*111320) for i in range(len(r)-1))/2
def rdp(p,eps,k):
    if len(p)<3: return p
    ax,ay=p[0][1]*k*111320,p[0][0]*111320; bx,by=p[-1][1]*k*111320,p[-1][0]*111320
    dx,dy=bx-ax,by-ay; L=math.hypot(dx,dy) or 1e-9; best,bi=0,0
    for i in range(1,len(p)-1):
        x,y=p[i][1]*k*111320,p[i][0]*111320
        d=abs(dy*(x-ax)-dx*(y-ay))/L if L>1e-6 else math.hypot(x-ax,y-ay)
        if d>best: best,bi=d,i
    if best<=eps: return [p[0],p[-1]]
    return rdp(p[:bi+1],eps,k)[:-1]+rdp(p[bi:],eps,k)
def ring(nodes,k,outer):
    r=[(round(n.lat,5),round(n.lon,5)) for n in nodes]
    if len(r)<4: return None
    r=rdp(r,SIMPLIFY,k)
    if len(r)<4: return None
    a=area_m2(r,k)
    if abs(a)<MIN_AREA: return None
    if (a>0)!=outer: r=r[::-1]
    return r
def main(pbf,out,*bb):
    bb=[float(x) for x in bb] if bb else None; t0=time.time(); polys=[]
    fp=osmium.FileProcessor(pbf).with_areas(osmium.filter.KeyFilter('landuse')).with_filter(osmium.filter.KeyFilter('landuse'))
    for o in fp:
        if not o.is_area() or o.tags.get('landuse') not in BUILT: continue
        for ou in o.outer_rings():
            try:
                la=[n.lat for n in ou]; lo=[n.lon for n in ou]
                if bb and (max(la)<bb[0] or min(la)>bb[2] or max(lo)<bb[1] or min(lo)>bb[3]): continue
                k=math.cos(math.radians(sum(la)/len(la)))
                r=ring(ou,k,True)
                if not r: continue
                holes=[h for h in (ring(i,k,False) for i in o.inner_rings(ou)) if h]
                polys.append([r]+holes)
            except osmium.InvalidLocationError: continue
        if len(polys)%20000==0 and polys: print(len(polys),'areas',round(time.time()-t0),'s',flush=True)
    json.dump(polys,open(out,'w'),separators=(',',':'))
    print('areas',len(polys),'points',sum(len(r) for p in polys for r in p),round(time.time()-t0),'s')
if __name__=='__main__': main(*sys.argv[1:])
