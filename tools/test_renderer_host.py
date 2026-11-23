"""Actual map.c under ASan/UBSan; projection and line rasterization are fixtures."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get("CC700_PATCH_SRC", ROOT / "firmware/mapdraw/map.c")).parent
V21_COMMIT = "6bacafc"   # firmware/mapdraw as built in the base image, before A and B (18 Nov 2026)


class RendererHost(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="cc700-renderer-")
        cls.exe = Path(cls.tmp.name) / "renderer"
        subprocess.run(["cc", "-std=c11", "-O1", "-g", "-DHOST",
                        "-fsanitize=address,undefined", "-fno-sanitize-recover=all",
                        "-fno-omit-frame-pointer", "-I", str(SOURCE), "-I", str(ROOT / "firmware/common"),
                        "-I", str(ROOT / "firmware/raster"),
                        str(ROOT / "tools/renderer_host.c"), str(SOURCE / "map.c"), str(ROOT / "firmware/raster/raster.c"),
                        str(ROOT / "firmware/mapdraw/proj.c"), "-I", str(ROOT / "firmware/mapdraw"),
                        "-o", str(cls.exe)], check=True, capture_output=True)

        legacy = Path(cls.tmp.name) / "legacy.c"
        source = (SOURCE / "map.c").read_text()
        legacy.write_text(source[:source.index("// ---------- entry iterator ----------")] +
                          (ROOT / "tools/renderer_legacy_iterator.h").read_text())
        cls.legacy_exe = Path(cls.tmp.name) / "legacy"
        subprocess.run(["cc", "-std=c11", "-O1", "-g", "-DHOST",
                        "-fsanitize=address,undefined", "-fno-sanitize-recover=all",
                        "-fno-omit-frame-pointer", "-I", str(SOURCE), "-I", str(ROOT / "firmware/common"),
                        "-I", str(ROOT / "firmware/raster"),
                        str(ROOT / "tools/renderer_host.c"), str(legacy), str(ROOT / "firmware/raster/raster.c"),
                        "-o", str(cls.legacy_exe)], check=True, capture_output=True)

        v21 = Path(cls.tmp.name) / "v21"
        v21.mkdir()
        for name in ("map.c", "fw.h"):
            (v21 / name).write_bytes(subprocess.run(["git", "-C", str(ROOT), "show", f"{V21_COMMIT}:firmware/mapdraw/{name}"],
                                                    capture_output=True, check=True).stdout)
        cls.v21_exe = Path(cls.tmp.name) / "v21-renderer"
        subprocess.run(["cc", "-std=c11", "-O1", "-g", "-DHOST", "-Wno-implicit-function-declaration",
                        "-fsanitize=address,undefined", "-fno-sanitize-recover=all",
                        "-fno-omit-frame-pointer", "-I", str(v21),
                        str(ROOT / "tools/renderer_host.c"), str(v21 / "map.c"),
                        "-o", str(cls.v21_exe)], check=True, capture_output=True)

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

    def test_v20_water_path_and_preserved_semantic_styles(self):
        source=(SOURCE / "map.c").read_text()
        expected={3:("K_FILL",0,"82cbd5"),4:("K_LINE",3,"82cbd5"),
                  25:("K_LINE",1,"378b98"),11:("K_DASH",2,"66615a"),
                  18:("K_DASH",2,"6b4a2b"),13:("K_LINE",2,"7040b0"),
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

    def test_label_positions_and_anchor_calls_are_pinned(self):   # the name pass through probe() must keep them
        pins = {"labels": (1, 30, 7539542452286131571, 6405724306347016936),
                "labels_cap": (36, 60, 10825711339495925603, 16073837979451276507),
                "labels_touch": (2, 2, 9125550091580677779, 2434597354675110236)}
        for case, pin in pins.items():
            with self.subTest(case=case):
                d = self.run_case(case)
                self.assertEqual((d["labels"], d["callbacks"], d["trace"], d["label_trace"]), pin)

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

    def run_v21(self, case):
        result = subprocess.run([str(self.v21_exe), case], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_a_off_canvas_lines_make_no_draw_call_and_the_visible_calls_are_the_same(self):
        for case in ("offscreen", "styles", "mixed", "dense1201", "geometry60", "labels"):
            with self.subTest(case=case):
                new, old = self.run_case(case), self.run_v21(case)
                self.assertEqual(new["visible_trace"], old["visible_trace"])
                self.assertEqual(new["visible_draws"], old["visible_draws"])
                self.assertEqual(new["painted"], old["painted"])
                self.assertEqual(new["callbacks"], old["callbacks"])
                self.assertEqual(new["labels"], old["labels"])
        new, old = self.run_case("offscreen"), self.run_v21("offscreen")
        self.assertGreater(old["draws"], 20 * new["draws"], (old["draws"], new["draws"]))
        self.assertGreater(new["visible_draws"], 0)

    def test_b_a_slow_frame_is_not_cut_inside_a_level(self):
        # cc27 (design 8.4): the 400 ms stop is checked only between passes. 1,201 roads of one level with 1 ms for each
        # clock read: the frame is drawn in full (cc26 stopped after 400 entries, between an edge and a core).
        data = self.run_case("slow")
        full = self.run_case("dense1201")["callbacks"]
        self.assertEqual(data["first_frame_callbacks"], full)
        self.assertEqual(data["callbacks"] - data["first_frame_callbacks"], full)
        self.assertEqual(data["allocations"], 2)

    def run_entries(self, case):
        result = subprocess.run([str(self.exe), case], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual((data["locks"], data["live_bytes"]), (data["unlocks"], 0))
        return data

    def test_block_without_flags_entry_draws_as_cc26(self):
        off = self.run_entries("own_off")                    # no flags entry: LVGL calls, the stub paints nothing
        self.assertEqual(off["draws"], 2 * 40)
        self.assertEqual(off["painted"], 0)
        self.assertEqual(off["map_text"], "")

    def test_flags_entry_is_not_drawn_and_not_counted_as_a_label(self):
        own = self.run_entries("own")
        self.assertEqual(own["callbacks"], 2 * 40)            # edge and core of the 40 roads; nothing for the flags entry
        self.assertEqual(own["labels"], 0)

    def test_own_lines_draw_pixels_and_make_no_lvgl_call(self):
        own = self.run_entries("own")
        self.assertEqual(own["draws"], 0)
        self.assertGreater(own["painted"], 0)

    def test_F_AA_draws_smooth_lines_without_lvgl(self):
        own, aa = self.run_entries("own"), self.run_entries("own_aa")
        self.assertEqual(aa["draws"], 0)
        self.assertEqual(aa["callbacks"], own["callbacks"])
        self.assertGreater(aa["painted"], 0)
        self.assertNotEqual(aa["painted"], own["painted"])  # even widths give half-covered edge rows

    def test_dash_pieces_are_pinned(self):                  # 32-bit dash math must give the pieces of the 16.16/int64 code
        r = subprocess.run([str(self.exe), "dash_pieces"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout), {"draws": 911034, "trace": 6584379539263830308})

    def test_own_raster_frames_are_pinned(self):          # S5 (23 Nov): px = FNV-1a of the canvas; the same on 6b9dea5
        pinned = {"own": (3995191648, 6878), "own_aa": (2748214721, 6994), "cyc_aa": (2822971559, 4366),
                  "cyc_off": (3927102805, 4176), "wat_aa": (1968064241, 7081), "wat_own": (1968064241, 7081),
                  "grn_aa": (2381880997, 7081), "grn_own": (2381880997, 7081), "proj": (2428428057, 1596)}
        for case, want in pinned.items():
            d = self.run_entries(case)
            self.assertEqual((d["px"], d["painted"]), want, case)

    def test_flag_32_is_ignored(self):                      # F_NODRAW (cc28 test switch) is retired: as F_OWN alone
        r, own = self.run_entries("nodraw"), self.run_entries("own")
        self.assertEqual({k: r[k] for k in ("callbacks", "draws", "painted", "ink", "roads_drawn")},
                         {k: own[k] for k in ("callbacks", "draws", "painted", "ink", "roads_drawn")})

    def test_F_CYC_is_ignored(self):                        # cc28b: the casing broke the line at each entry end
        cyc, off = self.run_entries("cyc"), self.run_entries("cyc_off")
        self.assertEqual((cyc["painted"], cyc["ink"]), (off["painted"], off["ink"]))
        self.assertEqual(self.run_entries("cyc_aa16")["ink"], self.run_entries("cyc_aa")["ink"])

    def test_F_AA_draws_cycleways_two_px(self):            # cc28d (owner): 2 px in the table, 2.0 px with the smooth drawer
        ratio = self.run_entries("cyc_aa")["ink"] / self.run_entries("cyc_off")["ink"]
        self.assertGreater(ratio, 0.9)
        self.assertLess(ratio, 1.15)

    def test_F_AA_keeps_the_plain_area_outline(self):       # cc28d: water and green outlines 1 px plain, as cc26/cc27
        for cls in ("wat", "grn"):
            aa, own = self.run_entries(cls + "_aa"), self.run_entries(cls + "_own")
            self.assertGreater(own["painted"], 0, cls)
            self.assertEqual((aa["painted"], aa["ink"]), (own["painted"], own["ink"]), cls)

    def test_F_PROJ_projects_without_the_stock_callback(self):   # cc28b: only the probes go through the stock projection
        stock, own = self.run_entries("own_aa"), self.run_entries("proj")
        self.assertEqual(own["draws"], 0)
        self.assertGreater(own["painted"], 0)
        self.assertLessEqual(own["callbacks"], 10)
        self.assertEqual(stock["callbacks"], 2 * 40)

    def test_F_PROJ_falls_back_to_the_stock_projection(self):
        for case in ("proj_badzoom", "proj_far"):              # zoom out of range; a stock probe off the canvas limits
            r = self.run_entries(case)
            self.assertGreaterEqual(r["callbacks"], 2 * 40, case)
            self.assertGreater(r["painted"], 0, case)

    def test_F_PROJ_text_shows_the_largest_difference_to_the_stock_projection(self):
        self.assertRegex(self.run_entries("proj_text")["map_text"], r"^m\d+ p\d$")

    def test_map_text_names_the_pass_where_the_stop_came(self):
        r = self.run_entries("level_stop_text")             # the stop comes before level 1: pass 3
        self.assertRegex(r["map_text"], r"^m\d+ c3$")
        self.assertRegex(self.run_entries("flags_text")["map_text"], r"^m\d+$")

    def test_level_stop_keeps_each_road_whole(self):
        r = self.run_entries("level_stop")                   # 150 ms for each clock read: the stop comes before level 1
        self.assertEqual(r["whole"], 1)
        self.assertEqual(r["max_level"], 0)
        self.assertGreater(r["roads_drawn"], 0)

    def test_fill_pass_and_name_pass_stop_only_at_their_start(self):
        r = self.run_entries("fill_stop")                    # 250 ms for each read: all 10 fills, then the stop
        self.assertEqual(r["fills"], 10)
        self.assertEqual(r["roads_drawn"], 0)

    def test_map_time_text_only_with_F_TEXT(self):
        self.assertRegex(self.run_entries("flags_text")["map_text"], r"^m[0-9]+$")
        self.assertEqual(self.run_entries("own")["map_text"], "")

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
