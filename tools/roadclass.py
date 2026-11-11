"""Road classes for the CC700 map (rules: OSRM bicycle profile access, OpenMapTiles zoom-13 selection)."""
import math
ACCESS_NO={'no','private','agricultural','forestry','delivery','use_sidepath'}
ACCESS_YES={'yes','permissive','designated'}
SERVICE_HIDE={'driveway','parking_aisle','parking','drive-through','drive-thru','emergency_access','alley'}
UNPAVED={'gravel','fine_gravel','compacted','dirt','ground','grass','sand','unpaved','earth','mud','pebblestone','woodchips','grass_paver'}
KIND_CODE={'main':1,'tertiary':2,'street':3,'service':4,'path':5,'track':6}
def hav(a,b):
    R=6371000; p1,p2=math.radians(a[0]),math.radians(b[0]); dl=math.radians(b[1]-a[1]); dp=p2-p1
    x=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2; return 2*R*math.asin(math.sqrt(x))
def kind(t):
    h=t.get('highway'); a=next((t[k] for k in ('bicycle','vehicle','access') if k in t),None)
    if h in ('primary','primary_link','secondary','secondary_link','trunk','trunk_link'): return 'main'
    if h in ('tertiary','tertiary_link'): return 'tertiary'
    if h in ('residential','unclassified','living_street','road'):
        return None if t.get('access') in ('no','private') else 'street'
    if a in ACCESS_NO: return None
    if h=='service':
        if t.get('service') in SERVICE_HIDE or t.get('access') in ('private','customers','destination'): return None
        return 'service' if t.get('name') or 'service' in t else 'service_short'
    unp=t.get('surface') in UNPAVED or t.get('tracktype','') in ('grade2','grade3','grade4','grade5')
    if h=='track': return 'track' if t.get('tracktype','grade3')!='grade1' or unp else 'path'
    if h in ('cycleway','path'): return 'track' if unp else 'path'
    if h in ('footway','pedestrian','bridleway') and t.get('bicycle') in ACCESS_YES: return 'track' if unp else 'path'
    return None
