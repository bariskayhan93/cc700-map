import sys, gzip, json, xml.etree.ElementTree as ET
src, out = sys.argv[1], sys.argv[2]
f = gzip.open(src) if src.endswith('.gz') else open(src,'rb')
nodes={}; ways=[]; rels=[]
for ev, el in ET.iterparse(f):
    if el.tag=='node':
        t={x.get('k'):x.get('v') for x in el.findall('tag')}
        nodes[int(el.get('id'))]=[float(el.get('lat')),float(el.get('lon')),t or None]; el.clear()
    elif el.tag=='way':
        ways.append([int(el.get('id')),[int(n.get('ref')) for n in el.findall('nd')],{x.get('k'):x.get('v') for x in el.findall('tag')}]); el.clear()
    elif el.tag=='relation':
        rels.append([int(el.get('id')),[[m.get('type'),int(m.get('ref')),m.get('role')] for m in el.findall('member')],{x.get('k'):x.get('v') for x in el.findall('tag')}]); el.clear()
lat=[v[0] for v in nodes.values()]; lon=[v[1] for v in nodes.values()]
print(len(nodes),len(ways),len(rels),min(lat),min(lon),max(lat),max(lon))
json.dump({'nodes':nodes,'ways':ways,'rels':rels},open(out,'w'))
