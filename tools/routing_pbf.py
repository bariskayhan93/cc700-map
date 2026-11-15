#!/usr/bin/env python3
"""PC-only offline regional OSM selector. Optional dependency: osmium==4.3.2.

Independent scans preserve references without an all-region location index or
an assumption that file entities are sorted. No network or device operations.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import osmium


def select_source(filename, bbox):
    if len(bbox) != 4 or not all(isinstance(x, (float, int)) and math.isfinite(x) for x in bbox):
        raise ValueError('Invalid bounding box')
    south, west, north, east = bbox
    area = (north - south) * (east - west) * 111.195**2 * math.cos(math.radians((north + south) / 2))
    if not (-90 <= south < north <= 90 and -180 <= west < east <= 180 and
            north - south <= 1 and east - west <= 1 and 0 < area <= 600):
        raise ValueError('Bounding box exceeds study bounds')
    filename = Path(filename)
    if filename.stat().st_size > 512 * 1024 * 1024:
        raise ValueError('Source exceeds 512 MiB')
    digest = hashlib.sha256()
    with filename.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(chunk)
    with osmium.io.Reader(str(filename)) as reader:
        header = reader.header()
        if header.has_multiple_object_versions:
            raise ValueError('History inputs are not admitted')
        timestamp = header.get('osmosis_replication_timestamp') or None
    inside, ways, restrictions, nodes = set(), {}, {}, {}

    def keep(table, value):
        previous = table.get(value['id'])
        if previous is not None and previous != value:
            raise ValueError('Conflicting original '+value['type']+' '+str(value['id']))
        table[value['id']] = value

    class RegionNodes(osmium.SimpleHandler):
        def node(self, n):
            if n.location.valid() and south <= n.location.lat <= north and west <= n.location.lon <= east:
                inside.add(n.id)
                if len(inside) > 3000000:
                    raise ValueError('Region node admission exceeded')

    class PrimaryWays(osmium.SimpleHandler):
        def way(self, w):
            if w.tags.get('highway') and any(n.ref in inside for n in w.nodes):
                keep(ways, dict(type='way', id=w.id, nodes=[n.ref for n in w.nodes], tags=dict(w.tags)))
                if len(ways) > 100000:
                    raise ValueError('Way admission exceeded')

    RegionNodes().apply_file(str(filename))
    PrimaryWays().apply_file(str(filename))
    primary = set(ways)
    needed_ways, extra_nodes = set(), set()

    class Restrictions(osmium.SimpleHandler):
        def relation(self, r):
            if r.tags.get('type') != 'restriction' or not any(m.type == 'w' and m.ref in primary for m in r.members):
                return
            keep(restrictions, dict(type='relation', id=r.id, tags=dict(r.tags),
                members=[dict(type={'n': 'node', 'w': 'way', 'r': 'relation'}[m.type], ref=m.ref, role=m.role) for m in r.members]))
            for m in r.members:
                if m.type == 'w': needed_ways.add(m.ref)
                if m.type == 'n': extra_nodes.add(m.ref)
            if len(restrictions) > 10000 or len(needed_ways) > 100000 or len(extra_nodes) > 100000:
                raise ValueError('Restriction admission exceeded')

    Restrictions().apply_file(str(filename))

    class MemberWays(osmium.SimpleHandler):
        def way(self, w):
            if w.id in needed_ways or w.id in primary:
                keep(ways, dict(type='way', id=w.id, nodes=[n.ref for n in w.nodes], tags=dict(w.tags)))

    class VerifyRestrictions(osmium.SimpleHandler):
        def relation(self, r):
            if r.id in restrictions:
                keep(restrictions, dict(type='relation', id=r.id, tags=dict(r.tags),
                    members=[dict(type={'n': 'node', 'w': 'way', 'r': 'relation'}[m.type], ref=m.ref, role=m.role) for m in r.members]))

    MemberWays().apply_file(str(filename))
    VerifyRestrictions().apply_file(str(filename))
    wanted = extra_nodes | {n for w in ways.values() for n in w['nodes']}
    if len(wanted) > 750000:
        raise ValueError('Referenced node admission exceeded')

    class ReferencedNodes(osmium.SimpleHandler):
        def node(self, n):
            if n.id in wanted and n.location.valid():
                keep(nodes, dict(type='node', id=n.id, lat=n.location.lat, lon=n.location.lon, tags=dict(n.tags)))

    ReferencedNodes().apply_file(str(filename))
    receipt = dict(origin='regional-osm-file', bbox=list(bbox), sourceSha256=digest.hexdigest(), sourceBytes=filename.stat().st_size,
        sourceTimestamp=timestamp, primaryWays=len(primary), ways=len(ways), nodes=len(nodes), restrictions=len(restrictions),
        missingNodes=sorted(wanted - nodes.keys()), missingWays=sorted(needed_ways - ways.keys()),
        selector='original-node bbox highway ways; backreferencing restrictions; member ways; referenced nodes',
        scope='regional extract only; reference integrity is not completeness or cycling validation')
    response = dict(version=0.6, generator='CC700 offline regional OSM selection; not an Overpass response',
        osm3s=dict(timestamp_osm_base=timestamp), elements=[*sorted(nodes.values(), key=lambda e: e['id']),
        *sorted(ways.values(), key=lambda e: e['id']), *sorted(restrictions.values(), key=lambda e: e['id'])])
    return response, receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--region', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir()  # Never overwrite a previous acquisition.
    receipt = dict(status='pending', origin='regional-osm-file')
    try:
        region = json.loads(Path(args.region).read_text())
        response, receipt = select_source(args.source, region['bbox'])
        raw = json.dumps(response, separators=(',', ':')).encode()
        if len(raw) > 64 * 1024 * 1024:
            raise ValueError('Selected response exceeds 64 MiB')
        (output / 'response.json').write_bytes(raw)
        (output / 'region.json').write_text(json.dumps(region, indent=2) + '\n')
        receipt.update(status='selected', responseBytes=len(raw), responseSha256=hashlib.sha256(raw).hexdigest())
    except Exception as error:
        receipt.update(status='failed', error=str(error))
        raise
    finally:
        (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
