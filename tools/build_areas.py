"""Add the built-up area layer (option B ground) to an existing road pack: data/<region>/a0.bin + index.json "areas".
Road chunks stay unchanged, so phones only download the new file.
usage: python build_areas.py region.osm.pbf data/<region>
Area tile (same grid as the roads) = varint npoly | per polygon: varint nrings | per ring: varint n
  | n * (zigzag dlat, zigzag dlon) in 1e-5 deg, first point relative to the tile origin, then to the previous point.
Ring 0 is the outer ring (counter-clockwise), the others are holes (clockwise): fill with the non-zero rule."""
import sys,json,os,math,time,tempfile
from areas import main as extract
from build_pack import uv,zz
def build(pbf,out):
    I=json.load(open(os.path.join(out,'index.json'))); t0=time.time()
    tmp=os.path.join(tempfile.mkdtemp(),'areas.json'); extract(pbf,tmp); polys=json.load(open(tmp))
    tiles={}
    for p in polys:
        r=int((p[0][0][0]-I['lat0'])/I['dlat']); c=int((p[0][0][1]-I['lon0'])/I['dlon'])
        if 0<=r<I['rows'] and 0<=c<I['cols']: tiles.setdefault((r,c),[]).append(p)
    blob=bytearray(); idx={}
    for (r,c),ps in sorted(tiles.items()):
        ola=round((I['lat0']+r*I['dlat'])*1e5); olo=round((I['lon0']+c*I['dlon'])*1e5); b=bytearray(uv(len(ps)))
        for p in ps:
            b+=uv(len(p))
            for ring in p:
                b+=uv(len(ring)); pa,po=ola,olo
                for la,lo in ring: ia,io=round(la*1e5),round(lo*1e5); b+=uv(zz(ia-pa))+uv(zz(io-po)); pa,po=ia,io
        idx[f'{r},{c}']=[len(blob),len(b)]; blob+=b
    assert len(blob)<20_000_000
    open(os.path.join(out,'a0.bin'),'wb').write(blob)
    I['areas']={'file':'a0.bin','bytes':len(blob),'tiles':idx,'kinds':'landuse residential/commercial/retail/industrial/garages/railway/construction'}
    json.dump(I,open(os.path.join(out,'index.json'),'w'))
    print('polygons',len(polys),'tiles',len(idx),'MB',round(len(blob)/1e6,2),round(time.time()-t0),'s')
if __name__=='__main__': build(*sys.argv[1:3])
