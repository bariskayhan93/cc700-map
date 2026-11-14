"""Actual map.c under ASan/UBSan; projection and line rasterization are fixtures."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get("CC700_PATCH_SRC", ROOT.parent / "cc700-backup/patch/src/blk.c")).parent


class RendererHost(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="cc700-renderer-")
        cls.exe = Path(cls.tmp.name) / "renderer"
        subprocess.run(["cc", "-std=c11", "-O1", "-g", "-DHOST",
                        "-fsanitize=address,undefined", "-fno-sanitize-recover=all",
                        "-fno-omit-frame-pointer", "-I", str(SOURCE),
                        str(ROOT / "tools/renderer_host.c"), str(SOURCE / "map.c"),
                        "-o", str(cls.exe)], check=True, capture_output=True)

        legacy = Path(cls.tmp.name) / "legacy.c"
        source = (SOURCE / "map.c").read_text()
        legacy.write_text(source[:source.index("// ---------- entry iterator ----------")] +
                          (ROOT / "tools/renderer_legacy_iterator.h").read_text())
        cls.legacy_exe = Path(cls.tmp.name) / "legacy"
        subprocess.run(["cc", "-std=c11", "-O1", "-g", "-DHOST",
                        "-fsanitize=address,undefined", "-fno-sanitize-recover=all",
                        "-fno-omit-frame-pointer", "-I", str(SOURCE),
                        str(ROOT / "tools/renderer_host.c"), str(legacy),
                        "-o", str(cls.legacy_exe)], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def run_case(self, case):
        result = subprocess.run([str(self.exe), case], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["locks"], data["unlocks"])
        self.assertEqual(data["live_bytes"], 0)
        self.assertEqual(data["guard_changed"], 0)
        return data

    def test_v19_water_path_and_preserved_semantic_styles(self):
        source=(SOURCE / "map.c").read_text()
        expected={3:("K_FILL",0,"82cbd5"),4:("K_LINE",3,"378b98"),
                  25:("K_LINE",1,"378b98"),11:("K_DASH",2,"66615a"),
                  18:("K_DASH",2,"6b4a2b"),13:("K_LINE",3,"0b4fb3"),
                  1:("K_FILL",0,"d4d4d4"),2:("K_FILL",0,"a2d683"),
                  5:("K_LINE",10,"202326"),7:("K_LINE",8,"3d4146"),
                  9:("K_LINE",5,"6a6e73")}
        for op,(kind,width,rgb) in expected.items():
            self.assertRegex(source,rf"\[{op}\] = \{{ {kind}, {width}, [0-9]+, [0-9]+, 0x{rgb} \}}")

    def test_legacy_dispatch_equivalence_arbitrary_styles_and_oom(self):
        for case in ("styles", "mixed", "dense4000", "oom", "labels", "failed_projection", "empty", "unloaded"):
            with self.subTest(case=case):
                actual=self.run_case(case)
                result=subprocess.run([str(self.legacy_exe),case],capture_output=True,text=True,check=True)
                expected=json.loads(result.stdout)
                self.assertLessEqual(actual["selection_checks"],expected["selection_checks"])
                if case=="dense4000":
                    self.assertEqual(actual["selection_checks"],12000)
                    self.assertEqual(expected["selection_checks"],248000)
                for field in ("trace","callbacks","projected_points","draws","allocations","peak_bytes"):
                    self.assertEqual(actual[field],expected[field],field)

    def test_doubled_hole_bridge_is_direction_independent(self):
        data=self.run_case("hole")
        self.assertEqual(data["painted"],50*50-20*20)
        self.assertEqual(data["painted"],self.run_case("hole_reverse")["painted"])

    def test_label_cap_reset_edges_hud_touching_and_payload_bounds(self):
        for case,count in (("labels_cap",36),("labels_edge",0),("labels_hud",0),
                           ("labels_touch",2),("labels_unterminated",0)):
            with self.subTest(case=case):
                self.assertEqual(self.run_case(case)["labels"],count)

    def test_shared_label_placement_rejects_collisions(self):
        self.assertEqual(self.run_case("labels")["labels"],1)

    def test_style_levels_bridges_tunnels_and_repeated_frames(self):
        data = self.run_case("styles")
        self.assertGreater(data["callbacks"], 100)
        self.assertGreater(data["draws"], 0)
        self.assertGreater(data["painted"], 0)
        self.assertEqual(data["allocations"], 3)
        self.assertEqual(data["peak_bytes"], 40)

    def test_allocation_failure_skips_styled_pass_and_releases_lock(self):
        data = self.run_case("oom")
        self.assertEqual(data["callbacks"], 4)  # original star entry survives
        self.assertEqual(data["allocations"], 1)
        self.assertEqual(data["peak_bytes"], 0)

    def test_dense_blocks_do_not_reintroduce_1200_entry_cap(self):
        for case, count in (("dense1201", 1201), ("dense4000", 4000)):
            with self.subTest(case=case):
                data = self.run_case(case)
                self.assertEqual(data["callbacks"], count * 2)  # edge, core
                self.assertEqual(data["peak_bytes"], 40)

    def test_empty_and_unloaded_blocks_do_not_allocate(self):
        for case in ("empty", "unloaded"):
            with self.subTest(case=case):
                data = self.run_case(case)
                self.assertEqual(data["callbacks"], 0)
                self.assertEqual(data["allocations"], 0)

    def test_sixty_point_geometry_and_failed_projection_prefix(self):
        data=self.run_case("geometry60")
        self.assertEqual(data["peak_bytes"],61*8)
        self.assertGreater(data["painted"],0)
        data=self.run_case("failed_projection")
        self.assertEqual(data["callbacks"],2)

    def test_budget_work_counts_match_actual_iterator(self):
        from map_budget import block_budget
        entries=[]
        for i in range(16*5*4):
            cls,level,flags=i%16,(i//16)%5,i//(16*5)
            style=cls|(level<<4)|(0x80 if flags&1 else 0)|(0x100 if flags&2 else 0) if cls else 0
            entries.append((style,4))
        predicted=block_budget(entries,0)
        observed=self.run_case('styles')  # three frames through actual map.c
        self.assertEqual(observed['callbacks'],predicted['projection_calls']*3)
        self.assertEqual(observed['projected_points'],predicted['projected_points']*3)


if __name__ == "__main__":
    unittest.main()
