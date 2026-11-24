import json, math, heapq, sys, random
d=json.load(open(sys.argv[1])); target=float(sys.argv[2]); seed=int(sys.argv[3]); out=sys.argv[4]
N={int(k):v for k,v in d['nodes'].items()}
ok={'track','residential','unclassified','tertiary','secondary','cycleway','living_street','service','path','primary','footway','pedestrian'}
lat0=sum(v[0] for v in N.values())/len(N)
K=math.cos(math.radians(lat0))
def dist(a,b): return math.hypot((a[0]-b[0])*111320,(a[1]-b[1])*111320*K)
G={}
for wid,nds,t in d['ways']:
  if t.get('highway') not in ok or t.get('access') in ('no','private'): continue
  for a,b in zip(nds,nds[1:]):
    if a in N and b in N:
      w=dist(N[a],N[b])*(1.0 if t['highway'] in ('track','residential','unclassified','cycleway','living_street','tertiary') else 1.6)
      G.setdefault(a,[]).append((b,w)); G.setdefault(b,[]).append((a,w))
lats=[N[n][0] for n in G]; lons=[N[n][1] for n in G]
cl=(min(lats)+max(lats))/2; co=(min(lons)+max(lons))/2
random.seed(seed)
cand=[n for n in G if dist(N[n],(cl,co))<target*0.6]
best=None
for _ in range(40):
  s=random.choice(cand)
  D={s:0}; P={}; pq=[(0,s)]
  while pq:
    c,u=heapq.heappop(pq)
    if c>D[u]: continue
    for v,w in G[u]:
      if c+w<D.get(v,1e18): D[v]=c+w; P[v]=u; heapq.heappush(pq,(c+w,v))
  ends=[n for n in D if abs(dist(N[n],N[s])-target*0.75)<300 and dist(N[n],(cl,co))<target*0.6]
  if not ends: continue
  e=random.choice(ends); path=[e]
  while path[-1]!=s: path.append(P[path[-1]])
  L=sum(dist(N[a],N[b]) for a,b in zip(path,path[1:]))
  if best is None or abs(L-target)<abs(best[0]-target): best=(L,path)
L,path=best
pts=[N[n][:2] for n in path]
print(round(L), len(pts), pts[0], pts[-1])
with open(out,'w') as f:
  f.write('<?xml version="1.0"?><gpx><trk><name>t</name><trkseg>'+''.join(f'<trkpt lat="{a:.7f}" lon="{b:.7f}"></trkpt>' for a,b in pts)+'</trkseg></trk></gpx>')
