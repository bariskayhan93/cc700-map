"""Render the offline mining report's diagrams; no firmware or private data needed.

Usage: python3 tools/render_mining_figures.py [--png]
SVG uses only standard-library Python. --png also uses installed ImageMagick.
"""
from pathlib import Path
from html import escape
import argparse
import math
import subprocess

OUT = Path(__file__).resolve().parents[1] / 'docs' / 'mining'
INK, MUTED, BLUE, GREEN, RED, GOLD = '#182e43', '#50677b', '#246b9b', '#26715c', '#ae3546', '#976112'
PALE, GP, RP, YP = '#edf4fa', '#e6f3ed', '#fcecef', '#fff4dd'


class Figure:
    def __init__(self, name, height, title, subtitle):
        self.name, self.height, self.parts = name, height, []
        self.parts.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="{height}" viewBox="0 0 1000 {height}" role="img" aria-labelledby="title desc">')
        self.parts.append(f'<title id="title">{escape(title)}</title><desc id="desc">{escape(subtitle)}</desc>')
        self.rect(0, 0, 1000, height, '#ffffff')
        self.text(38, 46, title, 27, weight='bold')
        self.text(38, 77, subtitle, 18, MUTED)

    def rect(self, x, y, w, h, fill=PALE, stroke=None, radius=0):
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke or "none"}"/>')

    def text(self, x, y, text, size=20, color=INK, anchor='start', weight='normal'):
        self.parts.append(f'<text x="{x}" y="{y}" font-family="Arial" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{escape(str(text))}</text>')

    def line(self, x1, y1, x2, y2, color=MUTED, width=2, dash=False):
        self.parts.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{width}"' + (' stroke-dasharray="7 5"' if dash else '') + '/>')

    def arrow(self, points, color=MUTED, dash=False):
        for (x1, y1), (x2, y2) in zip(points, points[1:]):
            self.line(x1, y1, x2, y2, color, 2, dash)
        (x1, y1), (x2, y2) = points[-2:]
        a = math.atan2(y2-y1, x2-x1)
        pts = [(x2, y2)] + [(x2-10*math.cos(a+t), y2-10*math.sin(a+t)) for t in (-.45, .45)]
        self.parts.append('<polygon points="' + ' '.join(f'{x},{y}' for x,y in pts) + f'" fill="{color}"/>')

    def box(self, x, y, w, h, title, sub='', fill=PALE, stroke=BLUE):
        self.rect(x, y, w, h, fill, stroke, 9)
        self.text(x+w/2, y+(h/2-3 if sub else h/2+7), title, 21, anchor='middle', weight='bold')
        if sub:
            self.text(x+w/2, y+h/2+23, sub, 17, MUTED, 'middle')

    def diamond(self, x, y, w, h, title, sub=''):
        self.parts.append(f'<polygon points="{x+w/2},{y} {x+w},{y+h/2} {x+w/2},{y+h} {x},{y+h/2}" fill="{YP}" stroke="{GOLD}" stroke-width="2"/>')
        self.text(x+w/2, y+h/2-1, title, 20, anchor='middle', weight='bold')
        if sub:
            self.text(x+w/2, y+h/2+23, sub, 17, MUTED, 'middle')

    def save(self):
        self.parts.append('</svg>')
        p = OUT / (self.name + '.svg')
        p.write_text('\n'.join(self.parts) + '\n')
        return p


def offroute():
    f = Figure('01-offroute-flow', 795, 'Loaded map data can still be hidden', 'Confirmed saved-v16 control flow. Live off-route reproduction remains pending.')
    f.box(60, 116, 330, 72, 'Load nearby map block', 'cc_blk replaces 0x42050150', GP, GREEN)
    f.arrow([(225,188),(225,212)], GREEN)
    f.box(60, 212, 330, 65, 'Map data available', 'Loading does not clear the flag', GP, GREEN)
    f.box(540, 116, 370, 72, 'Navigation draw callback', '0x420515c8')
    f.arrow([(725,188),(725,212)])
    f.box(540, 212, 370, 65, 'Clear canvas', '0x4205bcac')
    f.arrow([(725,277),(725,306)])
    f.box(540, 306, 370, 65, 'Draw map / route frame', '0x4204da24')
    f.arrow([(725,371),(725,398),(500,398),(500,420)])
    f.diamond(340,420,320,110,'Map index present?','wrapper 0x4204c9b8')
    f.arrow([(340,475),(225,475),(225,575)], RED)
    f.text(263,463,'No',18,RED)
    f.arrow([(500,530),(500,552)])
    f.text(514,548,'Yes',18)
    f.diamond(340,552,320,110,'Off-route flag set?','0x42050618 reads +145')
    f.arrow([(340,607),(280,607)], RED)
    f.text(310,593,'Yes',18,RED,'middle')
    f.box(60,575,220,70,'Skip basemap','Return to frame caller',RP,RED)
    f.arrow([(500,662),(500,698)], GREEN)
    f.text(514,687,'No',18,GREEN)
    f.box(340,698,320,63,'Draw patched basemap','0x4204c9cd → cc_iter',GP,GREEN)
    f.arrow([(910,338),(955,338),(955,724),(895,724)], BLUE, True)
    f.box(704,686,191,75,'Route / overlays','Separate frame path')
    f.arrow([(225,277),(225,398),(450,398),(450,437)], GREEN, True)
    f.text(60,319,'Data path',18,GREEN)
    f.text(60,348,'does not bypass',18,GREEN)
    f.text(60,377,'the draw gate',18,GREEN)
    return f.save()


def schema():
    f = Figure('02-format-schema', 885, 'File schema → decoded map entry', 'Selected fields only. Protobuf field numbers are scoped to their containing message.')
    f.box(38,112,924,62,'Route file: 128-byte header + records + images + map section')
    f.arrow([(230,174),(230,210)])
    f.arrow([(750,174),(750,210)])
    f.box(38,210,416,67,'Route record','Field 1 info · 2 count · 3 points')
    f.box(506,210,456,67,'Header map offset: 0x5c','Index → block offsets → repeated entries')
    f.arrow([(230,277),(230,313)])
    f.rect(38,313,416,174,PALE)
    for y,t in [(346,'Info field 8: geohash index'),(380,'cell → first / last point index × 2'),(430,'Point field 8: compass bearing'),(464,'north = 0° · east = 90°')]:
        f.text(58,y,t,20,BLUE if y in (346,430) else INK)
    f.arrow([(750,277),(750,313)])
    f.rect(506,313,456,174,PALE)
    for y,t in [(345,'Map entry fields'),(379,'1 index · 2 style · 3 latitude'),(413,'4 longitude · 5 point-pair count'),(447,'6 repeated {1 latitude, 2 longitude}')]:
        f.text(526,y,t,20,BLUE if y==345 else INK)
    f.text(38,532,'Decoded entry in RAM: 24-byte stride',23,weight='bold')
    names=['index','style','latitude','longitude','count','points ptr']
    for i,name in enumerate(names):
        x=38+i*154
        f.rect(x,554,154,72,GP if i==5 else PALE,'#ffffff')
        f.text(x+77,580,f'+{i*4:02d}',17,MUTED,'middle')
        f.text(x+77,610,name,20,anchor='middle')
    f.text(38,655,'Allocator reserves 28N bytes for the table; coordinate pairs add 8P bytes.',20)
    f.text(38,699,'Style word: meaning depends on class',23,weight='bold')
    fields=[(0,3,'class'),(4,6,'level + 2'),(7,7,'bridge'),(8,8,'tunnel'),(9,9,'rough'),(10,10,'no outline'),(11,11,'far')]
    for i,(_,_,name) in enumerate(fields):
        x=38+i*132
        lo,hi=fields[i][:2]
        f.rect(x,718,132,64,PALE,'#ffffff')
        f.text(x+66,743,str(lo) if lo==hi else f'{lo}–{hi}',17,MUTED,'middle')
        f.text(x+66,770,name,18,anchor='middle')
    f.text(38,816,'Class 15: bit 15 marks rough-route geometry; bits 16–31 carry the arrow index.',19)
    f.text(38,850,'Class 12 labels pack text in the point payload; it is not geographic geometry.',19,MUTED)
    return f.save()


def growth():
    f = Figure('03-section-cost', 720, 'Long-route cost is a separate budget', 'Derived link traversals, not measured execution time. Both chart axes are logarithmic.')
    f.text(38,122,'Each indexed lookup starts at the list head',22,weight='bold')
    for i,(x,label) in enumerate([(38,'Point 0'),(222,'Point 1'),(406,'Point 2'),(590,'…'),(774,'Point i')]):
        f.box(x,145,160,60,label)
        if i<4:f.arrow([(x+160,175),(x+184,175)])
    f.text(38,242,'Scan every pair: pt(i), pt(i + 1) → total link traversals = (n − 1)²',22,BLUE)
    x0,y0,w,h=135,605,760,275
    X=lambda n:x0+(math.log10(n)-1)/2*w
    Y=lambda v:y0-(math.log10(v)-1)/5*h
    for v in [10,100,1000,10000,100000,1000000]:
        yy=Y(v);f.line(x0,yy,x0+w,yy,'#dce5ec',1)
        f.text(x0-14,yy+6,f'{v:,}',17,MUTED,'end')
    for n in [10,20,50,100,200,500,1000]:
        xx=X(n);f.line(xx,y0,xx,y0+7)
        f.text(xx,y0+30,str(n),17,MUTED,'middle')
    f.line(x0,Y(1000000),x0,y0);f.line(x0,y0,x0+w,y0)
    pts=[(X(n),Y((n-1)**2)) for n in range(10,1001,3)]
    for (x1,y1),(x2,y2) in zip(pts,pts[1:]):
        f.line(x1,y1,x2,y2,BLUE,4)
    for n,dx,dy in [(24,12,32),(101,12,32),(1000,-14,-18)]:
        xx,yy=X(n),Y((n-1)**2)
        f.parts.append(f'<circle cx="{xx}" cy="{yy}" r="6" fill="{BLUE}"/>')
        f.text(xx+dx,yy+dy,f'{n} points → {(n-1)**2:,} links',18,BLUE,'end' if n==1000 else 'start')
    f.text(135,308,'Linked-list links followed',18,MUTED)
    f.text(515,663,'Inflection points n',20,anchor='middle')
    f.text(38,700,'More sections spend CPU even when every map block stays below 1200 entries.',20)
    return f.save()


def lifetimes():
    f = Figure('04-memory-lifetimes', 687, 'Resident memory is only part of the load peak', 'Conceptual lifetimes; bar lengths indicate phases, not bytes or measured elapsed time.')
    left,step=295,158
    for i,t in enumerate(['Before load','Read bytes','Decode','After load']):
        f.text(left+i*step+step/2,130,t,19,anchor='middle',weight='bold')
        f.line(left+i*step,149,left+i*step,405,'#dce5ec',1,True)
    rows=[('Map canvas',167,0,4,PALE,BLUE,'122880 B'),('Old decoded block',232,0,2,YP,GOLD,'Old payload'),('New serialized block',297,1,2,PALE,BLUE,'S bytes'),('New decoded block',362,2,2,GP,GREEN,'28N + 8P')]
    for label,y,start,length,fill,col,value in rows:
        f.text(38,y+30,label,21)
        f.rect(left+start*step,y,length*step-8,45,fill,col,5)
        f.text(left+(start+length/2)*step-4,y+30,value,20,col,'middle')
    f.text(38,456,'Load-phase overlap',23,weight='bold')
    f.text(38,491,'Old decoded + new serialized, then new serialized + new decoded.',21)
    f.text(38,537,'Drawing-phase turnover',23,weight='bold')
    f.text(38,572,'One float scratch buffer per iterator + one allocation per projection call.',21)
    f.text(38,607,'Saved fixture A: 1123 entries → 1741 projection calls per map iterator.',21,BLUE)
    f.text(38,654,'Also budget allocator overhead, map index, route state, fonts and other LVGL buffers.',18,MUTED)
    return f.save()


def heaps():
    f = Figure('05-heap-log-schema', 516, 'Three heap numbers answer different questions', 'Decoded November 13 mounted log: 23 samples. None reports the largest free block.')
    f.box(38,112,924,63,'free_heap_size = first / second / third','AppLogTask · 0x420b4e60')
    rows=[(38,'First','Current default heap','0x1000','1,449,968–1,680,164 B',PALE,BLUE),
          (354,'Second','Current internal DMA heap','0x80c','48,324–48,396 B',YP,GOLD),
          (670,'Third','Default heap low-water','0x1000','1,171,944–1,410,688 B',GP,GREEN)]
    for x,order,title,mask,value,fill,col in rows:
        f.arrow([(x+146,175),(x+146,213)],col)
        f.rect(x,213,292,220,fill)
        f.text(x+18,247,order,19,col,weight='bold')
        f.text(x+18,285,title,19,weight='bold')
        f.text(x+18,325,'Capability mask '+mask,18,MUTED)
        f.text(x+18,368,value,18,col)
        f.text(x+18,405,'Past minima' if order=='Third' else 'At sample time',19,MUTED)
    f.text(38,477,'Free totals do not establish contiguous allocation headroom or redraw speed.',22)
    return f.save()


def state():
    f = Figure('06-font-and-state', 800, 'Existing assets and state reduce the unknowns', 'Located in saved firmware. Integration, readability and sensor calibration remain unvalidated.')
    f.text(38,124,'Font assets already embedded in the image',23,weight='bold')
    for i,(name,addr,height,chars,col) in enumerate([
        ('Current map font','0x3c1e6f98','16 px','No ä ö ü ß é',RED),
        ('SHS_N_10 fallback','0x3c2fb97c','14 px','Includes ä ö ü ß é',GREEN),
        ('SHS_N_12 fallback','0x3c308410','16 px','Includes ä ö ü ß é',GREEN)]):
        y=146+i*58;f.rect(38,y,924,52,RP if i==0 else GP)
        f.text(55,y+34,name,20);f.text(340,y+34,addr,19,MUTED)
        f.text(584,y+34,height,20);f.text(705,y+34,chars,20,col)
    f.text(38,365,'Ambient-light record · 8 bytes at 0x3fc9facc',23,weight='bold')
    fields=[(38,462,'+0..3','Environment value','32-bit display read'),(500,260,'+4..5','Voltage value','16-bit display read'),(760,202,'+6..7','Other bytes','Not detailed here')]
    for x,w,off,title,sub in fields:
        f.rect(x,387,w,99,PALE,'#ffffff')
        f.text(x+18,413,off,17,MUTED);f.text(x+18,446,title,20)
        f.text(x+18,473,sub,17,MUTED)
    f.text(38,526,'Getter 0x4203b9c4 · setter 0x4203b9b0 · units / thresholds still open.',19)
    f.text(38,585,'Existing zoom state and controls',23,weight='bold')
    f.box(38,608,275,80,'Conditional zoom logic','0x42050190 · constants 100/110')
    f.arrow([(313,648),(352,648)])
    f.box(352,608,274,80,'Navigation context','+44 saved · +48 target')
    f.arrow([(626,648),(664,648)])
    f.box(664,608,298,80,'Effective zoom','0x3c388d00')
    f.text(38,737,'Setter 0x4204a56c · getter 0x4204a578 · target 16 appears in existing logic.',19)
    f.text(38,774,'Finding an accessor does not establish a safe new feature or a calibrated threshold.',18,MUTED)
    return f.save()


def patch_space():
    origin,end=0x421dc5d0,0x421e0000
    code,const=5536,296
    total=end-origin;free=total-code-const
    assert free==9064
    f = Figure('07-patch-space', 427, 'Executable patch space is one specific envelope', 'Saved v16, reproduced byte-for-byte. Other free flash is not automatically usable here.')
    f.text(38,130,f'Current mapped tail: {total:,} bytes',23,weight='bold')
    x,w=38,924
    for size,fill in [(code,BLUE),(const,GOLD),(free,'#e6f3ed')]:
        width=w*size/total;f.rect(x,158,width,78,fill);x+=width
    f.text(38,268,hex(origin),18,MUTED)
    f.text(962,268,hex(end),18,MUTED,'end')
    for x,title,value,col in [(38,'Code','5536 B',BLUE),(354,'Constants','296 B',GOLD),(670,'Remaining','9064 B',GREEN)]:
        f.rect(x,299,12,12,col);f.text(x+24,312,title,21)
        f.text(x+24,345,value,24,col,weight='bold')
    f.text(38,396,'RAM, draw time, globals and screen space remain separate constraints.',22)
    return f.save()


def heading_inputs():
    f = Figure('08-heading-inputs', 825, 'Navigation has two GPS sources and a magnetic fallback', 'Extracted firmware paths; physical sensor activity and replay activation remain untested.')
    f.box(38,115,440,74,'Live GNSS / RMC producer','0x420edec4 → record 0x3c3ae39c')
    f.box(522,115,440,74,'Native FIT replay task','0x420b59dc → allocated 52-byte record')
    f.arrow([(258,189),(258,225),(500,225),(500,252)])
    f.arrow([(742,189),(742,225),(500,225)])
    f.box(290,252,420,74,'Replay-aware GPS getter','0x420eeaa8 selects by active byte')
    f.arrow([(500,326),(500,360)])
    f.box(290,360,420,74,'Heading source selector','0x4204dfe0; persistent cached heading')
    f.arrow([(290,397),(246,397),(246,489)])
    f.arrow([(710,397),(754,397),(754,489)])
    f.box(38,489,415,99,'Speed ≥ 3000','Nonzero GPS course / 1000; else retain',GP,GREEN)
    f.box(497,489,465,99,'Speed comparison fails','Fix byte = 1 AND magnetic status = 3?',YP,GOLD)
    f.text(520,619,'Yes: magnetic heading. Otherwise: retain cache.',18,MUTED)
    f.arrow([(246,588),(246,651),(500,651),(500,679)])
    f.arrow([(754,588),(980,588),(980,651),(500,651)])
    f.box(290,679,420,74,'450 − cached heading → setter','0x4204a504, mode 1: immediate update',GP,GREEN)
    f.text(38,796,'FIT replay derives course from position history; it does not replace magnetic state.',20)
    return f.save()


def offroute_state():
    f = Figure('09-offroute-state', 840, 'Off-route is a decision followed by persistent state', 'Extracted local branches; invocation count is not yet a wall-clock timing contract.')
    f.box(38,112,440,86,'Route matching and geometry','0x4204b1e0; main table = 72 × all points')
    f.box(522,112,440,86,'Invalid input / zero point count','Immediate committed off-route = 1',RP,RED)
    f.arrow([(258,198),(258,232)])
    f.box(38,232,440,86,'Distance + angle + speed decision','Candidate 0 or 1; 0x4204bdb8 onward')
    f.arrow([(258,318),(258,351),(500,351),(500,374)])
    f.diamond(285,374,430,112,'Candidate changed?','Compared with prior candidate byte +147')
    f.arrow([(285,430),(248,430),(248,530)])
    f.text(240,462,'Yes',18)
    f.arrow([(715,430),(752,430),(752,530)])
    f.text(765,462,'No',18)
    f.box(38,530,420,86,'Reset repeat counter to 0','Keep committed state; remember candidate',YP,GOLD)
    f.box(502,530,460,86,'Increment repeat counter','At 10: commit candidate and clamp to 10',GP,GREEN)
    f.arrow([(248,616),(248,651),(500,651),(500,678)])
    f.arrow([(752,616),(752,651),(500,651)])
    f.box(285,678,430,76,'Publish 148-byte result','Committed byte +145 → basemap draw gate')
    f.arrow([(742,198),(980,198),(980,716),(715,716)],RED)
    f.text(38,795,'Mode 1 additionally resets the counter while committed off-route is 1.',19,MUTED)
    f.text(38,823,'Normal dispatcher call uses mode 0. Proximity flag +144 has separate reload effects.',18,MUTED)
    return f.save()


def rejoin_planning():
    f = Figure('10-rejoin-planning', 965, 'Off-route detection and rejoin planning are separate', 'Static control flow; numeric states and eligibility gates determine which work advances.')
    f.box(38,112,440,84,'Matcher result','Committed +145; selected-point distance +112')
    f.box(522,112,440,84,'Calculation record 15','20-byte position / validity; separate GPS path')
    f.arrow([(258,196),(258,226),(500,226),(500,253)])
    f.arrow([(742,196),(742,226),(500,226)])
    f.box(230,253,540,84,'Notice / planning eligibility gates','Route count, point index, validity and category',YP,GOLD)
    f.arrow([(500,337),(500,368)])
    f.box(230,368,540,76,'Persistent control at 0x3c38940c','Steps 0–6; counters advance on eligible calls')
    f.arrow([(365,444),(365,477),(258,477),(258,507)])
    f.arrow([(635,444),(635,477),(742,477),(742,507)],MUTED,True)
    f.text(742,470,'Step-5 entry still being traced',16,MUTED,'middle')
    f.box(38,507,440,86,'Steps 3–4: request / response','Only response 0 advances its timeout')
    f.box(522,507,440,86,'Step 5: local planning','FIT replay pause = 1 before planner work')
    f.arrow([(258,593),(60,593),(60,650),(500,650),(500,688)])
    f.arrow([(742,593),(940,593),(940,650),(500,650)])
    f.text(258,623,'Accepted response 3',18,MUTED,'middle')
    f.text(742,623,'Replay pause released on exit',17,MUTED,'middle')
    f.box(230,688,540,76,'Accepted result → enqueue event 91','GUI queue → ride handler → ExecuteNavigation',GP,GREEN)
    f.arrow([(500,764),(500,805)])
    f.box(230,805,540,76,'Completion callback 0x4205095c','Status-dependent continuation; notice step → 0')
    f.text(38,924,'Queue failure and GUI target changes can prevent delivery; callback reads shared status.',18,MUTED)
    f.text(38,952,'Solid arrows: extracted flow. Dashed step-5 entry: control integration still under extraction.',18,MUTED)
    return f.save()


def navigation_runtime():
    f = Figure('11-navigation-runtime', 1040, 'Navigation consumes published state and queued work', 'Static stock/v16 chains. Queuing a pointer does not freeze the pointed-to data.')
    f.box(38,112,440,82,'Live / replay GPS record','52-byte source; heading reads it directly')
    f.box(522,112,440,82,'Planning completion descriptor','Callback + shared status pointer')
    f.arrow([(258,194),(258,226)])
    f.arrow([(742,194),(742,226)])
    f.box(38,226,440,82,'Raw calculation queue','50 × 12-byte descriptors; zero-wait send')
    f.box(522,226,440,82,'GUI queue: event 91','10 × 12-byte messages; send may fail')
    f.arrow([(258,308),(258,340)])
    f.arrow([(742,308),(742,340)])
    f.box(38,340,440,82,'Drain queue → ingest type 8','Copy 44 bytes after speed check')
    f.box(522,340,440,82,'Current GUI target → ride handler','0x4205ccaa → ExecuteNavigation')
    f.arrow([(258,422),(258,454)])
    f.arrow([(742,422),(742,454)])
    f.box(38,454,440,82,'Calculation and position filtering','Raw fix and qualification are separate')
    f.box(522,454,440,82,'Invoke descriptor callback','Read status when callback runs')
    f.arrow([(258,536),(258,568)])
    f.arrow([(742,536),(742,568)])
    f.box(38,568,440,82,'Publish 724-byte snapshot','Record 15 = 20 bytes at offset 472',GP,GREEN)
    f.box(522,568,440,82,'Eligible restart → teardown','Clear route lists and all six file slots',YP,GOLD)
    f.arrow([(258,650),(258,682)])
    f.arrow([(742,650),(742,682)])
    f.box(38,682,440,82,'Navigation position / planning','Read snapshot; coordinates can be retained')
    f.box(522,682,440,82,'Free current map allocations','Decoded entries, coordinates and map state',RP,RED)
    f.arrow([(742,764),(742,796)])
    f.box(522,796,440,82,'Start and reload route data','Mode, connector and direction dependent')
    f.text(38,821,'Position and heading have',21,weight='bold')
    f.text(38,852,'different publication stages.',21,weight='bold')
    f.text(38,934,'Preserving the original map across restart needs an independent retention mechanism.',20)
    f.text(38,972,'Queue delivery, shared-pointer lifetimes and timing still need runtime observation.',19,MUTED)
    f.text(38,1010,'No device changes. Evidence: byte comparisons and GNU Xtensa instruction traces.',18,MUTED)
    return f.save()


def arrival_state():
    f = Figure('12-arrival-state', 1030, 'Arrival is armed before it is completed', 'Extracted local transitions at 0x42052500; thresholds retain firmware numeric values.')
    f.box(230,112,540,78,'Caller eligibility / endpoint logic','Prompt, fix, off-route and progress gates')
    f.arrow([(500,190),(500,224)])
    f.box(230,224,540,78,'Arrival state 0','Remaining value ≤ 100?')
    f.text(38,268,'If >100: remain 0',16,MUTED)
    f.arrow([(500,302),(500,341)])
    f.box(230,341,540,106,'Closed-route guard','Endpoint separation, total route and ridden distance',YP,GOLD)
    f.text(500,444,'Hold state 0 only when all guard conditions pass',16,MUTED,'middle')
    f.arrow([(500,447),(500,486)])
    f.text(518,474,'Otherwise',17)
    f.box(230,486,540,78,'Arm arrival state 1','No final-arrival action in the arming call')
    f.arrow([(500,564),(500,600)])
    f.box(230,600,540,100,'Later eligible call','Selected index ≥ count − 2 OR remaining ≤ 75')
    f.text(500,695,'Otherwise remain armed',16,MUTED,'middle')
    f.arrow([(500,700),(500,740)])
    f.box(230,740,540,96,'Complete → arrival state 2','Notice type 9; conditional course-record event 11',GP,GREEN)
    f.arrow([(770,526),(924,526),(924,650),(770,650)],MUTED,True)
    f.text(885,590,'Next call',16,MUTED,'middle')
    f.text(38,903,'Closed-route guard uses start/end separation, route length and ridden distance.',20)
    f.text(38,945,'Event 11 = RECORD_COURSE_DATA. Ride-stop event = 8 (END_RIDE).',20,weight='bold')
    f.text(38,994,'State 2 returns without repeating completion. Caller/reset paths can change the state.',18,MUTED)
    return f.save()


def planner_limits():
    f = Figure('13-planner-limits', 910, 'Planner limits govern different decisions', 'Extracted enforcement in V1.414 / saved v16; runtime costs remain unmeasured.')
    f.text(38,129,'DATA LOADING',19,BLUE,weight='bold')
    f.box(38,151,435,88,'Current free heap < 2 MiB?','Context +48; 0x420df532',YP,GOLD)
    f.arrow([(473,195),(528,195)])
    f.text(500,181,'Yes',17,GOLD,'middle')
    f.box(528,151,434,88,'Release graph caches','Continue loading; no reservation',YP,GOLD)
    f.text(38,289,'SEARCH LOOP · ordered checks',19,BLUE,weight='bold')
    f.box(38,315,435,78,'Current free heap < 1 MiB?','Context +52; 0x420e2410')
    f.arrow([(473,354),(528,354)],RED)
    f.text(500,340,'Yes',17,RED,'middle')
    f.box(528,315,434,78,'Abort: output code 1','Free-heap floor, not allocation cap',RP,RED)
    f.arrow([(255,393),(255,437)])
    f.text(270,422,'No',17)
    f.box(38,437,435,78,'Elapsed time > 15 seconds?','Seconds-format clock; context +72')
    f.arrow([(473,476),(528,476)],RED)
    f.text(500,462,'Yes',17,RED,'middle')
    f.box(528,437,434,78,'Abort: output code 2','Negative limit disables this check',RP,RED)
    f.arrow([(255,515),(255,559)])
    f.text(270,544,'No',17)
    f.box(38,559,435,78,'Cancellation requested?','Word at 0x3fca2bd8')
    f.arrow([(473,598),(528,598)],RED)
    f.text(500,584,'Yes',17,RED,'middle')
    f.box(528,559,434,78,'Abort: output code 3','No frontier instead gives code 4',RP,RED)
    f.arrow([(255,637),(255,681)])
    f.text(270,666,'No',17)
    f.box(38,681,435,78,'Continue frontier search','Yield call every 501 loop visits',GP,GREEN)
    f.text(528,707,'These are planner output codes.',20,weight='bold')
    f.text(528,739,'Outer navigation maps them separately.',19,MUTED)
    f.text(38,823,'2 MiB triggers cleanup; 1 MiB stops search. Neither value is measured headroom.',20,weight='bold')
    f.text(38,867,'Peak heap, fragmentation, check latency and physical timing still require observation.',19,MUTED)
    return f.save()


def start_warning():
    f = Figure('14-start-warning', 900, 'A startup warning can outlive an off-route result', 'Notice text, popup container and matcher state are separate. Stock / v16 evidence.')
    f.text(38,126,'EXTRACTED TRIGGER',19,BLUE,weight='bold')
    f.text(522,126,'OBSERVED ON “hin”',19,BLUE,weight='bold')
    f.box(38,152,440,105,'Early-route eligibility','Index < 2; valid position; navigation = 2')
    f.text(258,245,'Arrival state = 0',17,MUTED,'middle')
    f.box(522,152,440,105,'Active navigation, index 0','Valid position; override = 0')
    f.arrow([(258,257),(258,297)])
    f.arrow([(742,257),(742,297)])
    f.box(38,297,440,82,'Committed off-route = 1','Required to select the warning',YP,GOLD)
    f.box(522,297,440,82,'Committed off-route = 0','Matcher completion = 1',GP,GREEN)
    f.arrow([(258,379),(258,419)])
    f.arrow([(742,379),(742,419)])
    f.box(38,419,440,104,'Set notice 8 → request popup 4','“Current position is far from the new route”',YP,GOLD)
    f.box(522,419,440,104,'Notice 8 / popup 4 still stored','Planning step = 0; UI responsive',YP,GOLD)
    f.arrow([(258,523),(258,563)])
    f.arrow([(742,523),(742,563)])
    f.box(38,563,440,104,'Timer period = 0xffffffff','No converse clear in the start helper')
    f.box(522,563,440,104,'Early-index planning gate returns','No normal planning-state dispatch here')
    f.text(38,725,'The warning helper contains no direct distance comparison.',21,weight='bold')
    f.text(38,766,'Current on-route state does not by itself prove that an earlier notice was cleared.',20)
    f.text(38,811,'The original warning transition was not captured; its earlier inputs remain unknown.',19,MUTED)
    f.text(38,854,'Timer expiry, dismissal, replacement and teardown have separate lifecycles.',19,MUTED)
    return f.save()


def coverage_boundary():
    f = Figure('15-validation-boundary', 920, 'What local work can prove — and what needs the device', 'Coverage is a set of evidence boundaries, not a percentage of decoded instructions.')
    f.text(38,126,'AVAILABLE AND CHECKED',19,GREEN,weight='bold')
    f.text(526,126,'NEXT VALIDATION BOUNDARY',19,GOLD,weight='bold')
    rows = [
        ('App / file generation', 'Preview suite + recovered route edge suite',
         'Two route edge failures reproduced', 'Noisy GPX and sparse GPX remain defects'),
        ('Patch implementation', 'Saved v16 rebuilt byte-for-byte',
         'Native execution under moving input', 'Frame time, heap and queue freshness'),
        ('Navigation logic', 'Matcher, heading, progress, notices, arrival',
         'Differential replay assertions', 'Geometry exceptions and task ordering'),
        ('Sensor receiver', 'UART setup, subtype dispatch, arrival latches',
         'Board / peer evidence', 'Hardware population and actual sampling'),
        ('Physical ride', 'Stationary warning and rotation observations',
         'One targeted acceptance ride', 'Motion quality, prompts and readability'),
    ]
    for i,(a,b,c,d) in enumerate(rows):
        y=154+i*139
        f.box(38,y,438,101,a,b,GP,GREEN)
        f.box(526,y,436,101,c,d,YP,GOLD)
        f.arrow([(476,y+50),(526,y+50)],GOLD)
    f.text(38,891,'Host checks reduce ride repetitions; they do not establish hardware or timing equivalence.',19,MUTED)
    return f.save()


def replay_readiness():
    f = Figure('16-replay-readiness', 820, 'Simulation test cleaned up after route crash', 'Three simulation files removed. Storage verified and normal firmware boot confirmed.')
    f.box(50,120,410,90,'Synthetic route near 0°, 0°','Far from the real German route',YP,GOLD)
    f.box(540,120,410,90,'5,138 km label + restart','Distance mismatch fits; crash cause unknown',YP,GOLD)
    f.arrow([(255,210),(255,255)],GREEN)
    f.arrow([(745,210),(745,255)],GOLD)
    f.box(50,255,410,105,'Three simulation files removed','Config + synthetic FIT + generated route',GP,GREEN)
    f.box(540,255,410,105,'Only three storage blocks changed','22 other files preserved; no coredump read',GP,GREEN)
    f.arrow([(255,360),(255,405)],GREEN)
    f.arrow([(745,360),(745,405)],GOLD)
    f.box(50,405,410,105,'Full storage checksum verified','Exact cleanup candidate read back',GP,GREEN)
    f.box(540,405,410,105,'RTS reset booted normal app','Firmware partition unchanged',GP,GREEN)
    f.arrow([(255,510),(255,565)],GOLD)
    f.box(50,565,410,105,'Resume simulation cautiously','First rebuild route near actual ride area',YP,GOLD)
    f.arrow([(460,617),(510,617),(510,457),(540,457)],GOLD,True)
    f.text(540,590,'FIT decoding was never reached.',21,weight='bold')
    f.text(540,628,'Restart cause needs separate evidence.',19,MUTED)
    f.text(50,747,'Keep physical sensor evidence and runtime load measurements as separate acceptance work.',19,MUTED)
    return f.save()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--png',action='store_true')
    args=parser.parse_args()
    OUT.mkdir(parents=True,exist_ok=True)
    paths=[fn() for fn in (offroute,schema,growth,lifetimes,heaps,state,patch_space,heading_inputs,offroute_state,rejoin_planning,navigation_runtime,arrival_state,planner_limits,start_warning,coverage_boundary,replay_readiness)]
    if args.png:
        # A deterministic system font path avoids depending on ImageMagick's font registry.
        font=Path('/System/Library/Fonts/Supplemental/Arial.ttf')
        for p in paths:
            command=['magick','-density','144']
            if font.exists():command+=['-font',str(font)]
            command += [str(p),'-strip',str(p.with_suffix('.png'))]
            subprocess.run(command,check=True)
    print(f'Rendered {len(paths)} SVG figures'+(' and PNG copies.' if args.png else '.'))


if __name__=='__main__':
    main()
