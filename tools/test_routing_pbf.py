"""Run with an environment containing osmium: python -m unittest discover -s tools -p test_routing_pbf.py."""
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys
import json

try:
    import osmium
except ImportError:
    osmium = None


@unittest.skipIf(osmium is None, 'Optional offline PBF importer requires pyosmium')
class PbfSelectionTest(unittest.TestCase):
    def run_fixture(self, xml, bbox=(0, 0, .1, .1)):
        from routing_pbf import select_source
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'source.osm'
            p.write_text(xml)
            return select_source(p, bbox)

    def test_reference_closure_and_outside_member(self):
        response, receipt = self.run_fixture('''<osm version="0.6">
        <node id="1" lat="0.02" lon="0.02"><tag k="barrier" v="gate"/></node>
        <node id="2" lat="0.03" lon="0.03"/><node id="3" lat="2" lon="2"/>
        <node id="4" lat="2.1" lon="2.1"/>
        <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>
        <way id="20"><nd ref="3"/><nd ref="4"/><tag k="highway" v="residential"/></way>
        <relation id="30"><member type="way" ref="10" role="from"/>
        <member type="node" ref="2" role="via"/><member type="way" ref="20" role="to"/>
        <tag k="type" v="restriction"/><tag k="restriction" v="no_left_turn"/></relation>
        </osm>''')
        self.assertEqual({e['id'] for e in response['elements'] if e['type'] == 'way'}, {10, 20})
        self.assertEqual({e['id'] for e in response['elements'] if e['type'] == 'node'}, {1, 2, 3, 4})
        self.assertEqual(response['elements'][0]['tags']['barrier'], 'gate')
        self.assertEqual(receipt['primaryWays'], 1)
        self.assertEqual(receipt['missingNodes'], [])
        self.assertEqual(receipt['origin'], 'regional-osm-file')
        self.assertEqual(len(receipt['sourceSha256']), 64)
        self.assertEqual(receipt['bbox'], [0, 0, .1, .1])

    def test_unsorted_objects_and_dangling_members_are_explicit(self):
        response, receipt = self.run_fixture('''<osm version="0.6">
        <relation id="30"><member type="way" ref="10" role="from"/>
        <member type="way" ref="99" role="via"/><tag k="type" v="restriction"/></relation>
        <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="cycleway"/></way>
        <node id="1" lat="0.02" lon="0.02"/><node id="2" lat="0.03" lon="0.03"/></osm>''')
        self.assertEqual(receipt['primaryWays'], 1)
        self.assertEqual(receipt['missingWays'], [99])
        self.assertEqual(len([e for e in response['elements'] if e['type'] == 'relation']), 1)
        self.assertIsNone(response['osm3s']['timestamp_osm_base'])

    def test_bounds_and_missing_node(self):
        from routing_pbf import select_source
        for bbox in [(1, 0, 0, 1), (0, 0, float('nan'), 1), (0, 0, 1, 1)]:
            with self.assertRaises(ValueError):
                select_source(Path('not-opened.osm'), bbox)
        response, receipt = self.run_fixture('''<osm version="0.6"><node id="1" lat="0.02" lon="0.02"/>
        <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="cycleway"/></way></osm>''')
        self.assertEqual(receipt['missingNodes'], [2])

    def test_conflicting_original_ids_fail_in_both_orders(self):
        node='<node id="1" lat="0.02" lon="0.02"/>'
        barrier='<node id="1" lat="0.02" lon="0.02"><tag k="barrier" v="gate"/></node>'
        second='<node id="2" lat="0.03" lon="0.03"/>'
        way='<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="cycleway"/></way>'
        other=way.replace('cycleway','steps')
        outside=way.replace('ref="1"','ref="3"').replace('ref="2"','ref="4"')
        relation='<relation id="30"><member type="way" ref="10" role="from"/><tag k="type" v="restriction"/><tag k="restriction" v="no_left_turn"/></relation>'
        changed=relation.replace('no_left_turn','no_right_turn')
        not_selected=relation.replace('ref="10"','ref="99"')
        for a,b,rest in [(node,barrier,second+way),(way,other,node+second),
                (way,outside,node+second),(relation,changed,node+second+way),
                (relation,not_selected,node+second+way)]:
            for objects in [a+b+rest,b+a+rest]:
                with self.subTest(objects=objects), self.assertRaisesRegex(ValueError,'Conflicting original'):
                    self.run_fixture('<osm version="0.6">'+objects+'</osm>')

    def test_cli_preserves_existing_output(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d); out=p/'out';out.mkdir();(out/'sentinel').write_text('keep')
            completed=subprocess.run([sys.executable,str(Path(__file__).with_name('routing_pbf.py')),
                '--source','absent.osm','--region','absent.json','--output',str(out)],capture_output=True)
            self.assertNotEqual(completed.returncode,0)
            self.assertEqual(sorted(x.name for x in out.iterdir()),['sentinel'])
            self.assertEqual((out/'sentinel').read_text(),'keep')


if __name__ == '__main__':
    unittest.main()
