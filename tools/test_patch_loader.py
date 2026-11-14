"""Full loader regressions against configurable patch C source."""
import unittest
from patch_loader_host import LoaderHost


class PatchLoader(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.host = LoaderHost()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def select(self, points, roads, pos, current, sections, **kwargs):
        file_type = kwargs.pop("file_type", 0)
        self.host.setup(points, roads, pos, sections, **kwargs)
        return self.host.run(current, file_type)

    def test_stale_adjacent_section_switches_by_distance(self):
        r = self.select([(x, 0) for x in range(0, 2001, 100)], [0]*10+[1]*11,
                        (1900, 0), 0, 2)
        self.assertEqual(r["section"], 1)

    def test_parallel_current_section_uses_all_its_segments(self):
        points = [(x, 0) for x in range(0, 1001, 100)]
        points += [(1000, 1000), (0, 1000), (0, 10)]
        points += [(x, 10) for x in range(100, 1001, 100)]
        r = self.select(points, [0]*11+[1]*2+[2]*11, (250, 10), 2, 3)
        self.assertEqual(r["section"], 2)

    def test_shared_endpoint_owns_outgoing_segment(self):
        r = self.select([(0,0),(100,0),(200,0)], [0,1,2], (150,0), 0, 2)
        self.assertEqual(r["section"], 1)

    def test_current_section_retained_inside_25m_margin(self):
        r = self.select([(0,0),(100,0),(200,0)], [0,1,2], (110,0), 0, 2)
        self.assertEqual(r["section"], 0)

    def test_crossing_prefers_current_section(self):
        r = self.select([(-100,-100),(100,100),(-100,100),(100,-100)],
                        [0,1,2,3], (0.001,0.001), 2, 3)
        self.assertEqual(r["section"], 2)

    def test_combined_route_ids_resolve_to_requested_file_local_index(self):
        r = self.select([(0,0),(100,0),(200,0),(300,0)], [10,11,12,13], (150,0), 0, 3,
                        mappings=[(4,0)]*10+[(0,0),(0,1),(0,2),(0,3)])
        self.assertEqual((r["file_type"], r["section"]), (0,1))

    def test_other_file_geometry_cannot_select_current_file_block(self):
        r = self.select([(0,0),(100,0),(200,0),(300,0)], [0,1,2,3], (250,0), 0, 2,
                        mappings=[(0,0),(0,1),(4,0),(4,1)])
        self.assertEqual((r["file_type"], r["section"]), (0,1))

    def test_connector_and_reverse_slot_use_local_sections(self):
        for slot in (1,2,4,5):
            with self.subTest(slot=slot):
                r = self.select([(0,0),(100,0),(200,0)], [2,3,4], (150,0), 0, 2,
                                mappings=[(0,0),(0,1),(slot,0),(slot,1),(slot,2)], file_type=slot)
                self.assertEqual((r["file_type"],r["section"]), (slot,1))

    def test_missing_or_empty_index_does_not_load_block(self):
        for sections, has in ((0,True),(2,False)):
            r = self.select([(0,0),(100,0)], [0,1], (50,0), 0, sections, has=has)
            self.assertEqual((r["index_loads"],r["block_loads"]), (1,0))

    def test_no_gps_preserves_firmware_choice(self):
        r = self.select([(0,0),(100,0),(200,0)], [0,1,2], (0,0), 1, 2)
        self.assertEqual(r["section"], 1)

    def test_empty_and_torn_down_list_preserve_firmware_choice(self):
        self.host.setup([],[],(50,0),2)
        self.assertEqual(self.host.run(1)["section"],1)
        self.host.lib.host_clear_list()
        self.assertEqual(self.host.run(1)["section"],1)

    def test_invalid_mapping_does_not_become_last_block(self):
        r = self.select([(0,0),(100,0),(200,0)], [0,1,2], (150,0), 0, 2,
                        mappings=[(0,0),(0,999),(0,1000)])
        self.assertEqual(r["section"],0)

    def test_dense_scan_has_no_indexed_walks_and_resolves_per_section(self):
        n=4000
        r=self.select([(x,0) for x in range(n)], [i//100 for i in range(n)],
                      (3550,0),0,40)
        self.assertEqual(r["section"],35)
        self.assertEqual(r["indexed_lookups"],0)
        self.assertLessEqual(r["resolutions"],40)

    def test_gate_requires_map_index(self):
        for has, expected in ((False,0),(True,1)):
            self.host.setup([(0,0),(100,0)],[0,1],(50,0),1,has=has)
            self.host.lib.cc_gate()
            self.assertEqual(self.host.run(0)["draw_calls"],expected)

    def test_arrow_uses_local_sections_instead_of_dense_point_indices(self):
        self.host.setup([(x,0) for x in range(0,2001,100)], [0]*10+[1]*11,
                        (1900,0),2)
        self.assertEqual(self.host.lib.host_arrow(0,2,2000,0),4)

    def test_busy_navigation_skips_optional_arrows_without_wait_or_list_scan(self):
        self.host.setup([(0,0),(100,0)],[0,1],(50,0),1)
        self.host.lib.host_nav_available(0)
        self.assertEqual(self.host.lib.host_arrow(0,1,100,0),0)
        self.assertEqual(self.host.lib.host_metric(5),0)
        self.assertEqual(self.host.lib.host_metric(8),0)

    def test_arrow_releases_navigation_before_taking_map_lock(self):
        self.host.setup([(0,0),(100,0)],[0,1],(50,0),1)
        self.assertEqual(self.host.lib.host_arrow(0,1,100,0),4)
        self.assertEqual([self.host.lib.host_metric(i) for i in (7,8,9)],[1,1,0])

    def test_null_inner_storage_is_guarded_before_stock_count(self):
        self.host.setup([(0,0),(100,0)],[0,1],(50,0),2)
        self.host.lib.host_clear_inner()
        self.assertEqual(self.host.run(1)["section"],1)
        self.assertEqual(self.host.lib.host_metric(10),0)

    def test_null_payload_does_not_create_segment_across_missing_point(self):
        self.host.setup([(0,0),(100,0),(200,0),(300,0)],[0,1,2,3],(250,0),3)
        self.host.lib.host_null_point(1)
        self.assertEqual(self.host.run(0)["section"],2)

    def test_replaced_route_does_not_retain_previous_selection(self):
        self.host.setup([(0,0),(100,0),(200,0)],[0,1,2],(150,0),2)
        self.assertEqual(self.host.run(0)["section"],1)
        self.host.setup([(1000,0),(1100,0)],[0,1],(1050,0),1)
        self.assertEqual(self.host.run(0)["section"],0)


if __name__ == "__main__":
    unittest.main()
