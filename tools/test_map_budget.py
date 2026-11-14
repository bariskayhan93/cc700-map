"""Allocation payload and iterator work; no target timing assumptions."""
import unittest
from map_budget import block_budget, transition_budget


class MapBudget(unittest.TestCase):
    def test_decode_uses_allocated_28_byte_stride(self):
        r=block_budget([(5|32,4),(6|32,9)],100)
        self.assertEqual(r['decoded_payload_bytes'],28*2+8*13)
        self.assertEqual(r['largest_coordinate_allocation_bytes'],72)

    def test_cased_roads_project_twice(self):
        r=block_budget([(5|32,4),(6|32,9)],100)
        self.assertEqual(r['projection_calls'],4)
        self.assertEqual(r['projected_points'],30)
        self.assertEqual(r['iterator_scratch_bytes'],80)
        self.assertEqual(r['projection_scratch_peak_bytes'],40)

    def test_bridge_path_adds_two_base_passes(self):
        r=block_budget([(8|32|0x80,3)],100)
        self.assertEqual(r['projection_calls'],3)

    def test_fill_outline_and_clipped_outline_omission(self):
        r=block_budget([(2|32,4),(3|32|0x400,5)],100)
        self.assertEqual(r['projection_calls'],3)
        self.assertEqual(r['projected_points'],16)

    def test_label_projects_anchor_only(self):
        r=block_budget([(12|32,3)],100)
        self.assertEqual((r['projection_calls'],r['projected_points']),(1,1))

    def test_star_entries_have_no_float_buffer(self):
        r=block_budget([(0,3)],100)
        self.assertEqual(r['iterator_scratch_bytes'],0)
        self.assertEqual((r['projection_calls'],r['projected_points']),(3,6))

    def test_class15_is_separate_overlay_but_affects_buffer(self):
        r=block_budget([(15|32,24)],100)
        self.assertEqual(r['projection_calls'],0)
        self.assertEqual(r['iterator_scratch_bytes'],200)
        self.assertEqual(r['separate_overlay_entries'],1)

    def test_load_peak_includes_old_and_new_lifetimes(self):
        a=block_budget([(6|32,100)],200)
        b=block_budget([(6|32,2)],500)
        r=transition_budget(a,b)
        self.assertEqual(r['block_payload_peak_upper_bytes'],a['decoded_payload_bytes']+500)
        self.assertEqual(r['plus_canvas_bytes'],r['block_payload_peak_upper_bytes']+122880)


if __name__=='__main__':unittest.main()
